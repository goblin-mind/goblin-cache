import { CacheItem } from "./CacheItem";
export interface ProcessingStackOptions {
  batchSize: number;
  maxBatches: number;
  timeoutMs: number;
}
export interface StackTask {
  resolve: Function;
  inProcessing: boolean;
  value?: any;
}
interface ActionFunction {
  (keys: string[], valMap: Map<string, StackTask>): Promise<CacheItem[]>;
}
export class ProcessingStack {
  map: Map<string, StackTask> = new Map();
  batchSize: number = 1;
  maxBatches: number = 1;
  actionFunction: ActionFunction;
  currentBatches: number = 0;
  timeoutId: number = 0;
  nextStack: ProcessingStack | null = null;
  timeoutMs: number = 0;

  constructor({
    options,
    actionFunction,
  }: {
    actionFunction: ActionFunction;
    options: ProcessingStackOptions;
  }) {
    this.batchSize = options?.batchSize;
    this.maxBatches = options?.maxBatches;
    this.timeoutMs = options?.timeoutMs;
    this.actionFunction = actionFunction;
  }

  async executeBatch() {
    if (this.map.size === 0 || this.currentBatches >= this.maxBatches) return;

    this.currentBatches++;
    const keys = Array.from(this.map.keys())
      .reverse()
      .filter((key: string) => this.map.get(key)?.inProcessing === false)
      .slice(0, this.batchSize);

    keys.forEach((key) => {
      if (this.map.has(key)) {
        const item = this.map.get(key);
        if (item) {
          item.inProcessing = true;
        }
      }
    });

    const result = await this.actionFunction(keys, this.map);

    result.forEach(({ path, value }: CacheItem) => {
      const task = this.map.get(path);
      const _value = value ? value : task?.value;
      if (task) {
        if (_value) {
          task.resolve(_value);
        } else if (this.nextStack) {
          //promotion
          task.inProcessing = false;
          this.nextStack.map.set(path, task);
          this.nextStack.triggerQueue();
        } else {
          task.resolve(null);
        }
        this.map.delete(path);
      }
    });

    this.currentBatches--;
  }

  public triggerQueue() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    const nUnprocessed = () =>
      Array.from(this.map).filter((op) => op[1].inProcessing === false).length;

    const executeBatchIfNeeded = () => {
      if (this.currentBatches < this.maxBatches && nUnprocessed() > 0) {
        this.executeBatch();
        setTimeout(executeBatchIfNeeded, 0);
      }
      if (this.currentBatches >= this.maxBatches && nUnprocessed() > 0) {
        //eviction
        const unprocessed = Array.from(this.map.keys()).filter(
          (mo) => !this.map.get(mo)?.inProcessing
        );
        const evictionList = unprocessed.slice(
          this.maxBatches * this.batchSize - 1,
          this.map.size
        );
        evictionList.forEach((key) => this.map.delete(key));
      }
    };
    if (nUnprocessed() >= this.batchSize) {
      executeBatchIfNeeded();
    }

    this.timeoutId = setTimeout(executeBatchIfNeeded, this.timeoutMs);
  }
}
