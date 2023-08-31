import { CacheItem } from "./CacheItem";

interface Harvester extends Worker {
  isFree: boolean;
}

export class HarvesterPool {
  size: number;
  pool: Harvester[];
  spawn: () => Harvester;

  constructor(size: number, spawn: () => Worker) {
    this.size = size;
    this.pool = [];
    this.spawn = () => spawn() as Harvester;
    this.initialize();
  }

  private initialize(): void {
    for (let i = 0; i < this.size; i++) {
      const harvester: Harvester = this.spawn();
      harvester.isFree = true;
      this.pool.push(harvester);
    }
  }

  private async getHarvester(): Promise<Harvester> {
    while (true) {
      const harvester: Harvester | undefined = this.pool.find(
        (hvstr: Harvester) => hvstr.isFree
      );
      if (harvester) {
        harvester.isFree = false;
        return harvester;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private releaseHarvester(harvester: Harvester): void {
    harvester.isFree = true;
  }

  async harvest(paths: string[]): Promise<CacheItem[]> {
    const harvester = await this.getHarvester();
    return new Promise<CacheItem[]>((resolve) => {
      const listener = (e: MessageEvent) => {
        harvester.removeEventListener("message", listener);
        this.releaseHarvester(harvester);
        resolve(e.data);
      };
      harvester.addEventListener("message", listener);
      harvester.postMessage({
        paths,
      });
    });
  }
}
