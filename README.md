# locksmith

> Formerly known as `proper-lockfile`. This is a modern, robust, and cross-platform file locking utility for Node.js. The project was renamed and updated after 6 years of stability and improvements.

[![NPM version][npm-image]][npm-url] [![Downloads][downloads-image]][npm-url] [![Build Status][travis-image]][travis-url] [![Coverage Status][codecov-image]][codecov-url] [![Dependency status][david-dm-image]][david-dm-url] [![Dev Dependency status][david-dm-dev-image]][david-dm-dev-url]

[npm-url]:https://npmjs.org/package/locksmith
[downloads-image]:https://img.shields.io/npm/dm/locksmith.svg
[npm-image]:https://img.shields.io/npm/v/locksmith.svg
[travis-url]:https://travis-ci.org/blazeinstall/LockSmith
[travis-image]:https://img.shields.io/travis/blazeinstall/LockSmith/main.svg
[codecov-url]:https://codecov.io/gh/blazeinstall/LockSmith
[codecov-image]:https://img.shields.io/codecov/c/github/blazeinstall/LockSmith/main.svg
[david-dm-url]:https://david-dm.org/blazeinstall/LockSmith
[david-dm-image]:https://img.shields.io/david/blazeinstall/LockSmith.svg
[david-dm-dev-url]:https://david-dm.org/blazeinstall/LockSmith?type=dev
[david-dm-dev-image]:https://img.shields.io/david/dev/blazeinstall/LockSmith.svg

An inter-process and inter-machine lockfile utility that works on a local or network file system.


## Installation

`$ npm install locksmith`


## Design

There are various ways to achieve [file locking](http://en.wikipedia.org/wiki/File_locking).

This library utilizes the `mkdir` strategy which works atomically on any kind of file system, even network based ones.
The lockfile path is based on the file path you are trying to lock by suffixing it with `.lock`.

When a lock is successfully acquired, the lockfile's `mtime` (modified time) is periodically updated to prevent staleness. This allows to effectively check if a lock is stale by checking its `mtime` against a stale threshold. If the update of the mtime fails several times, the lock might be compromised. The `mtime` is [supported](http://en.wikipedia.org/wiki/Comparison_of_file_systems) in almost every `filesystem`.


### Comparison

This library is similar to [lockfile](https://github.com/isaacs/lockfile) but the latter has some drawbacks:

- It relies on `open` with `O_EXCL` flag which has problems in network file systems. `locksmith` uses `mkdir` which doesn't have this issue.

> O_EXCL is broken on NFS file systems; programs which rely on it for performing locking tasks will contain a race condition.

- The lockfile staleness check is done via `ctime` (creation time) which is unsuitable for long running processes. `locksmith` constantly updates lockfiles `mtime` to do proper staleness check.

- It does not check if the lockfile was compromised which can lead to undesirable situations. `locksmith` checks the lockfile when updating the `mtime`.

- It has a default value of `0` for the stale option which isn't good because any crash or process kill that the package can't handle gracefully will leave the lock active forever.


### Compromised

`locksmith` does not detect cases in which:

- A `lockfile` is manually removed and someone else acquires the lock right after
- Different `stale`/`update` values are being used for the same file, possibly causing two locks to be acquired on the same file

`locksmith` detects cases in which:

- Updates to the `lockfile` fail
- Updates take longer than expected, possibly causing the lock to become stale for a certain amount of time


As you see, the first two are a consequence of bad usage. Technically, it was possible to detect the first two but it would introduce complexity and eventual race conditions.


## Usage

### .lock(file, [options])

Tries to acquire a lock on `file` or rejects the promise on error.

If the lock succeeds, a `release` function is provided that should be called when you want to release the lock. The `release` function also rejects the promise on error (e.g. when the lock was already compromised).

Available options:

- `stale`: Duration in milliseconds in which the lock is considered stale, defaults to `10000` (minimum value is `5000`)
- `update`: The interval in milliseconds in which the lockfile's `mtime` will be updated, defaults to `stale/2` (minimum value is `1000`, maximum value is `stale/2`)
- `retries`: The number of retries or a [retry](https://www.npmjs.org/package/retry) options object, defaults to `0`
- `realpath`: Resolve symlinks using realpath, defaults to `true` (note that if `true`, the `file` must exist previously)
- `fs`: A custom fs to use, defaults to `graceful-fs`
- `onCompromised`: Called if the lock gets compromised, defaults to a function that simply throws the error which will probably cause the process to die
- `lockfilePath`: Custom lockfile path. e.g.: If you want to lock a directory and create the lock file inside it, you can pass `file` as `<dir path>` and `options.lockfilePath` as `<dir path>/dir.lock`


```js
const locksmith = require('locksmith');

locksmith.lock('some/file')
.then((release) => {
    // Do something while the file is locked

    // Call the provided release function when you're done,
    // which will also return a promise
    return release();
})
.catch((e) => {
    // either lock could not be acquired
    // or releasing it failed
    console.error(e)
});

// Alternatively, you may use locksmith('some/file') directly.
```


### .unlock(file, [options])

Releases a previously acquired lock on `file` or rejects the promise on error.

Whenever possible you should use the `release` function instead (as exemplified above). Still there are cases in which it's hard to keep a reference to it around code. In those cases `unlock()` might be handy.

Available options:

- `realpath`: Resolve symlinks using realpath, defaults to `true` (note that if `true`, the `file` must exist previously)
- `fs`: A custom fs to use, defaults to `graceful-fs`
- `lockfilePath`: Custom lockfile path. e.g.: If you want to lock a directory and create the lock file inside it, you can pass `file` as `<dir path>` and `options.lockfilePath` as `<dir path>/dir.lock`


```js
const locksmith = require('locksmith');

locksmith.lock('some/file')
.then(() => {
    // Do something while the file is locked

    // Later..
    return locksmith.unlock('some/file');
});
```

### .check(file, [options])

Check if the file is locked and its lockfile is not stale, rejects the promise on error.

Available options:

- `stale`: Duration in milliseconds in which the lock is considered stale, defaults to `10000` (minimum value is `5000`)
- `realpath`: Resolve symlinks using realpath, defaults to `true` (note that if `true`, the `file` must exist previously)
- `fs`: A custom fs to use, defaults to `graceful-fs`
- `lockfilePath`: Custom lockfile path. e.g.: If you want to lock a directory and create the lock file inside it, you can pass `file` as `<dir path>` and `options.lockfilePath` as `<dir path>/dir.lock`


```js
const locksmith = require('locksmith');

locksmith.check('some/file')
.then((isLocked) => {
    // isLocked will be true if 'some/file' is locked, false otherwise
});
```

### .lockSync(file, [options])

Sync version of `.lock()`.   
Returns the `release` function or throws on error.

### .unlockSync(file, [options])

Sync version of `.unlock()`.   
Throws on error.

### .checkSync(file, [options])

Sync version of `.check()`.
Returns a boolean or throws on error.


## Graceful exit

`locksmith` automatically removes locks if the process exits, except if the process is killed with SIGKILL or it crashes due to a VM fatal error (e.g.: out of memory).


## Tests

`$ npm test`   
`$ npm test -- --watch` during development

The test suite is very extensive. There's even a stress test to guarantee exclusiveness of locks.

**Note:** On Windows, tests involving symbolic links (symlinks) are automatically skipped due to platform limitations. Creating symlinks on Windows requires special permissions (Administrator or Developer Mode enabled), which are not always available. This does not affect the core functionality of the library on Windows.


## License

Released under the [MIT License](https://www.opensource.org/licenses/mit-license.php).


## FAQ

### Why do locks sometimes take longer than expected to acquire with many concurrent processes?

By default, `locksmith` uses a conservative retry/backoff strategy when a lock is already held. If you have many processes trying to acquire the same lock at the same time, and each process only holds the lock for a very short time (e.g., a few milliseconds), the default retry intervals may cause other processes to wait much longer than expected before acquiring the lock.

**Solution:**
You can pass custom retry options to make retries more aggressive and reduce wait time. For example:

```js
const locksmith = require('locksmith');

const release = await locksmith.lock('file', {
  retries: { retries: 20, minTimeout: 1, maxTimeout: 5 }
});
```

See the [retry](https://www.npmjs.com/package/retry) package for all available options.

If you need high-concurrency, short-lived locks, always tune the `retries` option to match your use case.

### Why do I get "TypeError: method is not a function" when composing or wrapping release functions?

The release function returned by `locksmith.lock()` must be called as a function. If you wrap or compose release functions, ensure you do not accidentally overwrite or lose the function reference. For example:

```js
const release = await locksmith.lock('file');
const wrappedRelease = () => {
  // custom logic
  release();
};
```

If you see this error, double-check your function references and ensure you are not overwriting the release function.

### Why do I get "ENOENT: no such file or directory" when locking a file in /tmp on macOS (or similar errors on Windows)?

By default, `locksmith` uses `realpath: true`, which means it tries to resolve the full path of the file you want to lock. On macOS, `/tmp` is a symlink to `/private/tmp`, so if the file does not exist yet, `fs.realpath` will fail with ENOENT.

**Workarounds:**
- If you want to lock a file that does not exist yet, set `realpath: false`:
  ```js
  const release = await locksmith.lock('/tmp/myfile', { realpath: false });
  ```
- If you want to ensure you are locking the real file, create the file first:
  ```js
  fs.writeFileSync('/tmp/myfile', '');
  const release = await locksmith.lock('/tmp/myfile');
  ```

**Drawbacks of `realpath: false`:**
- You may lock a symlink rather than the real file.
- Different processes using different paths (e.g., `/tmp/foo` vs `/private/tmp/foo`) may not coordinate.

**Summary:**  
Use `realpath: false` if you need to lock a file that does not exist yet, but be aware of symlink and path resolution issues.

### Why can I still write to a file while it is locked with locksmith?

`locksmith` implements **advisory locking**. This means that only processes using this library (or another that respects the same lockfile convention) will honor the lock. The operating system does **not** enforce the lock at the file system level.

If you open the file in another program (e.g., Notepad, or use `fs.writeFileSync` directly), you can still write to the file, even if it is locked by `locksmith`. This is because Node.js and most file systems do not support mandatory file locks.

**Best practice:**  
Ensure that all processes that need to coordinate access to a file use `locksmith` (or a compatible advisory locking mechanism).

**References:**  
- [Understanding Node.js file locking (A. Evans, 2022)](https://alexevans.co.uk/2022/01/understanding-nodejs-file-locking/)

### Why can't I kill a Node.js process with Ctrl-C or SIGTERM when using locksmith in debug mode?

`locksmith` uses the [`signal-exit`](https://github.com/tapjs/signal-exit) package to clean up locks on process exit. There is a known limitation in Node.js debug mode (`--inspect` or `--inspect-brk`), where signal handlers may not fire as expected, preventing the process from exiting cleanly with Ctrl-C or SIGTERM. This is due to how Node.js handles signals in debug mode and is not specific to `locksmith` or `signal-exit`.

Recent versions of `signal-exit` have made improvements, but this limitation may still persist in some debug scenarios. If you encounter this issue, consider the following workarounds:
- Avoid using `locksmith` in debug sessions if possible.
- Manually clean up and exit the process if you need to debug.

**Status:**
This is a known limitation of Node.js signal handling in debug mode. Track the [`signal-exit`](https://github.com/tapjs/signal-exit) repository for updates.
