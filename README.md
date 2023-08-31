# GoblinCache

## Overview
GoblinCache is a multi-level caching library designed to efficiently manage data across different storage layers. It incorporates in-memory storage, IndexedDB, and Web Workers for optimized performance. The package is highly configurable and suited for applications where data accessibility, performance, and efficiency are crucial.

## Features
- **Multi-Level Caching**: Three levels of caching: In-Memory, IndexedDB, and custom workers.
- **Highly Configurable**: Batch sizes, maximum number of batches, and timeouts can be adjusted for each layer.
- **LRU Eviction**: Least Recently Used (LRU) eviction algorithm for the in-memory layer.
- **Promotion and Eviction**: Cache items are promoted or evicted between layers automatically based on configuration.
- **Batch Processing**: Handles multiple requests in a single batch to maximize throughput.
- **Concurrency Control**: Utilizes Web Workers for concurrent processing without blocking the main thread.
- **Singleton Pattern**: Ensures a single instance of the cache manager.

## Installation
Install via npm:
\```bash
npm install goblin-cache
\```

## Usage

### Initialization
Import the package and initialize with options:
\```typescript
import { GoblinCache, GoblinCacheOptions } from 'goblin-cache';

const options: GoblinCacheOptions = {
  // ...
};
const cacheManager = GoblinCache.getInstance(options);
\```

### Get and Set Data
Get and set data using the `get` and `set` methods.
\```typescript
cacheManager.get("some-key").then((data) => {
  // Do something
});

cacheManager.set("some-key", someValue);
\```

### Configuration Options
Create a `GoblinCacheOptions` object to configure GoblinCache:
\```typescript
const options: GoblinCacheOptions = {
  memLOptions: { batchSize: 1, maxBatches: 50, timeoutMs: 0 },
  dbLOptions: { batchSize: 50, maxBatches: 5, timeoutMs: 200 },
  hvLOptions: { batchSize: 10, maxBatches: 6, timeoutMs: 50 },
  dbOptions: { dbName: 'blobDb', objectStore: 'objectStore' },
  spawn: () => new Worker(),
  memoryLimit: 500,
};
\```

### Web Worker
Provide your custom Web Worker through the `spawn` option for the custom worker layer.

## API

### GoblinCache
- `getInstance(options: GoblinCacheOptions)`: Gets a singleton instance of the cache manager.
- `get(key: string)`: Retrieves a value by key from the cache.
- `set(key: string, value: any)`: Sets a key-value pair in the cache.

### ProcessingStack
- `triggerQueue()`: Triggers the queue for processing.

### HarvesterPool
- `harvest(paths: string[])`: Executes worker tasks based on the given paths.

## Contributing
Please read CONTRIBUTING.md for details.

## License
This project is licensed under the MIT License. See the LICENSE.md file for details.
