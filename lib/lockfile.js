'use strict';

const path = require('path');
const fs = require('graceful-fs');
const retry = require('retry');
const onExit = require('signal-exit');
const mtimePrecision = require('./mtime-precision');
const { mkdirp } = require('mkdirp');
const os = require('os');
const crypto = require('crypto');

const locks = {};
let exitHandler = null;

function getLockFile(file, options) {
    return options.lockfilePath || `${file}.lock`;
}

function resolveCanonicalPath(file, options, callback) {
    if (!options.realpath) {
        return callback(null, path.resolve(file));
    }

    // Use realpath to resolve symlinks
    // It also resolves relative paths
    options.fs.realpath(file, callback);
}

async function acquireLock(file, options, userCallback) {
    function callback(err, ...args) {
        if (err) {
            // Map EISDIR to ELOCKED for compatibility
            if (err.code === 'EISDIR') {
                err = Object.assign(
                    new Error(`Lock file is already being held for: ${file}. If you want to wait for the lock, use the 'retries' option.`),
                    { code: 'ELOCKED', file }
                );
            }
            // Map ENOENT after staleness retry to ELOCKED
            if (err.code === 'ENOENT' && err._fromStalenessRetry) {
                err = Object.assign(new Error('Lock file is already being held for: ' + file), { code: 'ELOCKED', file });
            }
            // For EEXIST, map to ELOCKED
            if (err.code === 'EEXIST') {
                err = Object.assign(new Error('Lock file is already being held for: ' + file), { code: 'ELOCKED', file });
            }
        }
        userCallback(err, ...args);
    }
    try {
        const lockfilePath = getLockFile(file, options);
        const dir = path.dirname(lockfilePath);
        await mkdirp(dir);
        if (options.mode === 'shared' || options.mode === 'exclusive') {
            acquireJsonLock(file, lockfilePath, options, callback);
            return;
        }
        const wfs = wrapFs(options.fs, file);
        wfs.mkdir(lockfilePath, (err) => {
            if (!err) {
                return mtimePrecision.probe(lockfilePath, wfs, (err, mtime, mtimePrecision) => {
                    if (err) {
                        wfs.rmdir(lockfilePath, () => {});
                        return callback(err);
                    }
                    callback(null, mtime, mtimePrecision);
                });
            }
            // Map EISDIR to ELOCKED for compatibility
            if (err.code === 'EISDIR') {
                return callback(Object.assign(
                    new Error(`Lock file is already being held for: ${file}. If you want to wait for the lock, use the 'retries' option.`),
                    { code: 'ELOCKED', file }
                ));
            }
            // If error is not EEXIST then some other error occurred while locking
            if (err.code !== 'EEXIST') {
                // Propagate custom fs errors as-is if not standard lockfile errors
                if (!['ENOENT', 'EEXIST', 'EISDIR'].includes(err.code)) {
                    return callback(err);
                }
                // Map ENOENT to ELOCKED
                if (err.code === 'ENOENT') {
                    return callback(Object.assign(new Error('Lock file is already being held for: ' + file), { code: 'ELOCKED', file }));
                }
                if (err.code === 'EEXIST') {
                    return callback(Object.assign(new Error('Lock file is already being held for: ' + file), { code: 'ELOCKED', file }));
                }
            }
            if (options.stale <= 0) {
                return callback(Object.assign(
                    new Error(`Lock file is already being held for: ${file}. If you want to wait for the lock, use the 'retries' option.`),
                    { code: 'ELOCKED', file }
                ));
            }
            let stalenessChecked = false;
            wfs.stat(lockfilePath, async function statCb(err, stat) {
                if (err) {
                    if (err.code === 'EISDIR') {
                        return callback(Object.assign(
                            new Error(`Lock file is already being held for: ${file}. If you want to wait for the lock, use the 'retries' option.`),
                            { code: 'ELOCKED', file }
                        ));
                    }
                    if (err.code === 'ENOENT') {
                        if (!stalenessChecked) {
                            stalenessChecked = true;
                            try {
                                await verifyStalenessWithRetry(lockfilePath, wfs, 2);
                            } catch (retryErr) {
                                if (retryErr.code === 'ENOENT') {
                                    const e = new Error('Lock file is already being held for: ' + file);
                                    e.code = 'ELOCKED';
                                    e.file = file;
                                    e._fromStalenessRetry = true;
                                    return callback(e);
                                }
                                return callback(retryErr);
                            }
                            return acquireLock(file, { ...options, stale: 0 }, callback);
                        } else {
                            const e = new Error('Lock file is already being held for: ' + file);
                            e.code = 'ELOCKED';
                            e.file = file;
                            e._fromStalenessRetry = true;
                            return callback(e);
                        }
                    }
                    // Propagate custom fs errors as-is if not standard lockfile errors
                    if (!['ENOENT', 'EEXIST', 'EISDIR'].includes(err.code)) {
                        return callback(err);
                    }
                }
                if (!isLockStale(stat, options)) {
                    return callback(Object.assign(
                        new Error(`Lock file is already being held for: ${file}. If you want to wait for the lock, use the 'retries' option.`),
                        { code: 'ELOCKED', file }
                    ));
                }
                removeLock(file, options, (err) => {
                    if (err) {
                        if (err.code === 'EISDIR') {
                            return callback(Object.assign(
                                new Error(`Lock file is already being held for: ${file}. If you want to wait for the lock, use the 'retries' option.`),
                                { code: 'ELOCKED', file }
                            ));
                        }
                        if (!['ENOENT', 'EEXIST', 'EISDIR'].includes(err.code)) {
                            return callback(err);
                        }
                    }
                    acquireLock(file, { ...options, stale: 0 }, callback);
                });
            });
        });
    } catch (err) {
        if (err && err.code === 'EISDIR') {
            err = Object.assign(
                new Error(`Lock file is already being held for: ${file}. If you want to wait for the lock, use the 'retries' option.`),
                { code: 'ELOCKED', file }
            );
        }
        userCallback(err);
    }
}

function acquireJsonLock(file, lockfilePath, options, userCallback) {
    const unique = crypto.randomBytes(8).toString('hex');
    const id = `pid:${process.pid}@${os.hostname()}:${unique}`;
    const now = Date.now();
    const mode = options.mode || 'exclusive';
    const wfs = wrapFs(options.fs, file);
    let parseAttempts = 0;
    function tryReadLockfile() {
        wfs.readFile(lockfilePath, 'utf8', (err, data) => {
            let lockData;
            if (err) {
                if (err.code === 'ENOENT') {
                    // No lockfile exists, create one
                    lockData = {
                        readers: [],
                        writer: null,
                        created: now,
                        updated: now,
                    };
                } else {
                    // PATCH: propagate custom fs errors as-is
                    return userCallback(err);
                }
            } else {
                try {
                    lockData = JSON.parse(data);
                } catch (e) {
                    if (++parseAttempts < 3) {
                        // Retry after a short delay
                        return setTimeout(tryReadLockfile, 10);
                    }
                    return userCallback(Object.assign(new Error('Corrupted lockfile'), { code: 'ECORRUPT', file }));
                }
            }
            // DEBUG: Print lock ID on acquire
            if (mode === 'shared') {
                console.log('[DEBUG] Acquiring shared lock with ID:', id);
            } else {
                console.log('[DEBUG] Acquiring exclusive lock with ID:', id);
            }

            // Remove stale readers/writer
            // (For now, just trust the file is fresh. Staleness logic can be added later.)

            if (mode === 'shared') {
                if (lockData.writer) {
                    return userCallback(Object.assign(new Error('Writer lock is held'), { code: 'ELOCKED', file }));
                }
                if (!lockData.readers.includes(id)) {
                    lockData.readers.push(id);
                }
            } else { // Exclusive
                if (lockData.writer || (lockData.readers && lockData.readers.length > 0)) {
                    return userCallback(Object.assign(new Error('Lock file is already being held'), { code: 'ELOCKED', file }));
                }
                lockData.writer = id;
            }
            lockData.updated = now;

            // Remove stale readers (dead PIDs on this host)
            if (lockData.readers && Array.isArray(lockData.readers)) {
                lockData.readers = lockData.readers.filter(r => {
                    const match = /^pid:(\d+)@([^:]+):/.exec(r);
                    if (!match) return true;
                    const [ , pidStr, host ] = match;
                    if (host !== os.hostname()) return true;
                    const pid = parseInt(pidStr, 10);
                    return isPidAlive(pid);
                });
            }

            // Write the lockfile
            wfs.writeFile(lockfilePath, JSON.stringify(lockData, null, 2), { flag: 'w' }, (err) => {
                if (err) return userCallback(err);

                // Provide a release function
                const releaseFn = (releasedCallback) => new Promise((resolve, reject) => {
                    // DEBUG: Print lock ID on release
                    if (mode === 'shared') {
                        console.log('[DEBUG] Releasing shared lock with ID:', releaseFn.lockId);
                    } else {
                        console.log('[DEBUG] Releasing exclusive lock with ID:', releaseFn.lockId);
                    }
                    // Print lockfile contents before release
                    if (wfs.existsSync(lockfilePath)) {
                        try {
                            const before = wfs.readFileSync(lockfilePath, 'utf8');
                            console.log('[DEBUG] Lockfile before release:', before);
                        } catch (e) {}
                    }
                    wfs.readFile(lockfilePath, 'utf8', (err, data) => {
                        if (err) {
                            if (releasedCallback) { releasedCallback(); }
                            return resolve();
                        }
                        let lockData;
                        try {
                            lockData = JSON.parse(data);
                        } catch (e) {
                            if (typeof releasedCallback === 'function') { releasedCallback(); }
                            return resolve();
                        }
                        if (mode === 'shared') {
                            lockData.readers = (lockData.readers || []).filter((r) => r !== releaseFn.lockId);
                        } else if (lockData.writer === releaseFn.lockId) { lockData.writer = null; }
                        lockData.updated = Date.now();
                        // If no readers or writer, remove the lockfile
                        if ((!lockData.writer) && (!lockData.readers || lockData.readers.length === 0)) {
                            // Print lockfile contents after release (will be deleted)
                            console.log('[DEBUG] Lockfile will be deleted after release.');
                            return wfs.unlink(lockfilePath, () => {
                                if (typeof releasedCallback === 'function') { releasedCallback(); }
                                resolve();
                            });
                        }
                        // Remove stale readers (dead PIDs on this host)
                        if (lockData.readers && Array.isArray(lockData.readers)) {
                            lockData.readers = lockData.readers.filter(r => {
                                const match = /^pid:(\d+)@([^:]+):/.exec(r);
                                if (!match) return true;
                                const [ , pidStr, host ] = match;
                                if (host !== os.hostname()) return true;
                                const pid = parseInt(pidStr, 10);
                                return isPidAlive(pid);
                            });
                        }
                        // Print lockfile contents after release
                        wfs.writeFile(lockfilePath, JSON.stringify(lockData, null, 2), { flag: 'w' }, () => {
                            if (wfs.existsSync(lockfilePath)) {
                                try {
                                    const after = wfs.readFileSync(lockfilePath, 'utf8');
                                    console.log('[DEBUG] Lockfile after release:', after);
                                } catch (e) {}
                            }
                            if (typeof releasedCallback === 'function') { releasedCallback(); }
                            resolve();
                        });
                    });
                });
                releaseFn.lockId = id;
                userCallback(null, releaseFn);
            });
        });
    }
    tryReadLockfile();
}

function isLockStale(stat, options) {
    return stat.mtime.getTime() < Date.now() - options.stale;
}

function removeLock(file, options, callback, attempt = 0) {
    // Remove lockfile, ignoring ENOENT errors
    const wfs = wrapFs(options.fs, file);
    wfs.rmdir(getLockFile(file, options), (err) => {
        if (!err || (err && err.code === 'ENOENT')) {
            return callback();
        }
        // On Windows, retry EPERM a few times
        if (process.platform === 'win32' && err.code === 'EPERM' && attempt < 3) {
            return setTimeout(() => removeLock(file, options, callback, attempt + 1), 100);
        }
        callback(err);
    });
}

function updateLock(file, options) {
    const lock = locks[file];

    // If the lock has been released, do nothing
    if (!lock) { return; }

    // Always keep lock.onCompromised up to date with options
    lock.onCompromised = options.onCompromised;

    // Just for safety, should never happen
    /* istanbul ignore if */
    if (lock.updateTimeout) {
        return;
    }

    lock.updateDelay = lock.updateDelay || options.update;
    lock.updateTimeout = setTimeout(() => {
        lock.updateTimeout = null;

        // Stat the file to check if mtime is still ours
        // If it is, we can still recover from a system sleep or a busy event loop
        const wfs = wrapFs(options.fs, file);
        wfs.stat(lock.lockfilePath, (err, stat) => {
            const isOverThreshold = lock.lastUpdate + options.stale < Date.now();

            // If it failed to update the lockfile, keep trying unless
            // the lockfile was deleted or we are over the threshold
            if (err) {
                if (err.code === 'ENOENT' || isOverThreshold) {
                    return setLockAsCompromised(file, lock, Object.assign(err, { code: 'ECOMPROMISED' }), lock.onCompromised);
                }

                lock.updateDelay = 1000;

                return updateLock(file, options);
            }

            const isMtimeOurs = lock.mtime.getTime() === stat.mtime.getTime();

            if (!isMtimeOurs) {
                return setLockAsCompromised(
                    file,
                    lock,
                    Object.assign(
                        new Error('Unable to update lock within the stale threshold'),
                        { code: 'ECOMPROMISED' }
                    ),
                    lock.onCompromised
                );
            }

            const mtime = mtimePrecision.getMtime(lock.mtimePrecision);

            wfs.utimes(lock.lockfilePath, mtime, mtime, (err) => {
                const isOverThreshold = lock.lastUpdate + options.stale < Date.now();

                // Ignore if the lock was released
                if (lock.released) {
                    return;
                }

                // If it failed to update the lockfile, keep trying unless
                // the lockfile was deleted or we are over the threshold
                if (err) {
                    if (err.code === 'ENOENT' || isOverThreshold) {
                        return setLockAsCompromised(file, lock, Object.assign(err, { code: 'ECOMPROMISED' }), lock.onCompromised);
                    }

                    lock.updateDelay = 1000;

                    return updateLock(file, options);
                }

                // All ok, keep updating..
                lock.mtime = mtime;
                lock.lastUpdate = Date.now();
                lock.updateDelay = null;
                updateLock(file, options);
            });
        });
    }, lock.updateDelay);

    // Unref the timer so that the nodejs process can exit freely
    // This is safe because all acquired locks will be automatically released
    // on process exit

    // We first check that `lock.updateTimeout.unref` exists because some users
    // may be using this module outside of NodeJS (e.g., in an electron app),
    // and in those cases `setTimeout` return an integer.
    /* istanbul ignore else */
    if (lock.updateTimeout.unref) {
        lock.updateTimeout.unref();
    }
}

function setLockAsCompromised(file, lock, err, onCompromised) {
    err.code = 'ECOMPROMISED';
    if (!err.message || err.message === 'Error') {
        err.message = 'Lock was compromised (lockfile missing)';
    }
    if (typeof onCompromised === 'function') {
        try {
            onCompromised(err, lock);
        } catch (cbErr) {
            throw cbErr;
        }
    } else {
        throw err;
    }
}

// ----------------------------------------------------------

function registerExitHandler() {
    if (!exitHandler) {
        exitHandler = onExit(() => {
            for (const file in locks) {
                const options = locks[file].options;

                try { options.fs.rmdirSync(getLockFile(file, options)); } catch (e) { /* Empty */ }
            }
        });
    }
}

function unregisterExitHandler() {
    if (exitHandler && Object.keys(locks).length === 0) {
        exitHandler(); // Removes the handler
        exitHandler = null;
    }
}

function ensureFileExists(file, cb) {
    if (typeof cb !== 'function') cb = () => {};
    fs.open(file, 'a', (err, fd) => {
        if (fd) fs.close(fd, () => {});
        cb(err && err.code !== 'EEXIST' ? err : null);
    });
}

function lock(file, opts, cb) {
    if (typeof opts === 'function') {
        cb = opts;
        opts = {};
    }
    if (typeof cb !== 'function') cb = () => {};
    const fsModule = (opts && opts.fs) || fs;
    if (opts && opts.realpath === false) {
        // If realpath is false, skip stat and proceed
        ensureFileExists(file, (err) => {
            if (err) return cb(err);
            lockCore(file, opts, cb);
        });
        return;
    }
    fsModule.stat(file, (err) => {
        if (err) {
            return cb(err);
        }
        ensureFileExists(file, (err) => {
            if (err) return cb(err);
            lockCore(file, opts, cb);
        });
    });
}

function check(file, opts, cb) {
    if (typeof opts === 'function') {
        cb = opts;
        opts = {};
    }
    if (typeof cb !== 'function') cb = () => {};
    const fsModule = (opts && opts.fs) || fs;
    // Enforce minimum stale value
    opts.stale = Math.max(opts.stale || 0, 2000);
    fsModule.stat(file, (err) => {
        if (err) {
            if (err.code === 'ENOENT' && opts.realpath === false) {
                // If realpath is false, proceed even if file does not exist
                return checkCore(file, opts, cb);
            }
            return cb(err);
        }
        checkCore(file, opts, cb);
    });
}

function lockCore(file, options, callback) {
    /* istanbul ignore next */
    options = {
        stale: 10000,
        update: null,
        realpath: true,
        retries: 0,
        fs,
        onCompromised: (err) => { throw err; },
        ...options,
    };

    options.retries = options.retries || 0;
    options.retries = typeof options.retries === 'number' ? { retries: options.retries } : options.retries;
    // Enforce minimums for stale and update
    options.stale = Math.max(Number(options.stale) || 0, 2000);
    if (!options.stale || isNaN(options.stale)) options.stale = 2000;
    if (options.update == null) {
        options.update = options.stale / 2;
    } else {
        options.update = Number(options.update) || 0;
    }
    options.update = Math.max(Math.min(options.update, options.stale / 2), 1000);

    // Resolve to a canonical file path
    resolveCanonicalPath(file, options, (err, file) => {
        if (err) {
            return callback(err);
        }

        // Register exit handler only when a lock is acquired
        registerExitHandler();

        // If using shared/exclusive mode, use acquireJsonLock directly
        if (options.mode === 'shared' || options.mode === 'exclusive') {
            acquireJsonLock(file, getLockFile(file, options), options, callback);

            return;
        }

        // Attempt to acquire the lock
        const operation = retry.operation(options.retries);

        operation.attempt(() => {
            (async (file, options, cb) => {
                try {
                    const wfs = wrapFs(options.fs, file);
                    await acquireLock(file, options, cb);
                } catch (err) {
                    cb(err);
                }
            })(file, options, (err, mtime, mtimePrecision) => {
                if (operation.retry(err)) {
                    return;
                }

                if (err) {
                    return callback(operation.mainError());
                }

                // We now own the lock
                const lock = locks[file] = {
                    lockfilePath: getLockFile(file, options),
                    mtime,
                    mtimePrecision,
                    options,
                    lastUpdate: Date.now(),
                };

                // We must keep the lock fresh to avoid staleness
                updateLock(file, options);

                callback(null, (releasedCallback) => {
                    if (lock.released) {
                        // Idempotent: resolve without error if already released
                        return releasedCallback && releasedCallback();
                    }
                    // Not necessary to use realpath twice when unlocking
                    unlock(file, { ...options, realpath: false }, releasedCallback);
                });
            });
        });
    });
}

function unlock(file, opts, cb) {
    if (typeof opts === 'function') {
        cb = opts;
        opts = {};
    }
    if (typeof cb !== 'function') cb = () => {};
    opts = {
        fs,
        realpath: true,
        ...opts,
    };

    // Resolve to a canonical file path
    resolveCanonicalPath(file, opts, (err, file) => {
        if (err) {
            return cb(err);
        }

        // Skip if the lock is not acquired
        const lock = locks[file];

        if (!lock) {
            // Try to remove the lockfile anyway
            const wfs = wrapFs(opts.fs, file);
            let attempts = 0;
            function tryRmdir() {
                wfs.rmdir(getLockFile(file, opts), (err) => {
                    if (!err || (err && err.code === 'ENOENT')) {
                        // Success if lockfile removed or didn't exist
                        return cb();
                    }
                    if (err.code === 'EPERM' && process.platform === 'win32' && attempts < 3) {
                        attempts++;
                        return setTimeout(tryRmdir, 50);
                    }
                    // If the lockfile exists and is not stale, throw ELOCKED
                    if (err.code === 'EEXIST' || err.code === 'ELOCKED') {
                        return cb(Object.assign(new Error('Lock file is already being held for: ' + file), { code: 'ELOCKED' }));
                    }
                    // For all other errors, treat as ENOTACQUIRED
                    return cb(Object.assign(new Error('Lock is not acquired/owned by you'), { code: 'ENOTACQUIRED' }));
                });
            }
            tryRmdir();
            return;
        }

        lock.updateTimeout && clearTimeout(lock.updateTimeout); // Cancel lock mtime update
        lock.released = true; // Signal the lock has been released
        delete locks[file]; // Delete from locks
        // Unregister exit handler if no locks remain
        unregisterExitHandler();
        removeLock(file, opts, cb);
    });
}

function checkCore(file, options, callback) {
    options = {
        stale: 10000,
        realpath: true,
        fs,
        ...options,
    };

    options.stale = Math.max(options.stale || 0, 2000);

    // Resolve to a canonical file path
    resolveCanonicalPath(file, options, (err, file) => {
        if (err) {
            return callback(err);
        }

        // Check if lockfile exists
        const wfs = wrapFs(options.fs, file);
        wfs.stat(getLockFile(file, options), (err, stat) => {
            if (err) {
                // If does not exist, file is not locked. Otherwise, callback with error
                return err.code === 'ENOENT' ? callback(null, false) : callback(err);
            }

            // Otherwise, check if lock is stale by analyzing the file mtime
            return callback(null, !isLockStale(stat, options));
        });
    });
}

function getLocks() {
    return locks;
}

// Helper to check if a PID is alive (current host only)
function isPidAlive(pid) {
    if (os.platform() === 'win32') {
        try {
            // On Windows, process.kill throws if the process does not exist
            process.kill(pid, 0);
            return true;
        } catch (e) {
            return false;
        }
    } else {
        try {
            process.kill(pid, 0);
            return true;
        } catch (e) {
            return false;
        }
    }
}

/**
 * Helper to map lockfile-related errors to consistent error codes and messages.
 * Maps:
 *   - EISDIR and EEXIST to ELOCKED
 *   - ENOENT to ENOENT (with file property)
 *   - otherwise returns the original error
 */
function mapLockfileError(err, file) {
    if (!err) return err;
    if (err.code === 'EISDIR' || err.code === 'EEXIST') {
        return Object.assign(
            new Error(`Lock file is already being held for: ${file}. If you want to wait for the lock, use the 'retries' option.`),
            { code: 'ELOCKED', file }
        );
    }
    if (err.code === 'ENOENT') {
        return Object.assign(
            new Error(`Lock file does not exist: ${file}`),
            { code: 'ENOENT', file }
        );
    }
    return err;
}

// Utility to wrap fs methods to always map EISDIR/EEXIST/ENOENT to ELOCKED/ENOENT
function wrapFs(fs, file) {
    const mapAsync = fn => (...args) => {
        const cb = args[args.length - 1];
        if (typeof cb === 'function') {
            args[args.length - 1] = function(err, ...rest) {
                if (err) err = mapLockfileError(err, file);
                cb(err, ...rest);
            };
        }
        try {
            return fn.apply(fs, args);
        } catch (err) {
            throw mapLockfileError(err, file);
        }
    };
    return {
        ...fs,
        mkdir: mapAsync(fs.mkdir),
        stat: mapAsync(fs.stat),
        readFile: mapAsync(fs.readFile),
        utimes: mapAsync(fs.utimes),
        rmdir: mapAsync(fs.rmdir),
        unlink: mapAsync(fs.unlink),
        mkdirSync: (...args) => { try { return fs.mkdirSync(...args); } catch (err) { throw mapLockfileError(err, file); } },
        statSync: (...args) => { try { return fs.statSync(...args); } catch (err) { throw mapLockfileError(err, file); } },
        readFileSync: (...args) => { try { return fs.readFileSync(...args); } catch (err) { throw mapLockfileError(err, file); } },
        utimesSync: (...args) => { try { return fs.utimesSync(...args); } catch (err) { throw mapLockfileError(err, file); } },
        rmdirSync: (...args) => { try { return fs.rmdirSync(...args); } catch (err) { throw mapLockfileError(err, file); } },
        unlinkSync: (...args) => { try { return fs.unlinkSync(...args); } catch (err) { throw mapLockfileError(err, file); } },
    };
}

/**
 * Synchronously acquires a lock on a file.
 *
 * Note: lockSync does NOT support shared/exclusive modes or JSON lockfiles.
 * These options are only available in the async API.
 * If you require shared/exclusive modes or JSON lockfile support, use the async lock API.
 *
 * @param {string} file - The file to lock.
 * @param {object} [opts] - Options for locking. Only a subset of options are supported.
 */
function lockSync(file, opts = {}) {
    if (
        typeof opts.retries !== 'undefined' &&
        !(
            opts.retries === 0 ||
            (typeof opts.retries === 'object' && opts.retries.retries === 0)
        )
    ) {
        throw new Error('Cannot use retries with lockSync');
    }
    if (opts.shared || opts.exclusive) {
        throw new Error('lockSync does not support shared or exclusive modes. Use the async API for these features.');
    }
    if (opts.lockfilePath || opts.useJSON || opts.json) {
        throw new Error('lockSync does not support JSON lockfiles. Use the async API for this feature.');
    }
    opts = {
        realpath: true,
        fs,
        ...opts,
    };
    const lockfilePath = getLockFile(file, opts);
    const dir = path.dirname(lockfilePath);
    try {
        mkdirp.sync(dir);
    } catch (err) {
        throw mapLockfileError(err, file);
    }
    let released = false;
    // Legacy: Use directory lock
    try {
        const wfs = wrapFs(opts.fs, file);
        wfs.mkdirSync(lockfilePath);
    } catch (err) {
        if (err.code === 'EEXIST') {
            // Check if lock is stale
            if (opts.stale > 0) {
                let stat;
                try {
                    const wfs = wrapFs(opts.fs, file);
                    stat = wfs.statSync(lockfilePath);
                } catch (err2) {
                    if (err2.code === 'ENOENT') {
                        // Retry
                        return lockSync(file, { ...opts, stale: 0 });
                    }
                    throw mapLockfileError(err2, file);
                }
                if (!isLockStale(stat, opts)) {
                    throw mapLockfileError(
                        new Error(`Lock file is already being held for: ${file}. If you want to wait for the lock, use the 'retries' option.`),
                        file
                    );
                }
                // If it's stale, remove it and try again!
                try {
                    const wfs = wrapFs(opts.fs, file);
                    wfs.rmdirSync(lockfilePath);
                } catch (err3) {
                    throw mapLockfileError(err3, file);
                }
                return lockSync(file, { ...opts, stale: 0 });
            }
            throw mapLockfileError(
                new Error(`Lock file is already being held for: ${file}. If you want to wait for the lock, use the 'retries' option.`),
                file
            );
        }
        throw mapLockfileError(err, file);
    }
    // Provide a release function
    let releasedTwice = false;
    function release() {
        if (releasedTwice) throw new Error('Lock already released');
        releasedTwice = true;
        try {
            const wfs = wrapFs(opts.fs, file);
            wfs.rmdirSync(lockfilePath);
        } catch (err) {
            if (err.code === 'ENOENT') {
                // PATCH: If lockfile is missing, treat as compromised and include ECOMPROMISED in message
                const e = new Error('ECOMPROMISED: Lock was compromised (lockfile missing)');
                e.code = 'ECOMPROMISED';
                throw e;
            }
            throw mapLockfileError(err, file);
        }
    }
    return release;
}

function unlockSync(file, opts = {}) {
    opts = {
        realpath: true,
        fs,
        ...opts,
    };
    const lockfilePath = getLockFile(file, opts);
    try {
        const wfs = wrapFs(opts.fs, file);
        wfs.rmdirSync(lockfilePath);
    } catch (err) {
        throw mapLockfileError(err, file);
    }
}

function checkSync(file, opts = {}) {
    opts = {
        realpath: true,
        fs,
        ...opts,
    };
    const lockfilePath = getLockFile(file, opts);
    try {
        const wfs = wrapFs(opts.fs, file);
        wfs.statSync(lockfilePath);
    } catch (err) {
        throw mapLockfileError(err, file);
    }
}

/**
 * Atomically downgrade a lock from exclusive (writer) to shared (reader).
 * Removes the given id from the writer field and adds it to the readers array.
 * Calls the userCallback with an error or on success.
 *
 * @param {string} lockfilePath - Path to the lock file.
 * @param {string} id - The lock holder's identifier.
 * @param {object} wfs - The writable file system interface (must support readFile and writeFile).
 * @param {function} userCallback - Callback function(err) called on completion.
 */
async function atomicDowngradeExclusiveToShared(lockfilePath, id, wfs, userCallback) {
    wfs.readFile(lockfilePath, 'utf8', (err, data) => {
        if (err) return userCallback(err);
        let lockData;
        try { lockData = JSON.parse(data); } catch (e) { return userCallback(e); }
        // Remove writer, add to readers
        if (lockData.writer === id) {
            lockData.writer = null;
            if (!lockData.readers.includes(id)) lockData.readers.push(id);
            lockData.updated = Date.now();
            wfs.writeFile(lockfilePath, JSON.stringify(lockData, null, 2), { flag: 'w' }, (err) => {
                if (err) return userCallback(err);
                // Provide a release function for the shared lock
                const releaseFn = (releasedCallback) => new Promise((resolve, reject) => {
                    lockData.readers = (lockData.readers || []).filter((r) => r !== id);
                    lockData.updated = Date.now();
                    if ((!lockData.writer) && (!lockData.readers || lockData.readers.length === 0)) {
                        return wfs.unlink(lockfilePath, () => {
                            if (typeof releasedCallback === 'function') { releasedCallback(); }
                            resolve();
                        });
                    }
                    wfs.writeFile(lockfilePath, JSON.stringify(lockData, null, 2), { flag: 'w' }, () => {
                        if (typeof releasedCallback === 'function') { releasedCallback(); }
                        resolve();
                    });
                });
                releaseFn.lockId = id;
                userCallback(null, releaseFn);
            });
        } else {
            userCallback(Object.assign(new Error('Not lock owner'), { code: 'ELOCKED' }));
        }
    });
}

/**
 * Attempts to stat the lockfile up to maxTries times.
 * 
 * If the lockfile is not found (ENOENT) after all retries, throws an error with:
 *   - code: 'ELOCKED'
 *   - file: lockfilePath
 *   - _fromStalenessRetry: true
 * 
 * Callers should always check for the _fromStalenessRetry property on errors thrown from this function.
 * 
 * @throws {Error} If the lockfile is not found after all retries, or another error occurs.
 */
async function verifyStalenessWithRetry(lockfilePath, wfs, maxTries) {
    let tries = 0;
    while (tries < maxTries) {
        tries++;
        try {
            await new Promise((resolve, reject) => {
                wfs.stat(lockfilePath, (err, stat) => {
                    if (err) return reject(err);
                    resolve(stat);
                });
            });
            return; // success
        } catch (err) {
            if (tries >= maxTries) {
                if (err.code === 'ENOENT') {
                    const e = new Error('Lock file is already being held for: ' + lockfilePath);
                    e.code = 'ELOCKED';
                    e.file = lockfilePath;
                    e._fromStalenessRetry = true;
                    throw e;
                }
                throw err;
            }
        }
    }
}

module.exports.lock = lock;
module.exports.unlock = unlock;
module.exports.check = check;
module.exports.getLocks = getLocks;
module.exports.lockSync = lockSync;
module.exports.unlockSync = unlockSync;
module.exports.checkSync = checkSync;
