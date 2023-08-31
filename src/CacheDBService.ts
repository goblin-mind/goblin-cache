import { CacheItem } from "./CacheItem";

export interface IDBWrapperOptions {
  dbName: string;
  objectStore: string;
}

export class CacheDBService {
  private db: IDBDatabase | null = null;

  constructor(private dbName: string, private objectStoreName: string) {}

  private async initDB() {
    return new Promise<void>((resolve, reject) => {
      if (this.db) resolve();
      const openRequest = indexedDB.open(this.dbName);

      openRequest.onupgradeneeded = (event) => {
        this.db = (event.target as IDBRequest).result;
        if (!this.db!.objectStoreNames.contains(this.objectStoreName)) {
          this.db!.createObjectStore(this.objectStoreName);
        }
      };

      openRequest.onsuccess = (event) => {
        this.db = (event.target as IDBRequest).result;
        resolve();
      };

      openRequest.onerror = (event) => {
        reject((event.target as IDBRequest).error);
      };
    });
  }

  public async addBlobs(data: CacheItem[]): Promise<void> {
    await this.initDB();
    if (!this?.db) return Promise.reject("DB not initialized");

    const transaction = this.db.transaction(
      [this.objectStoreName],
      "readwrite"
    );
    const store = transaction.objectStore(this.objectStoreName);

    for (const { path, value } of data) {
      store.put(value, path);
    }

    return new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = (e) => {
        reject(transaction.error);
      };
    });
  }

  public async retrieveBlobs(paths: string[]): Promise<CacheItem[]> {
    await this.initDB();
    if (!this?.db) return Promise.reject("DB not initialized");

    const transaction = this.db.transaction([this.objectStoreName]);
    const store = transaction.objectStore(this.objectStoreName);

    const promises = paths.map((path) => {
      return new Promise<CacheItem>((resolve, reject) => {
        const req = store.get(path);
        req.onsuccess = () => {
          if (req.result) {
            resolve({ path, value: req.result });
          } else {
            resolve({ path, value: null });
          }
        };
        req.onerror = () => reject(req.error);
      });
    });

    return Promise.all(promises);
  }
}
