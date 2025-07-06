'use strict';

const EventEmitter = require('events');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

class Analytics extends EventEmitter {
    constructor() {
        super();
        this.metrics = {
            operations: {
                acquire: { count: 0, totalTime: 0, errors: 0 },
                release: { count: 0, totalTime: 0, errors: 0 },
                check: { count: 0, totalTime: 0, errors: 0 }
            },
            locks: new Map(),
            performance: {
                avgAcquireTime: 0,
                avgReleaseTime: 0,
                avgCheckTime: 0,
                throughput: 0
            },
            system: {
                memory: {},
                cpu: {},
                uptime: Date.now()
            }
        };
        
        this.locks = new Map();
        this.history = [];
        this.maxHistorySize = 1000;
        this.enabled = true;
        
        // Start monitoring
        this.startSystemMonitoring();
    }

    init() {
        this.log('Analytics initialized');
    }

    record(event, data) {
        switch (event) {
            case 'lock-acquired':
                this.metrics.totalAcquisitions++;
                this.metrics.activeLocks++;
                this.metrics.totalWaitTime += data.duration || 0;
                this.metrics.averageWaitTime = this.metrics.totalWaitTime / this.metrics.totalAcquisitions;
                
                this.locks.set(data.file, {
                    pid: process.pid,
                    mode: data.mode || 'exclusive',
                    acquiredAt: Date.now(),
                    duration: data.duration || 0
                });
                break;
                
            case 'lock-released':
                this.metrics.totalReleases++;
                this.metrics.activeLocks = Math.max(0, this.metrics.activeLocks - 1);
                this.locks.delete(data.file);
                break;
                
            case 'lock-failed':
                this.metrics.failedAttempts++;
                break;
                
            case 'stale-lock-cleaned':
                this.metrics.staleLocksCleaned++;
                break;
        }
        
        this.emit(event, data);
        this.log(`Event: ${event}`, data);
    }

    getMetrics() {
        const uptime = Date.now() - this.startTime;
        return {
            ...this.metrics,
            uptime,
            locksPerSecond: this.metrics.totalAcquisitions / (uptime / 1000),
            successRate: this.metrics.totalAcquisitions / (this.metrics.totalAcquisitions + this.metrics.failedAttempts)
        };
    }

    getLockTree() {
        const tree = {};
        
        for (const [file, lock] of this.locks) {
            const parts = file.split(path.sep);
            let current = tree;
            
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (!current[part]) {
                    current[part] = {
                        type: i === parts.length - 1 ? 'file' : 'directory',
                        locked: false,
                        children: {}
                    };
                }
                
                if (i === parts.length - 1) {
                    current[part].locked = true;
                    current[part].lockInfo = lock;
                }
                
                current = current[part].children;
            }
        }
        
        return this.formatTree(tree);
    }

    formatTree(tree, prefix = '') {
        let result = '';
        
        for (const [name, node] of Object.entries(tree)) {
            const icon = node.type === 'file' ? '📄' : '📁';
            const lockIcon = node.locked ? (node.lockInfo?.mode === 'shared' ? '🔓' : '🔒') : '';
            const lockInfo = node.locked ? ` (${node.lockInfo?.mode}, pid: ${node.lockInfo?.pid})` : '';
            
            result += `${prefix}${icon} ${name}${lockIcon}${lockInfo}\n`;
            
            if (Object.keys(node.children).length > 0) {
                result += this.formatTree(node.children, prefix + '  ');
            }
        }
        
        return result;
    }

    setDebug(enabled) {
        this.debug = enabled;
        this.log(`Debug mode ${enabled ? 'enabled' : 'disabled'}`);
    }

    setLogger(logger) {
        this.logger = logger;
    }

    log(message, data = null) {
        if (this.debug) {
            if (data) {
                this.logger.log(`[Locksmith Analytics] ${message}`, data);
            } else {
                this.logger.log(`[Locksmith Analytics] ${message}`);
            }
        }
    }

    reset() {
        this.metrics = {
            activeLocks: 0,
            totalAcquisitions: 0,
            totalReleases: 0,
            failedAttempts: 0,
            staleLocksCleaned: 0,
            averageWaitTime: 0,
            totalWaitTime: 0,
            lockCount: 0
        };
        this.locks.clear();
        this.startTime = Date.now();
    }

    // Track operation start
    startOperation(operation, file, options = {}) {
        if (!this.enabled) return null;

        const operationId = this.generateOperationId();
        const startTime = process.hrtime.bigint();
        
        // Store operation type and start time
        this.setOperationType(operationId, operation);
        this.setOperationStartTime(operationId, startTime);
        
        const operationData = {
            id: operationId,
            operation,
            file,
            options,
            startTime,
            timestamp: Date.now()
        };

        this.emit('operation-started', operationData);
        return operationId;
    }

    // Track operation completion
    completeOperation(operationId, success = true, error = null) {
        if (!this.enabled || !operationId) return;

        const endTime = process.hrtime.bigint();
        const startTime = this.getOperationStartTime(operationId);
        const duration = Number(endTime - startTime) / 1000000; // Convert to ms

        const operationData = {
            id: operationId,
            endTime,
            duration,
            success,
            error: error ? error.message : null,
            timestamp: Date.now()
        };

        // Get operation type from stored operation data or default to 'unknown'
        const operationType = this.getOperationType(operationId) || 'acquire';
        operationData.operation = operationType;

        this.updateMetrics(operationData);
        this.addToHistory(operationData);
        this.emit('operation-completed', operationData);
    }

    // Track lock acquisition
    trackLockAcquired(file, options = {}) {
        if (!this.enabled) return;

        const lockData = {
            file,
            acquired: Date.now(),
            options,
            holder: process.pid,
            hostname: os.hostname()
        };

        this.metrics.locks.set(file, lockData);
        this.emit('lock-acquired', lockData);
    }

    // Track lock release
    trackLockReleased(file) {
        if (!this.enabled) return;

        const lockData = this.metrics.locks.get(file);
        if (lockData) {
            const duration = Date.now() - lockData.acquired;
            lockData.released = Date.now();
            lockData.duration = duration;

            this.metrics.locks.delete(file);
            this.emit('lock-released', lockData);
        }
    }

    // Update metrics
    updateMetrics(operationData) {
        const { operation } = operationData;
        const metrics = this.metrics.operations[operation];
        
        if (metrics) {
            metrics.count++;
            metrics.totalTime += operationData.duration;
            
            if (!operationData.success) {
                metrics.errors++;
            }

            // Update averages
            this.metrics.performance[`avg${operation.charAt(0).toUpperCase() + operation.slice(1)}Time`] = 
                metrics.totalTime / metrics.count;
        }
    }

    // Add to history
    addToHistory(operationData) {
        this.history.push(operationData);
        
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        }
    }

    // Get current metrics
    getMetrics() {
        return {
            ...this.metrics,
            activeLocks: this.metrics.locks.size,
            totalOperations: Object.values(this.metrics.operations).reduce((sum, op) => sum + op.count, 0),
            errorRate: this.calculateErrorRate(),
            throughput: this.calculateThroughput()
        };
    }

    // Get performance report
    getPerformanceReport() {
        const metrics = this.getMetrics();
        const uptime = Date.now() - metrics.system.uptime;
        
        return {
            uptime: {
                total: uptime,
                formatted: this.formatUptime(uptime)
            },
            operations: metrics.operations,
            performance: metrics.performance,
            system: metrics.system,
            locks: {
                active: metrics.activeLocks,
                total: metrics.totalOperations
            },
            errors: {
                rate: metrics.errorRate,
                total: Object.values(metrics.operations).reduce((sum, op) => sum + op.errors, 0)
            }
        };
    }

    // Get lock statistics
    getLockStats() {
        const stats = {
            total: this.metrics.locks.size,
            byFile: {},
            byDuration: {
                short: 0,    // < 1s
                medium: 0,   // 1s - 1min
                long: 0      // > 1min
            }
        };

        for (const [file, lockData] of this.metrics.locks) {
            const duration = Date.now() - lockData.acquired;
            
            if (!stats.byFile[file]) {
                stats.byFile[file] = 0;
            }
            stats.byFile[file]++;

            if (duration < 1000) {
                stats.byDuration.short++;
            } else if (duration < 60000) {
                stats.byDuration.medium++;
            } else {
                stats.byDuration.long++;
            }
        }

        return stats;
    }

    // Get operation history
    getHistory(limit = 100, filter = {}) {
        let filteredHistory = this.history;

        if (filter.operation) {
            filteredHistory = filteredHistory.filter(op => op.operation === filter.operation);
        }

        if (filter.success !== undefined) {
            filteredHistory = filteredHistory.filter(op => op.success === filter.success);
        }

        if (filter.since) {
            filteredHistory = filteredHistory.filter(op => op.timestamp >= filter.since);
        }

        return filteredHistory.slice(-limit);
    }

    // Calculate error rate
    calculateErrorRate() {
        const total = Object.values(this.metrics.operations).reduce((sum, op) => sum + op.count, 0);
        const errors = Object.values(this.metrics.operations).reduce((sum, op) => sum + op.errors, 0);
        
        return total > 0 ? (errors / total) * 100 : 0;
    }

    // Calculate throughput (operations per second)
    calculateThroughput() {
        const uptime = (Date.now() - this.metrics.system.uptime) / 1000;
        const total = Object.values(this.metrics.operations).reduce((sum, op) => sum + op.count, 0);
        
        return uptime > 0 ? total / uptime : 0;
    }

    // Start system monitoring
    startSystemMonitoring() {
        setInterval(() => {
            this.updateSystemMetrics();
        }, 5000); // Update every 5 seconds
    }

    // Update system metrics
    updateSystemMetrics() {
        this.metrics.system.memory = {
            used: process.memoryUsage().heapUsed,
            total: process.memoryUsage().heapTotal,
            external: process.memoryUsage().external,
            rss: process.memoryUsage().rss
        };

        this.metrics.system.cpu = {
            usage: process.cpuUsage(),
            uptime: process.uptime()
        };

        this.emit('system-updated', this.metrics.system);
    }

    // Generate operation ID
    generateOperationId() {
        return crypto.randomBytes(16).toString('hex');
    }

    // Store operation start time
    setOperationStartTime(operationId, startTime) {
        if (!this.operationStartTimes) {
            this.operationStartTimes = new Map();
        }
        this.operationStartTimes.set(operationId, startTime);
    }

    // Get operation start time
    getOperationStartTime(operationId) {
        if (!this.operationStartTimes) {
            return process.hrtime.bigint();
        }
        return this.operationStartTimes.get(operationId) || process.hrtime.bigint();
    }

    // Format uptime
    formatUptime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }

    // Enable/disable analytics
    setEnabled(enabled) {
        this.enabled = enabled;
        this.emit('analytics-toggled', enabled);
    }

    // Clear metrics
    clearMetrics() {
        this.metrics = {
            operations: {
                acquire: { count: 0, totalTime: 0, errors: 0 },
                release: { count: 0, totalTime: 0, errors: 0 },
                check: { count: 0, totalTime: 0, errors: 0 }
            },
            locks: new Map(),
            performance: {
                avgAcquireTime: 0,
                avgReleaseTime: 0,
                avgCheckTime: 0,
                throughput: 0
            },
            system: {
                memory: {},
                cpu: {},
                uptime: Date.now()
            }
        };
        this.history = [];
        this.emit('metrics-cleared');
    }

    // Export metrics for external monitoring
    exportMetrics() {
        return {
            timestamp: Date.now(),
            metrics: this.getMetrics(),
            performance: this.getPerformanceReport(),
            lockStats: this.getLockStats()
        };
    }

    // Store operation type for later retrieval
    setOperationType(operationId, operation) {
        if (!this.operationTypes) {
            this.operationTypes = new Map();
        }
        this.operationTypes.set(operationId, operation);
    }

    // Get operation type
    getOperationType(operationId) {
        if (!this.operationTypes) return null;
        return this.operationTypes.get(operationId);
    }
}

module.exports = new Analytics(); 