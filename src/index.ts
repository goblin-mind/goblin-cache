import { LRUCache } from "lru-cache";

import { HarvesterPool } from "./HarvesterPool";
import { CacheDBService, IDBWrapperOptions } from "./CacheDBService";
import { CacheItem } from "./CacheItem";
import { ChainGoblin } from "./ChainGoblin";

export interface GoblinCacheOptions {
  dbOptions: IDBWrapperOptions;
  spawn: () => Worker;
  memoryLimit: number;
}

export class GoblinCache {
  private chainGoblin: ChainGoblin;
  private static instance: GoblinCache;

  constructor(private options: GoblinCacheOptions) {
    const db = new CacheDBService(
      options.dbOptions.dbName,
      options.dbOptions.objectStore
    );
    const harvesterPool = new HarvesterPool(
      5,
      options.spawn
    );
    let evictedItems: CacheItem[] = [];
    const inMemoryCache = new LRUCache({
      max: options.memoryLimit,
      dispose: (key: string, value: any) => {
        evictedItems.push({ path: key, value });
        if (evictedItems.length > 10) {
          db.addBlobs(evictedItems);
          evictedItems = [];
        }
      },
    });
    const callback = (items:CacheItem[]) => {
      inMemoryCache.set(items[0].path, items[0].value);
    }

    this.chainGoblin = new ChainGoblin([
      {
        resolver: async (key: string) => inMemoryCache.get(key),
        options: { minBatchSize: 1, maxConcurrentBatches: 50, timeout: 10 },
        callback:()=>{}
      },
      {
        resolver: async (path: string) => db.retrieveBlobs([path]).then(item=>item[0]?.value),
        options: { minBatchSize: 1, maxConcurrentBatches: 15, timeout: 100 },
        callback
      },
      {
        resolver: (path: string) =>
          // retriving files using harvester (worker) pool that can run batches in parallel without blocking js/ui
          harvesterPool.harvest([path]).then(item=>item[0]?.value),
        options: { minBatchSize: 1, maxConcurrentBatches: 5, timeout: 200 },
        callback
      },
      // Add more queues as needed
    ]);
   
  }

  // for use as singleton
  public static getInstance(options: GoblinCacheOptions): GoblinCache {
    if (!GoblinCache.instance) {
      GoblinCache.instance = new GoblinCache(options);
    }
    return GoblinCache.instance;
  }

  public async get(path: string) {
  
    return this.chainGoblin.harvest(path);
  }
 
}
