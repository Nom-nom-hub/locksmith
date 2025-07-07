'use strict';

const lockfile = require('./lib/lockfile');
const advancedLocks = require('./lib/advanced-locks');
const backendManager = require('./lib/distributed-backends');
const analytics = require('./lib/analytics');
const { PluginManager, LoggingPlugin, MetricsPlugin } = require('./lib/plugins');

// Initialize plugin manager
const pluginManager = PluginManager;

// Register default plugins
pluginManager.registerPlugin('logging', new LoggingPlugin());
pluginManager.registerPlugin('metrics', new MetricsPlugin());

// Advanced locks module is already imported above

// Enhanced lock function with all advanced features
async function lock(file, options = {}) {
    const operationId = analytics.startOperation('acquire', file, options);
    
    try {
        // Execute middleware
        const middlewareContext = await pluginManager.executeMiddleware('acquire', { file, options });
        
        // Execute before hooks
        const hookContext = await pluginManager.executeHooks('beforeAcquire', middlewareContext);
        
        let release;
        let hierarchicalLockObj = null;
        
        // Check if using advanced lock types
        if (options.readWrite) {
            release = await advancedLocks.acquireReadWriteLock(file, options);
        } else if (options.hierarchical) {
            hierarchicalLockObj = await advancedLocks.acquireHierarchicalLock(file, options);
        } else if (options.named) {
            release = await advancedLocks.acquireNamedLock(file, options);
        } else {
            // Use distributed backend or default file backend
            release = await backendManager.acquire(file, options);
            // Track shared/exclusive locks for upgrade/downgrade
            const mode = options.mode || 'exclusive';
            advancedLocks.trackLock(file, mode, release, options);
        }
        
        // Track lock acquisition
        analytics.trackLockAcquired(file, options);
        
        // Execute after hooks
        await pluginManager.executeHooks('afterAcquire', { ...hookContext, release: release || (hierarchicalLockObj && hierarchicalLockObj.release) });
        
        // Complete analytics
        analytics.completeOperation(operationId, true);
        
        // Return hierarchical lock object directly if used
        if (hierarchicalLockObj) {
            return hierarchicalLockObj;
        }
        
        // Return enhanced release function for other lock types
        return async function enhancedRelease() {
            const releaseOpId = analytics.startOperation('release', file, options);
            
            try {
                await pluginManager.executeHooks('beforeRelease', { file, options });
                
                await release();
                
                analytics.trackLockReleased(file);
                await pluginManager.executeHooks('afterRelease', { file, options });
                
                analytics.completeOperation(releaseOpId, true);
            } catch (error) {
                analytics.completeOperation(releaseOpId, false, error);
                await pluginManager.executeHooks('onError', { file, options, error });
                throw error;
            }
        };
        
    } catch (error) {
        analytics.completeOperation(operationId, false, error);
        await pluginManager.executeHooks('onError', { file, options, error });
        throw error;
    }
}

// Enhanced unlock function
async function unlock(file, options = {}) {
    const operationId = analytics.startOperation('release', file, options);
    
    try {
        await pluginManager.executeHooks('beforeRelease', { file, options });
        
        await backendManager.release(file, options);
        
        analytics.trackLockReleased(file);
        await pluginManager.executeHooks('afterRelease', { file, options });
        
        analytics.completeOperation(operationId, true);
    } catch (error) {
        analytics.completeOperation(operationId, false, error);
        await pluginManager.executeHooks('onError', { file, options, error });
        throw error;
    }
}

// Enhanced check function
async function check(file, options = {}) {
    const operationId = analytics.startOperation('check', file, options);
    
    try {
        await pluginManager.executeHooks('beforeCheck', { file, options });
        
        const isLocked = await backendManager.check(file, options);
        
        await pluginManager.executeHooks('afterCheck', { file, options, isLocked });
        
        analytics.completeOperation(operationId, true);
        return isLocked;
    } catch (error) {
        analytics.completeOperation(operationId, false, error);
        await pluginManager.executeHooks('onError', { file, options, error });
        throw error;
    }
}

// Advanced lock types
async function acquireReadWriteLock(file, options = {}) {
    return await advancedLocks.acquireReadWriteLock(file, options);
}

async function acquireHierarchicalLock(file, options = {}) {
    return await advancedLocks.acquireHierarchicalLock(file, options);
}

async function acquireNamedLock(name, options = {}) {
    return await advancedLocks.acquireNamedLock(name, options);
}

// Backend management
function registerBackend(name, backend) {
    return backendManager.registerBackend(name, backend);
}

function getBackend(name) {
    return backendManager.getBackend(name);
}

// Analytics and monitoring
function getMetrics() {
    return analytics.getMetrics();
}

function getPerformanceReport() {
    return analytics.getPerformanceReport();
}

function getLockStats() {
    return analytics.getLockStats();
}

// Plugin management
function registerPlugin(name, plugin) {
    return pluginManager.registerPlugin(name, plugin);
}

function unregisterPlugin(name) {
    return pluginManager.unregisterPlugin(name);
}

function getPluginInfo(name) {
    return pluginManager.getPluginInfo(name);
}

function getAllPlugins() {
    return pluginManager.getAllPlugins();
}

// Health monitoring
async function checkHealth(options = {}) {
    const health = {
        status: 'healthy',
        timestamp: Date.now(),
        components: {}
    };

    try {
        // Check file backend
        health.components.fileBackend = {
            status: 'healthy',
            message: 'File backend operational'
        };
    } catch (error) {
        health.components.fileBackend = {
            status: 'unhealthy',
            message: error.message
        };
        health.status = 'degraded';
    }

    try {
        // Check memory backend
        health.components.memoryBackend = {
            status: 'healthy',
            message: 'Memory backend operational'
        };
    } catch (error) {
        health.components.memoryBackend = {
            status: 'unhealthy',
            message: error.message
        };
        health.status = 'degraded';
    }

    try {
        // Check analytics
        const metrics = analytics.getMetrics();
        health.components.analytics = {
            status: 'healthy',
            message: 'Analytics operational',
            data: {
                activeLocks: metrics.activeLocks,
                totalOperations: metrics.totalOperations,
                errorRate: metrics.errorRate
            }
        };
    } catch (error) {
        health.components.analytics = {
            status: 'unhealthy',
            message: error.message
        };
        health.status = 'degraded';
    }

    try {
        // Check plugins
        const plugins = pluginManager.getAllPlugins();
        health.components.plugins = {
            status: 'healthy',
            message: 'Plugin system operational',
            data: {
                total: plugins.length,
                enabled: plugins.filter(p => p.enabled).length
            }
        };
    } catch (error) {
        health.components.plugins = {
            status: 'unhealthy',
            message: error.message
        };
        health.status = 'degraded';
    }

    return health;
}

// Configuration management
const config = {
    analytics: {
        enabled: true,
        maxHistorySize: 1000
    },
    plugins: {
        enabled: true,
        autoLoad: false,
        directory: './plugins'
    },
    backends: {
        default: 'file',
        retryAttempts: 3,
        retryDelay: 1000
    },
    locks: {
        defaultTimeout: 30000,
        defaultStale: 10000,
        enableAdvancedTypes: true
    }
};

function getConfig() {
    return { ...config };
}

function updateConfig(newConfig) {
    Object.assign(config, newConfig);
    
    // Apply configuration changes
    if (newConfig.analytics) {
        analytics.setEnabled(newConfig.analytics.enabled);
    }
    
    if (newConfig.plugins) {
        pluginManager.setEnabled(newConfig.plugins.enabled);
    }
}

// Utility functions
function formatBytes(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

function getLockTree() {
    return analytics.getLockTree();
}

// Export all functions and objects
module.exports = {
    // Core API (backward compatible)
    lock,
    unlock,
    check,
    
    // Advanced lock types
    acquireReadWriteLock,
    acquireHierarchicalLock,
    acquireNamedLock,
    
    // Backend management
    registerBackend,
    getBackend,
    
    // Analytics and monitoring
    getMetrics,
    getPerformanceReport,
    getLockStats,
    
    // Plugin management
    registerPlugin,
    unregisterPlugin,
    getPluginInfo,
    getAllPlugins,
    
    // Health monitoring
    checkHealth,
    
    // Configuration
    getConfig,
    updateConfig,
    
    // Utilities
    formatBytes,
    formatDuration,
    
    // Internal modules (for advanced usage)
    _analytics: analytics,
    _pluginManager: pluginManager,
    _backendManager: backendManager,
    _advancedLocks: advancedLocks,
    getLockTree,
    
    // Export upgrade/downgrade functions
    upgradeToWrite: (file, options) => advancedLocks.upgradeToWrite(file, options),
    downgradeToRead: (file, options) => advancedLocks.downgradeToRead(file, options),
    upgradeToExclusive: (file, options) => advancedLocks.upgradeToExclusive(file, options),
    downgradeToShared: (file, options) => advancedLocks.downgradeToShared(file, options),
    canUpgrade: (file, targetType, options) => advancedLocks.canUpgrade(file, targetType, options),
    getTrackedLocks: () => advancedLocks.getTrackedLocks()
};
