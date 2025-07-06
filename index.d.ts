declare module 'locksmithx' {
  // Core types
  export interface LockOptions {
    mode?: 'shared' | 'exclusive' | 'read' | 'write';
    stale?: number;
    update?: number;
    retry?: RetryOptions;
    realpath?: boolean;
    fs?: any;
    onCompromised?: (error: Error) => void;
    lockfilePath?: string;
    hierarchical?: boolean;
    lockParents?: boolean;
    scope?: 'local' | 'global';
    backend?: 'file' | 'memory' | 'redis' | 'consul' | string;
    encryption?: EncryptionOptions;
    audit?: AuditOptions;
    access?: AccessOptions;
    condition?: () => Promise<boolean> | boolean;
    healthCheckInterval?: number;
    autoRepair?: boolean;
    cache?: CacheOptions;
    cluster?: ClusterOptions;
    cloud?: CloudOptions;
  }

  export interface RetryOptions {
    retries?: number;
    factor?: number;
    minTimeout?: number;
    maxTimeout?: number;
    randomize?: boolean;
  }

  export interface EncryptionOptions {
    algorithm?: string;
    key: string;
  }

  export interface AuditOptions {
    enabled: boolean;
    logLevel?: 'basic' | 'detailed' | 'full';
    destination?: string;
  }

  export interface AccessOptions {
    roles?: string[];
    users?: string[];
    groups?: string[];
  }

  export interface CacheOptions {
    enabled: boolean;
    ttl: number;
    maxSize: number;
  }

  export interface ClusterOptions {
    nodes: string[];
    quorum: number;
    heartbeat: number;
  }

  export interface CloudOptions {
    provider: 'aws' | 'gcp' | 'azure';
    region?: string;
    credentials?: any;
  }

  export interface LockResult {
    release: () => Promise<void>;
    upgrade?: () => Promise<void>;
    downgrade?: () => Promise<void>;
  }

  export interface BatchLockResult {
    locks: LockResult[];
    release: () => Promise<void>;
  }

  export interface HealthResult {
    healthy: boolean;
    corrupted: boolean;
    error?: string;
    lastModified?: Date;
    size?: number;
    ttl?: number;
    lockData?: any;
  }

  export interface Metrics {
    activeLocks: number;
    totalAcquisitions: number;
    totalReleases: number;
    failedAttempts: number;
    staleLocksCleaned: number;
    averageWaitTime: number;
    totalWaitTime: number;
    lockCount: number;
    uptime: number;
    locksPerSecond: number;
    successRate: number;
  }

  export interface LockPoolOptions {
    maxSize?: number;
    minSize?: number;
    acquireTimeout?: number;
  }

  export interface LockPool {
    acquire(file: string, options?: LockOptions): Promise<LockResult>;
    getStats(): any;
    drain(): void;
  }

  export interface BackendImplementation {
    acquire(key: string, options: LockOptions): Promise<LockResult>;
    release(key: string, options?: LockOptions): Promise<boolean>;
    check(key: string, options?: LockOptions): Promise<boolean>;
    checkHealth(key: string): Promise<HealthResult>;
    repair(key: string): Promise<{ repaired: boolean; error?: string }>;
    export(key: string): Promise<{ data: any; metadata: any }>;
    import(key: string, data: any, options?: any): Promise<{ imported: boolean }>;
  }

  // Core functions
  export function lock(file: string, options?: LockOptions): Promise<LockResult>;
  export function lockRead(file: string, options?: LockOptions): Promise<LockResult>;
  export function lockWrite(file: string, options?: LockOptions): Promise<LockResult>;
  export function unlock(file: string, options?: LockOptions): Promise<boolean>;
  export function check(file: string, options?: LockOptions): Promise<boolean>;

  // Synchronous versions
  export function lockSync(file: string, options?: LockOptions): LockResult;
  export function unlockSync(file: string, options?: LockOptions): boolean;
  export function checkSync(file: string, options?: LockOptions): boolean;

  // Advanced features
  export function lockBatch(files: string[], options?: LockOptions): Promise<BatchLockResult>;
  export function releaseBatch(releases: (() => Promise<void>)[]): Promise<void>;
  export function createPool(options?: LockPoolOptions): LockPool;
  export function checkHealth(file: string): Promise<HealthResult>;
  export function repair(file: string): Promise<{ repaired: boolean; error?: string }>;
  export function getMetrics(): Metrics;
  export function getLockTree(): string;
  export function exportLock(file: string): Promise<{ data: any; metadata: any }>;
  export function importLock(file: string, data: any, options?: any): Promise<{ imported: boolean }>;

  // Dashboard and API
  export function startDashboard(options?: { port?: number; auth?: { username: string; password: string } }): any;
  export function startAPI(options?: { port?: number; cors?: boolean; rateLimit?: { window: number; max: number } }): any;

  // Plugin system
  export function registerBackend(name: string, implementation: BackendImplementation): { name: string; unregister: () => boolean };

  // Debug and logging
  export function setDebug(enabled: boolean): void;
  export function setLogger(logger: { debug: Function; info: Function; warn: Function; error: Function }): void;

  // Event listeners
  export function on(event: string, callback: (data: any) => void): void;
  export function off(event: string, callback: (data: any) => void): void;

  // Default export
  export default lock;
} 