'use strict';

const http = require('http');
const url = require('url');

class API {
    constructor() {
        this.server = null;
        this.port = 8080;
        this.analytics = require('./analytics');
        this.backends = require('./backends');
    }

    start(options = {}) {
        this.port = options.port || 8080;
        
        this.server = http.createServer((req, res) => {
            this.handleRequest(req, res);
        });
        
        this.server.listen(this.port, () => {
            console.log(`🔒 Locksmith API running on http://localhost:${this.port}`);
        });
        
        return this.server;
    }

    handleRequest(req, res) {
        const parsedUrl = url.parse(req.url, true);
        const path = parsedUrl.pathname;
        const method = req.method;
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        
        if (method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }
        
        // Rate limiting (basic implementation)
        if (!this.checkRateLimit(req)) {
            res.writeHead(429, { 'Retry-After': '60' });
            res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
            return;
        }
        
        try {
            this.routeRequest(method, path, req, res, parsedUrl);
        } catch (error) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: error.message }));
        }
    }

    routeRequest(method, path, req, res, parsedUrl) {
        const pathParts = path.split('/').filter(Boolean);
        
        if (pathParts[0] !== 'api') {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
        }
        
        switch (pathParts[1]) {
            case 'locks':
                this.handleLocks(method, pathParts, req, res, parsedUrl);
                break;
            case 'metrics':
                this.handleMetrics(method, pathParts, req, res, parsedUrl);
                break;
            case 'health':
                this.handleHealth(method, pathParts, req, res, parsedUrl);
                break;
            case 'backends':
                this.handleBackends(method, pathParts, req, res, parsedUrl);
                break;
            default:
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Endpoint not found' }));
        }
    }

    async handleLocks(method, pathParts, req, res, parsedUrl) {
        switch (method) {
            case 'GET':
                if (pathParts.length === 2) {
                    // GET /api/locks - list all locks
                    const locks = Array.from(this.analytics.locks.entries()).map(([file, lock]) => ({
                        file,
                        pid: lock.pid,
                        mode: lock.mode,
                        acquiredAt: lock.acquiredAt,
                        duration: Date.now() - lock.acquiredAt
                    }));
                    res.writeHead(200);
                    res.end(JSON.stringify(locks));
                } else if (pathParts.length === 3) {
                    // GET /api/locks/:file - get specific lock
                    const file = decodeURIComponent(pathParts[2]);
                    const lock = this.analytics.locks.get(file);
                    if (lock) {
                        res.writeHead(200);
                        res.end(JSON.stringify({
                            file,
                            pid: lock.pid,
                            mode: lock.mode,
                            acquiredAt: lock.acquiredAt,
                            duration: Date.now() - lock.acquiredAt
                        }));
                    } else {
                        res.writeHead(404);
                        res.end(JSON.stringify({ error: 'Lock not found' }));
                    }
                }
                break;
                
            case 'POST':
                // POST /api/locks - acquire lock
                const body = await this.parseBody(req);
                const locksmith = require('../index');
                
                try {
                    const release = await locksmith.lock(body.file, body.options || {});
                    res.writeHead(200);
                    res.end(JSON.stringify({ 
                        success: true, 
                        message: 'Lock acquired',
                        file: body.file
                    }));
                } catch (error) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: error.message }));
                }
                break;
                
            case 'DELETE':
                if (pathParts.length === 3) {
                    // DELETE /api/locks/:file - release lock
                    const file = decodeURIComponent(pathParts[2]);
                    const locksmith = require('../index');
                    
                    try {
                        await locksmith.unlock(file);
                        res.writeHead(200);
                        res.end(JSON.stringify({ 
                            success: true, 
                            message: 'Lock released',
                            file
                        }));
                    } catch (error) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: error.message }));
                    }
                }
                break;
                
            default:
                res.writeHead(405);
                res.end(JSON.stringify({ error: 'Method not allowed' }));
        }
    }

    async handleMetrics(method, pathParts, req, res, parsedUrl) {
        if (method !== 'GET') {
            res.writeHead(405);
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }
        
        const metrics = this.analytics.getMetrics();
        res.writeHead(200);
        res.end(JSON.stringify(metrics));
    }

    async handleHealth(method, pathParts, req, res, parsedUrl) {
        if (method !== 'GET') {
            res.writeHead(405);
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }
        
        const health = {
            status: 'healthy',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            timestamp: new Date().toISOString(),
            version: require('../package.json').version
        };
        
        res.writeHead(200);
        res.end(JSON.stringify(health));
    }

    async handleBackends(method, pathParts, req, res, parsedUrl) {
        if (method !== 'GET') {
            res.writeHead(405);
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }
        
        const backends = Array.from(this.backends.backends.keys());
        res.writeHead(200);
        res.end(JSON.stringify({ backends }));
    }

    async parseBody(req) {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (error) {
                    reject(new Error('Invalid JSON'));
                }
            });
            req.on('error', reject);
        });
    }

    checkRateLimit(req) {
        // Basic rate limiting - 100 requests per minute per IP
        const clientIP = req.connection.remoteAddress;
        const now = Date.now();
        
        if (!this.rateLimitMap) {
            this.rateLimitMap = new Map();
        }
        
        if (!this.rateLimitMap.has(clientIP)) {
            this.rateLimitMap.set(clientIP, { count: 1, resetTime: now + 60000 });
        } else {
            const limit = this.rateLimitMap.get(clientIP);
            if (now > limit.resetTime) {
                limit.count = 1;
                limit.resetTime = now + 60000;
            } else {
                limit.count++;
            }
            
            if (limit.count > 100) {
                return false;
            }
        }
        
        return true;
    }

    stop() {
        if (this.server) {
            this.server.close();
            console.log('API stopped');
        }
    }
}

function start(options = {}) {
    const api = new API();
    return api.start(options);
}

module.exports = { start }; 