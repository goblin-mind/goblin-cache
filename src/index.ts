import { LRUCache } from "lru-cache";
import { PromiseLadder, Product, EscalationOptions } from "promise-ladder";
import { openDB } from "idb";
import { createPool, Pool } from "generic-pool";

interface IDBWrapperOptions {
  dbName: string;
  objectStore: string;
}
export interface GoblinCacheOptions {
  dbOptions: IDBWrapperOptions;
  spawn: () => Worker;
  memoryLimit: number;
  batchOptions: {
    memory: EscalationOptions;
    db: EscalationOptions;
    source: EscalationOptions;
  };
}

export class GoblinCache {
  private promLadder: PromiseLadder;
  private static instance: GoblinCache;
  private pool: Pool<Worker>;
  constructor(private options: GoblinCacheOptions) {
    this.pool = createPool<Worker>(
      {
        create: () => Promise.resolve(options.spawn()),
        //TODO: support destroy and min options
        destroy: () => Promise.resolve(),
      },
      {
        max: options.batchOptions.source.maxConcurrentBatches,
        min: options.batchOptions.source.maxConcurrentBatches,
      }
    );

    const inMemoryCache = new LRUCache({
      max: options.memoryLimit,
    });

    let db: any;
    openDB(options.dbOptions.dbName, 1, {
      upgrade(_db) {
        _db.createObjectStore(options.dbOptions.objectStore);
      },
    }).then((_db) => {
      db = _db;
    });

    const getManyIDB = (paths: string[]) => {
      const tx = db.transaction(options.dbOptions.objectStore, "readwrite");
      return Promise.all(
        paths.map((path) => tx.store.get(path)).concat([tx.done])
      );
    };

    const setManyIDB = (products: Product[]) => {
      const tx = db.transaction(options.dbOptions.objectStore, "readwrite");
      return Promise.all(
        products
          .map((products) => tx.store.put(products.source, products.resource))
          .concat([tx.done])
      );
    };

    let uncachedProducts: Product[] = [];

    const callback = ({ source: path, resource: value }: Product) => {
      inMemoryCache.set(path, value);
      uncachedProducts.push({ source: path, resource: value });
      if (uncachedProducts.length > 10) {
        setManyIDB(uncachedProducts);
        uncachedProducts = [];
      }
    };

    //cache escalator: source escalator - Excavator, source harvester: promise escalator
    this.promLadder = new PromiseLadder([
      {
        resolver: async (keys: string[]) =>
          keys.map((key) => {
            return { source: key, resource: inMemoryCache.get(key) };
          }),
        options: options.batchOptions.memory,
        callback: () => {},
      },
      {
        resolver: async (paths: string[]) =>
          getManyIDB(paths).then((values) =>
            paths.map((key, index) => ({
              source: key,
              resource: values[index],
            }))
          ),
        options: options.batchOptions.db,
        callback,
      },
      {
        resolver: async (paths: string[]) => {
          // retriving files using harvester (worker) pool that can run batches in parallel without blocking js/ui
          const worker = await this.pool.acquire();
          return new Promise<Product[]>((resolve) => {
            const listener = (e: MessageEvent) => {
              worker.removeEventListener("message", listener);
              this.pool.release(worker);
              resolve(e.data);
            };
            worker.addEventListener("message", listener);
            worker.postMessage({ paths });
          });
        },
        options: options.batchOptions.source,
        callback,
      },
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
    return this.promLadder.resolve(path);
  }
}
