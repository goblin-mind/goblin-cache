import { LRUCache } from "lru-cache";
import {
  ProcessingStack,
  ProcessingStackOptions,
  StackTask,
} from "./ProcessingStack";
import { HarvesterPool } from "./HarvesterPool";
import { CacheDBService, IDBWrapperOptions } from "./CacheDBService";
import { CacheItem } from "./CacheItem";

export interface GoblinCacheOptions {
  memLOptions: ProcessingStackOptions;
  dbLOptions: ProcessingStackOptions;
  hvLOptions: ProcessingStackOptions;
  dbOptions: IDBWrapperOptions;
  spawn: () => Worker;
  memoryLimit: number;
}

export class GoblinCache {
  private read_queues: ProcessingStack[] = [];
  private write_queues: ProcessingStack[] = [];
  private static instance: GoblinCache;

  constructor(private options: GoblinCacheOptions) {
    const db = new CacheDBService(
      options.dbOptions.dbName,
      options.dbOptions.objectStore
    );
    const harvesterPool = new HarvesterPool(
      options.hvLOptions.maxBatches,
      options.spawn
    );
    const inMemoryCache = new LRUCache({
      max: options.memoryLimit,
      dispose: (key: string, value: any) => {
        //memory eviction -> queuing db write task
        this.write_queues[1].map.set(key, {
          resolve: () => {},
          inProcessing: false,
          value,
        });
      },
    });

    // this will give each work stack a reference for promotion when unable to fulfill promise at current level
    const chainStacks = (stacks: ProcessingStack[]) => {
      for (let i = 0; i < stacks.length - 1; i++) {
        stacks[i].nextStack = this.read_queues[i + 1];
      }
    };

    // update cache using this.set updates both memory and db
    const updateCache = (data: CacheItem[]) =>
      new Promise<CacheItem[]>((resolve) => {
        data
          .filter((bwrap: CacheItem) => bwrap.value)
          .forEach((bwrap: CacheItem) => this.set(bwrap.path, bwrap.value));
        resolve(data);
      });

    this.read_queues = [
      new ProcessingStack({
        options: options.memLOptions,
        actionFunction: async (keys: string[]) =>
          keys.map((key) => ({
            path: key,
            value: inMemoryCache.get(key),
          })),
      }),
      new ProcessingStack({
        options: options.dbLOptions,
        actionFunction: async (keys: string[]) =>
          db.retrieveBlobs(keys).then(updateCache),
      }),
      new ProcessingStack({
        options: options.hvLOptions,
        actionFunction: (paths: string[]) =>
          // retriving files using harvester (worker) pool that can run batches in parallel without blocking js/ui
          harvesterPool.harvest(paths).then(updateCache),
      }),
    ];
    chainStacks(this.read_queues);

    this.write_queues = [
      new ProcessingStack({
        options: options.memLOptions,
        actionFunction: (keys: string[], valMap: Map<string, StackTask>) =>
          new Promise((resolve) => {
            keys.forEach((key) => {
              inMemoryCache.set(key, valMap.get(key)?.value);
            });
            resolve(
              keys.map((key) => {
                return { path: key, value: valMap.get(key)?.value };
              })
            );
          }),
      }),
      new ProcessingStack({
        options: options.dbLOptions,
        actionFunction: async (
          keys: string[],
          valMap: Map<string, StackTask>
        ) => {
          const blobs = keys.map((path) => ({
            path,
            value: valMap.get(path)?.value,
          }));
          return db.addBlobs(blobs).then(() => blobs);
        },
      }),
    ];
    chainStacks(this.write_queues);
  }

  // for use as singleton
  public static getInstance(options: GoblinCacheOptions): GoblinCache {
    if (!GoblinCache.instance) {
      GoblinCache.instance = new GoblinCache(options);
    }
    return GoblinCache.instance;
  }

  public async get(path: string) {
    const existing = this.read_queues
      .find((queue) => queue?.map?.get(path))
      ?.map.get(path);
    if (existing) {
      return new Promise((resolve: Function) => (resolve = existing.resolve));
    }
    const promise = new Promise<any>((resolve) => {
      const queue = this.read_queues[0];
      queue.map.set(path, { resolve, inProcessing: false });
      queue.triggerQueue();
    });
    return promise;
  }

  public async set(path: string, value: any) {
    const promise = new Promise<any>((resolve) => {
      const queue = this.write_queues[0];
      queue.map.set(path, { resolve, inProcessing: false, value });
      queue.triggerQueue();
    });
    return promise;
  }
}
