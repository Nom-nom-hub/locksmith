# Locksmith

[![NPM version](https://img.shields.io/npm/v/locksmithx.svg)](https://npmjs.org/package/locksmithx)
[![Downloads](https://img.shields.io/npm/dm/locksmithx.svg)](https://npmjs.org/package/locksmithx)

A modern, robust, and cross-platform file locking utility for Node.js, written in JavaScript and released under the [MIT License](LICENSE). Locksmith provides safe, reliable, and advisory file locking for inter-process and inter-machine coordination.

---

## Table of Contents
- [Philosophy & Motivation](#philosophy--motivation)
- [Features](#features)
- [Comparison with Alternatives](#comparison-with-alternatives)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Usage](#usage)
- [Advanced Usage](#advanced-usage)
- [API Reference](#api-reference)
- [Best Practices](#best-practices)
- [Troubleshooting & FAQ](#troubleshooting--faq)
- [Security Considerations](#security-considerations)
- [Changelog & Versioning](#changelog--versioning)
- [Contributing](#contributing)
- [Community & Support](#community--support)
- [Acknowledgements](#acknowledgements)
- [License](#license)

---

## Philosophy & Motivation
Locksmith was created to provide a truly reliable, cross-platform, and easy-to-use file locking solution for Node.js. Unlike many alternatives, it is designed to work seamlessly on local and network filesystems, handle process crashes gracefully, and offer both async and sync APIs. The goal is to make file locking simple, safe, and robust for all Node.js developers.

---

## Features
- Cross-platform file locking (Windows, Linux, macOS, network filesystems)
- Uses atomic `mkdir` strategy for reliability
- Staleness detection and automatic lock refreshing
- Async and sync APIs
- Customizable retry, staleness, and update intervals
- Handles process crashes and cleans up locks on exit
- Lightweight, zero dependencies for core functionality

---

## Comparison with Alternatives
| Library            | Cross-Platform | Staleness Detection | Handles Crashes | Sync API | Custom FS |
|--------------------|----------------|--------------------|----------------|----------|-----------|
| **Locksmith**      | Yes            | Yes                | Yes            | Yes      | Yes       |
| proper-lockfile    | Yes            | Yes                | Partial        | Yes      | Yes       |
| lockfile           | Partial        | Partial             | No             | No       | No        |

Locksmith stands out for its reliability, modern API, and robust handling of edge cases.

---

## Installation

```sh
npm install locksmithx
```

---

## Quick Start

```js
const locksmith = require('locksmithx');

(async () => {
  // Acquire a lock on a file
  const release = await locksmith.lock('some/file');
  try {
    // Do something while the file is locked
  } finally {
    // Always release the lock
    await release();
  }
})();
```

---

## Usage

### Locking a File

```js
const release = await locksmith.lock('path/to/file', {
  stale: 15000, // ms before lock is considered stale (default: 10000)
  update: 5000, // ms between lockfile mtime updates (default: stale/2)
  retries: 3,   // number of retries or retry options (default: 0)
  onCompromised: (err) => {
    console.error('Lock compromised:', err);
  },
});
// ... do work ...
await release();
```

### Unlocking a File

```js
await locksmith.unlock('path/to/file');
```

### Checking Lock Status

```js
const isLocked = await locksmith.check('path/to/file');
console.log(isLocked ? 'Locked' : 'Unlocked');
```

### Synchronous API

```js
const release = locksmith.lockSync('path/to/file');
// ... do work ...
release();
```

---

## Advanced Usage

### Custom Lockfile Path
```js
await locksmith.lock('mydir', { lockfilePath: 'mydir/my.lock' });
```

### Using a Custom File System
```js
const fs = require('fs-extra');
await locksmith.lock('file', { fs });
```

### Handling Lock Contention
```js
await locksmith.lock('file', { retries: { retries: 10, minTimeout: 100, maxTimeout: 1000 } });
```

### Distributed/Clustered Environments
Locksmith is suitable for use on network filesystems (NFS, SMB, etc.) and in clustered Node.js deployments. Tune `stale` and `update` for your environment.

---

## API Reference

### `lock(file, [options])`
Acquires a lock on `file`. Returns a Promise resolving to a `release` function.
- `file` (string): Path to the file to lock.
- `options` (object):
  - `stale` (number): ms before lock is considered stale. Default: 10000.
  - `update` (number): ms between lockfile mtime updates. Default: stale/2.
  - `retries` (number|object): Number of retries or [retry](https://www.npmjs.com/package/retry) options. Default: 0.
  - `realpath` (boolean): Resolve symlinks. Default: true.
  - `fs` (object): Custom fs module. Default: graceful-fs.
  - `onCompromised` (function): Called if the lock is compromised.
  - `lockfilePath` (string): Custom lockfile path.

### `unlock(file, [options])`
Releases a lock on `file`. Returns a Promise.

### `check(file, [options])`
Checks if `file` is locked and not stale. Returns a Promise resolving to a boolean.

### `lockSync(file, [options])`
Sync version of `lock`. Returns a `release` function.

### `unlockSync(file, [options])`
Sync version of `unlock`.

### `checkSync(file, [options])`
Sync version of `check`. Returns a boolean.

---

## Best Practices
- Always release locks in a `finally` block to avoid deadlocks.
- Use the `onCompromised` option to handle unexpected lock loss.
- Tune `stale` and `update` for your workload and environment.
- Only use `realpath: false` if you need to lock files that do not exist yet (be aware of symlink issues).
- Locksmith uses advisory locking: only processes using locksmith will honor the lock.

---

## Troubleshooting & FAQ

**Q: Why can I still write to a file while it is locked?**
A: Locksmith uses advisory locking. Only processes using locksmith will honor the lock.

**Q: Why do I get ENOENT errors on macOS or Windows?**
A: By default, `realpath: true` is used. If the file does not exist, set `realpath: false` or create the file first.

**Q: How do I debug lock issues?**
A: Use the `onCompromised` callback and enable verbose logging in your application.

**Q: What happens if my process crashes?**
A: Locksmith attempts to clean up locks on exit, but if the process is killed with SIGKILL or crashes fatally, manual cleanup may be required.

---

## Security Considerations
- Locksmith implements advisory (not mandatory) locking. The OS does not enforce the lock.
- Always use the `onCompromised` callback to handle unexpected lock loss.
- Use strong staleness and update intervals for critical workloads.
- Avoid using on untrusted filesystems or with untrusted users.

---

## Changelog & Versioning
- Follows [Semantic Versioning (SemVer)](https://semver.org/)
- See [CHANGELOG.md](CHANGELOG.md) for release history.

---

## Contributing

Contributions, bug reports, and feature requests are welcome! Please open an issue or pull request on [GitHub](https://github.com/blazeinstall/LockSmith).

- Code style: Standard JS/ESLint
- Tests: Run `npm test` (uses Jest)
- Please ensure all tests pass before submitting a PR.

Maintainer: [André Cruz](mailto:andre@moxy.studio)

---

## Community & Support
- [GitHub Issues](https://github.com/blazeinstall/LockSmith/issues) for bug reports and feature requests
- For questions, contact the maintainer or open a discussion

---

## Acknowledgements
- Inspired by [proper-lockfile](https://github.com/moxystudio/node-proper-lockfile) and [lockfile](https://github.com/isaacs/lockfile)
- Thanks to all contributors and users!

---

## License

MIT License. See [LICENSE](LICENSE) for details.

