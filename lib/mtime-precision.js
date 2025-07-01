'use strict';

let cachedPrecision = null;
let probeInProgress = null;

function probe(file, fs, callback) {
    if (cachedPrecision) {
        return fs.stat(file, (err, stat) => {
            if (err) { return callback(err); }
            callback(null, stat.mtime, cachedPrecision);
        });
    }
    if (probeInProgress) {
        // Queue up callbacks while probe is in progress
        probeInProgress.push(callback);

        return;
    }
    probeInProgress = [callback];
    // Set mtime by ceiling Date.now() to seconds + 5ms so that it's "not on the second"
    const mtime = new Date((Math.ceil(Date.now() / 1000) * 1000) + 5);

    fs.utimes(file, mtime, mtime, (err) => {
        if (err) {
            probeInProgress.forEach((cb) => cb(err));
            probeInProgress = null;

            return;
        }
        fs.stat(file, (err, stat) => {
            if (err) {
                probeInProgress.forEach((cb) => cb(err));
                probeInProgress = null;

                return;
            }
            cachedPrecision = stat.mtime.getTime() % 1000 === 0 ? 's' : 'ms';
            probeInProgress.forEach((cb) => cb(null, stat.mtime, cachedPrecision));
            probeInProgress = null;
        });
    });
}

function getMtime(precision) {
    let now = Date.now();

    if (precision === 's') {
        now = Math.ceil(now / 1000) * 1000;
    }

    return new Date(now);
}

module.exports.probe = probe;
module.exports.getMtime = getMtime;
