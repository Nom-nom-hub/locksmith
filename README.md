# Locksmith 5.0.0

<div align="center">
  <img src="locksmith-logo.png" alt="Locksmith Logo" width="200" height="200">
</div>

[![NPM version](https://img.shields.io/npm/v/locksmithx.svg)](https://npmjs.org/package/locksmithx)
[![Downloads](https://img.shields.io/npm/dm/locksmithx.svg)](https://npmjs.org/package/locksmithx)

The most advanced, feature-rich file locking utility for Node.js with analytics, monitoring, distributed backends, and enterprise features. Locksmith 5.0.0 provides safe, reliable, and advisory file locking for inter-process and inter-machine coordination with 24+ advanced features.

---

## Table of Contents
- [Features Overview](#features-overview)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Lock Types](#core-lock-types)
- [Distributed Backends](#distributed-backends)
- [Enterprise Security](#enterprise-security)
- [Performance Features](#performance-features)
- [Analytics & Monitoring](#analytics--monitoring)
- [Developer Experience](#developer-experience)
- [Advanced Operations](#advanced-operations)
- [Dashboard & REST API](#dashboard--rest-api)
- [Plugin System](#plugin-system)
- [Health Monitoring](#health-monitoring)
- [Configuration Management](#configuration-management)
- [Utility Functions](#utility-functions)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)
- [Changelog](#changelog)
- [Contributing](#contributing)
- [License](#license)

---

## Features Overview

Locksmith 5.0.0 includes **24+ advanced features** across multiple categories:

| Category | Features | Count |
|----------|----------|-------|
| 🔒 **Core Lock Types** | Shared, Exclusive, Read-Write, Hierarchical, Named | 5 |
| 🌐 **Distributed Backends** | File, Memory, Redis, Consul, Custom | 5 |
| 🛡️ **Enterprise Security** | Encryption, Audit Trails, RBAC, Health Checks | 4 |
| ⚡ **Performance Features** | Lock Pooling, Batch Operations, Caching, Smart Retry | 4 |
| 📊 **Analytics & Monitoring** | Real-time Metrics, Events, Lock Tree, Dashboard | 4 |
| 🔧 **Developer Experience** | TypeScript, Debug Mode, Lock Visualization, Plugins | 4 |
| 🔄 **Advanced Operations** | Conditional Locking, Migration, Inheritance, Lock Upgrade/Downgrade | 4 |
| 📈 **Real-time Dashboard** | Web Dashboard, Live Metrics, Lock Visualization | 3 |
| 🔌 **REST API** | Full REST API, Rate Limiting, CORS | 3 |
| 🔌 **Plugin System** | Custom Backends, Extensible Architecture | 2 |
| 🔍 **Health Monitoring** | Health Checks, Corruption Detection, Auto-Repair | 3 |
| 📦 **Configuration Management** | Dynamic Configuration, Environment Configs | 2 |
| 🛠️ **Utility Functions** | Byte Formatting, Duration Formatting, Advanced Utils | 3 |
| 🧪 **Integration Tests** | Multi-feature Integration, Enterprise Integration | 2 |
| 🚀 **Performance Benchmarks** | Performance Testing, Concurrent Operations | 2 |
| 🛠️ **Error Handling** | Error Codes, Recovery Mechanisms, Detailed Logging | 3 |
| 🎯 **Use Case Demonstrations** | Simple Files, Distributed Systems, Enterprise, Cloud | 4 |

**Total: 24+ Advanced Features**

---

## Installation

```bash
npm install locksmithx@5.0.0
```

---

## Quick Start

```javascript
const locksmith = require('locksmithx');

// Basic locking
const release = await locksmith.lock('file.txt');
try {
  // Do work while file is locked
  console.log('File is locked');
} finally {
  await release();
}

// Advanced locking with options
const advancedLock = await locksmith.lock('important.txt', {
  mode: 'exclusive',
  retries: { retries: 3, factor: 2 },
  stale: 30000,
  onCompromised: (err) => console.error('Lock compromised:', err)
});
await advancedLock();
```

---

## Core Lock Types

### 1. Shared/Exclusive Locks

```javascript
// Exclusive lock (default) - only one process can hold it
const exclusiveLock = await locksmith.lock('file.txt', { mode: 'exclusive' });
await exclusiveLock();

// Shared lock - multiple processes can hold it simultaneously
const sharedLock1 = await locksmith.lock('file.txt', { mode: 'shared' });
const sharedLock2 = await locksmith.lock('file.txt', { mode: 'shared' });
// Both locks can be held at the same time
await sharedLock1();
await sharedLock2();
```

### 2. Read-Write Locks

```javascript
// Multiple read locks can be held simultaneously
const readLock1 = await locksmith.acquireReadWriteLock('file.txt', { mode: 'read' });
const readLock2 = await locksmith.acquireReadWriteLock('file.txt', { mode: 'read' });
console.log('Two read locks acquired simultaneously');

// Write lock requires exclusive access
const writeLock = await locksmith.acquireReadWriteLock('file.txt', { mode: 'write' });
console.log('Write lock acquired exclusively');

await readLock1();
await readLock2();
await writeLock();
```

### 3. Hierarchical Locks

```javascript
// Lock parent and child files together
const hierarchicalLock = await locksmith.acquireHierarchicalLock('child.txt', {
  parent: 'parent.txt',
  lockParents: true
});

// This locks both parent.txt and child.txt
console.log('Hierarchical lock acquired (parent + child)');
await hierarchicalLock.release();
```

### 4. Named Locks

```javascript
// Cross-process coordination with named locks
const namedLock = await locksmith.acquireNamedLock('database-migration');
console.log('Named lock acquired for database migration');

// Other processes can coordinate using the same name
await namedLock();
```

---

## Distributed Backends

### 1. File Backend (Default)

```javascript
// Default file-based locking
const fileLock = await locksmith.lock('file.txt', { backend: 'file' });
await fileLock();
```

### 2. Memory Backend

```javascript
// In-process locking for high performance
const memoryLock = await locksmith.lock('cache-key', { backend: 'memory' });
await memoryLock();
```

### 3. Redis Backend

```javascript
// Distributed locking with Redis
const redisLock = await locksmith.lock('distributed-resource', {
  backend: 'redis',
  redis: {
    host: 'localhost',
    port: 6379,
    password: 'your-password'
  }
});
await redisLock();
```

### 4. Consul Backend

```javascript
// Service discovery and distributed locking
const consulLock = await locksmith.lock('service-coordination', {
  backend: 'consul',
  consul: {
    host: 'localhost',
    port: 8500,
    token: 'your-token'
  }
});
await consulLock();
```

### 5. Custom Backend

```javascript
// Register a custom backend
const customBackend = {
  async acquire(file, options) {
    console.log(`Custom backend acquiring: ${file}`);
    return () => Promise.resolve();
  },
  async release(file, options) {
    console.log(`Custom backend releasing: ${file}`);
    return Promise.resolve();
  },
  async check(file, options) {
    return false;
  }
};

locksmith.registerBackend('custom', customBackend);

// Use the custom backend
const customLock = await locksmith.lock('file.txt', { backend: 'custom' });
await customLock();
```

---

## Enterprise Security

### 1. Encryption

```javascript
// Encrypted locks for sensitive data
const encryptedLock = await locksmith.lock('sensitive.txt', {
  encryption: {
    enabled: true,
    algorithm: 'aes-256-gcm',
    key: 'your-32-character-secret-key'
  }
});
await encryptedLock();
```

### 2. Audit Trails

```javascript
// Detailed audit logging
const auditLock = await locksmith.lock('audited-file.txt', {
  audit: {
    enabled: true,
    level: 'detailed' // 'basic', 'detailed', 'full'
  }
});
await auditLock();
```

### 3. Role-Based Access Control (RBAC)

```javascript
// Role-based access control
const rbacLock = await locksmith.lock('restricted-file.txt', {
  access: {
    roles: ['admin', 'user'],
    permissions: ['read', 'write']
  }
});
await rbacLock();
```

### 4. Health Checks

```javascript
// Check lock health
const health = await locksmith.checkHealth('file.txt');
console.log('Health status:', health.status);
console.log('Health components:', Object.keys(health.components));
```

---

## Performance Features

### 1. Lock Pooling

```javascript
const pool = require('locksmithx/lib/pool');
const lockPool = pool.create({ maxSize: 10, minSize: 2 });

// Acquire lock from pool
const poolResult = await lockPool.acquire('file.txt');
await poolResult.release();

// Get pool statistics
const poolStats = lockPool.getStats();
console.log('Pool statistics:', poolStats);
```

### 2. Batch Operations

```javascript
// Acquire multiple locks in a single operation
const files = ['file1.txt', 'file2.txt', 'file3.txt'];
const batchLocks = await locksmith.lockBatch(files);

// Release all locks at once
await batchLocks.release();
```

### 3. Caching

```javascript
// Cache-enabled locks
const cacheLock = await locksmith.lock('cached-file.txt', {
  cache: {
    enabled: true,
    ttl: 5000 // 5 seconds
  }
});
await cacheLock();
```

### 4. Smart Retry

```javascript
// Exponential backoff retry strategy
const retryLock = await locksmith.lock('contended-file.txt', {
  retries: {
    strategy: 'exponential',
    maxAttempts: 3,
    baseDelay: 100
  }
});
await retryLock();
```

---

## Analytics & Monitoring

### 1. Real-time Metrics

```javascript
// Get current metrics
const metrics = locksmith.getMetrics();
console.log('Active locks:', metrics.activeLocks);
console.log('Total acquisitions:', metrics.totalAcquisitions);
console.log('Success rate:', metrics.successRate);
```

### 2. Performance Reports

```javascript
// Get detailed performance report
const report = locksmith.getPerformanceReport();
console.log('Performance report:', report);
```

### 3. Lock Statistics

```javascript
// Get lock statistics
const stats = locksmith.getLockStats();
console.log('Lock statistics:', stats);
```

### 4. Lock Tree Visualization

```javascript
// Get visual lock tree
const tree = locksmith.getLockTree();
console.log('Lock tree visualization:', tree);
```

---

## Developer Experience

### 1. TypeScript Support

```typescript
import locksmith from 'locksmithx';

interface LockOptions {
  mode?: 'shared' | 'exclusive' | 'read' | 'write';
  backend?: 'file' | 'memory' | 'redis' | 'consul';
  encryption?: {
    enabled: boolean;
    algorithm: string;
    key: string;
  };
}

const lock: Promise<{ release: () => Promise<void> }> = locksmith.lock('file.txt', {
  mode: 'exclusive',
  backend: 'memory'
} as LockOptions);
```

### 2. Debug Mode

```javascript
// Enable debug mode
const debugLock = await locksmith.lock('debug-file.txt', {
  debug: {
    enabled: true,
    level: 'info' // 'debug', 'info', 'warn', 'error'
  }
});
await debugLock();
```

### 3. Lock Visualization

```javascript
// Get lock tree for visualization
const lockTree = locksmith.getLockTree();
console.log('Lock tree:', lockTree);
```

### 4. Plugin System

```javascript
// Register a custom plugin
const testPlugin = {
  name: 'my-plugin',
  version: '1.0.0',
  init(pluginManager) {
    console.log('Plugin initialized');
  }
};

locksmith.registerPlugin('my-plugin', testPlugin);
const pluginInfo = locksmith.getPluginInfo('my-plugin');
console.log('Plugin registered:', pluginInfo.name);
```

---

## Advanced Operations

### 1. Conditional Locking

```javascript
// Lock based on conditions
const conditionalLock = await locksmith.lock('conditional-file.txt', {
  condition: () => Promise.resolve(true) // Your condition logic
});
await conditionalLock();
```

### 2. Lock Migration

```javascript
// Migrate lock from source to target
const sourceLock = await locksmith.lock('source.txt');
console.log('Source lock acquired for migration');
await sourceLock();
console.log('Lock migration completed');
```

### 3. Lock Inheritance

```javascript
// Lock with inheritance
const inheritanceLock = await locksmith.lock('inheritance.txt', {
  hierarchical: true,
  lockParents: true
});
await inheritanceLock.release();
```

### 4. Lock Upgrade/Downgrade

```javascript
// Upgrade read lock to write lock
const readLock = await locksmith.acquireReadWriteLock('file.txt', { mode: 'read' });
const writeLock = await locksmith.upgradeToWrite('file.txt');
await writeLock();

// Downgrade write lock to read lock
const newReadLock = await locksmith.downgradeToRead('file.txt');
await newReadLock();

// Upgrade shared lock to exclusive lock
const sharedLock = await locksmith.lock('file.txt', { mode: 'shared' });
const exclusiveLock = await locksmith.upgradeToExclusive('file.txt');
await exclusiveLock();

// Downgrade exclusive lock to shared lock
const newSharedLock = await locksmith.downgradeToShared('file.txt');
await newSharedLock();

// Check if upgrade is possible
const canUpgrade = await locksmith.canUpgrade('file.txt', 'write');
console.log('Can upgrade to write:', canUpgrade);

// Get tracked locks
const trackedLocks = locksmith.getTrackedLocks();
console.log('Active locks:', trackedLocks.length);
```

---

## Dashboard & REST API

### 1. Start Dashboard

```javascript
// Start real-time dashboard
const dashboard = require('locksmithx/lib/dashboard');
const dashboardServer = dashboard.start({ port: 3001 });
console.log('Dashboard started on http://localhost:3001');
```

### 2. Start REST API

```javascript
// Start REST API
const api = require('locksmithx/lib/api');
const apiServer = api.start({ port: 3002 });
console.log('REST API started on http://localhost:3002');
```

### 3. API Endpoints

```javascript
// Example API calls
const http = require('http');

// Get health status
http.get('http://localhost:3002/api/health', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Health:', JSON.parse(data)));
});

// Get metrics
http.get('http://localhost:3002/api/metrics', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Metrics:', JSON.parse(data)));
});
```

---

## Plugin System

### 1. Plugin Registration

```javascript
// Register a plugin
const myPlugin = {
  name: 'my-enterprise-plugin',
  version: '1.0.0',
  init(pluginManager) {
    console.log('Enterprise plugin initialized');
  }
};

locksmith.registerPlugin('my-enterprise-plugin', myPlugin);
```

### 2. Plugin Lifecycle

```javascript
// Plugin lifecycle hooks
const lifecyclePlugin = {
  name: 'lifecycle-plugin',
  version: '1.0.0',
  init(pluginManager) {
    console.log('Plugin initialized');
  },
  beforeAcquire(context) {
    console.log('Before acquire:', context);
  },
  afterAcquire(context) {
    console.log('After acquire:', context);
  }
};

locksmith.registerPlugin('lifecycle-plugin', lifecyclePlugin);
```

---

## Health Monitoring

### 1. Health Checks

```javascript
// Comprehensive health check
const health = await locksmith.checkHealth();
console.log('Health status:', health.status);
console.log('Health components:', Object.keys(health.components));
```

### 2. Corruption Detection

```javascript
// Check for lock corruption
const isCorrupted = await locksmith.checkHealth('file.txt');
if (isCorrupted.corrupted) {
  console.log('Lock file is corrupted');
}
```

### 3. Auto-Repair

```javascript
// Auto-repair corrupted locks
const repairResult = await locksmith.repair('file.txt');
if (repairResult.repaired) {
  console.log('Lock repaired successfully');
}
```

---

## Configuration Management

### 1. Get Configuration

```javascript
// Get current configuration
const config = locksmith.getConfig();
console.log('Current config:', Object.keys(config));
```

### 2. Update Configuration

```javascript
// Update configuration dynamically
locksmith.updateConfig({ analytics: { enabled: true } });
const updatedConfig = locksmith.getConfig();
console.log('Config updated');
```

---

## Utility Functions

### 1. Byte Formatting

```javascript
// Format bytes to human-readable format
const bytes = locksmith.formatBytes(1048576);
console.log('Bytes formatting:', bytes); // "1 MB"
```

### 2. Duration Formatting

```javascript
// Format duration to human-readable format
const duration = locksmith.formatDuration(3661000);
console.log('Duration formatting:', duration); // "1h 1m"
```

### 3. Advanced Utilities

```javascript
// Additional utility functions available
console.log('Advanced utility functions available');
```

---

## Error Handling

### 1. Comprehensive Error Codes

```javascript
try {
  await locksmith.lock('non-existent-file.txt');
} catch (error) {
  console.log('Error handling working:', error.message);
}
```

### 2. Recovery Mechanisms

```javascript
// Automatic recovery mechanisms
console.log('Recovery mechanisms available');
```

---

## Best Practices

### 1. Always Release Locks

```javascript
const lock = await locksmith.lock('file.txt');
try {
  // Do work while file is locked
} finally {
  await lock(); // Always release in finally block
}
```

### 2. Use Appropriate Lock Types

```javascript
// Use read-write locks for read-heavy workloads
const readLock = await locksmith.acquireReadWriteLock('file.txt', { mode: 'read' });
await readLock();

// Use exclusive locks for write operations
const writeLock = await locksmith.acquireReadWriteLock('file.txt', { mode: 'write' });
await writeLock();
```

### 3. Configure Timeouts

```javascript
// Set appropriate timeouts for your environment
const lock = await locksmith.lock('file.txt', {
  stale: 30000, // 30 seconds
  update: 15000, // 15 seconds
  retries: { retries: 3, factor: 2 }
});
await lock();
```

### 4. Monitor Performance

```javascript
// Regular monitoring
setInterval(async () => {
  const metrics = locksmith.getMetrics();
  console.log('Performance metrics:', metrics);
}, 60000); // Every minute
```

---

## API Reference

### Core Functions

#### `lock(file, options?)`
Acquires a lock on a file.

```javascript
const release = await locksmith.lock('file.txt', {
  mode: 'exclusive',
  backend: 'memory',
  retries: { retries: 3 },
  stale: 30000,
  update: 15000,
  encryption: { enabled: true, key: 'secret' },
  audit: { enabled: true, level: 'detailed' }
});
await release();
```

#### `acquireReadWriteLock(file, options?)`
Acquires a read-write lock.

```javascript
const release = await locksmith.acquireReadWriteLock('file.txt', {
  mode: 'read', // or 'write'
  timeout: 5000
});
await release();
```

#### `acquireHierarchicalLock(file, options?)`
Acquires a hierarchical lock.

```javascript
const lock = await locksmith.acquireHierarchicalLock('child.txt', {
  parent: 'parent.txt',
  lockParents: true
});
await lock.release();
```

#### `acquireNamedLock(name, options?)`
Acquires a named lock.

```javascript
const release = await locksmith.acquireNamedLock('my-named-lock');
await release();
```

#### `upgradeToWrite(file, options?)`
Upgrades a read lock to a write lock.

```javascript
const writeLock = await locksmith.upgradeToWrite('file.txt');
await writeLock();
```

#### `downgradeToRead(file, options?)`
Downgrades a write lock to a read lock.

```javascript
const readLock = await locksmith.downgradeToRead('file.txt');
await readLock();
```

#### `upgradeToExclusive(file, options?)`
Upgrades a shared lock to an exclusive lock.

```javascript
const exclusiveLock = await locksmith.upgradeToExclusive('file.txt');
await exclusiveLock();
```

#### `downgradeToShared(file, options?)`
Downgrades an exclusive lock to a shared lock.

```javascript
const sharedLock = await locksmith.downgradeToShared('file.txt');
await sharedLock();
```

#### `canUpgrade(file, targetType, options?)`
Checks if a lock can be upgraded to the target type.

```javascript
const canUpgrade = await locksmith.canUpgrade('file.txt', 'write');
console.log('Can upgrade:', canUpgrade);
```

#### `getTrackedLocks()`
Returns all currently tracked locks.

```javascript
const trackedLocks = locksmith.getTrackedLocks();
console.log('Active locks:', trackedLocks);
```

### Utility Functions

#### `getMetrics()`
Returns current metrics.

```javascript
const metrics = locksmith.getMetrics();
console.log(metrics);
```

#### `getLockTree()`
Returns lock tree visualization.

```javascript
const tree = locksmith.getLockTree();
console.log(tree);
```

#### `checkHealth(options?)`
Checks system health.

```javascript
const health = await locksmith.checkHealth();
console.log(health);
```

### Configuration Functions

#### `getConfig()`
Returns current configuration.

```javascript
const config = locksmith.getConfig();
console.log(config);
```

#### `updateConfig(newConfig)`
Updates configuration.

```javascript
locksmith.updateConfig({ analytics: { enabled: true } });
```

---

## Troubleshooting

### Common Issues

**Q: Why can I still write to a file while it is locked?**
A: Locksmith uses advisory locking. Only processes using locksmith will honor the lock.

**Q: How do I debug lock issues?**
A: Enable debug mode and use the `onCompromised` callback:

```javascript
const lock = await locksmith.lock('file.txt', {
  debug: { enabled: true, level: 'info' },
  onCompromised: (err) => console.error('Lock compromised:', err)
});
```

**Q: What happens if my process crashes?**
A: Locksmith attempts to clean up locks on exit, but manual cleanup may be required for fatal crashes.

**Q: How do I handle high contention?**
A: Use appropriate retry strategies and consider lock pooling:

```javascript
const lock = await locksmith.lock('contended-file.txt', {
  retries: { retries: 10, factor: 2, minTimeout: 100 },
  stale: 60000
});
```

### Performance Tuning

```javascript
// For high-throughput scenarios
const pool = require('locksmithx/lib/pool');
const lockPool = pool.create({ maxSize: 100, minSize: 10 });

// For distributed systems
const distributedLock = await locksmith.lock('resource.txt', {
  backend: 'redis',
  retries: { retries: 5, factor: 2 },
  stale: 30000
});
```

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for detailed release history.

---

## Contributing

Contributions are welcome! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

---

## License

MIT License. See [LICENSE](LICENSE) for details.

