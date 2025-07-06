'use strict';

const http = require('http');
const url = require('url');

class Dashboard {
    constructor() {
        this.server = null;
        this.port = 3000;
        this.analytics = require('./analytics');
    }

    start(options = {}) {
        this.port = options.port || 3000;
        
        this.server = http.createServer((req, res) => {
            this.handleRequest(req, res);
        });
        
        this.server.listen(this.port, () => {
            console.log(`🔒 Locksmith Dashboard running on http://localhost:${this.port}`);
        });
        
        return this.server;
    }

    handleRequest(req, res) {
        const parsedUrl = url.parse(req.url, true);
        const path = parsedUrl.pathname;
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }
        
        switch (path) {
            case '/api/metrics':
                this.getMetrics(req, res);
                break;
            case '/api/locks':
                this.getLocks(req, res);
                break;
            case '/api/health':
                this.getHealth(req, res);
                break;
            case '/api/tree':
                this.getLockTree(req, res);
                break;
            default:
                this.getDashboard(req, res);
        }
    }

    getMetrics(req, res) {
        const metrics = this.analytics.getMetrics();
        res.writeHead(200);
        res.end(JSON.stringify(metrics, null, 2));
    }

    getLocks(req, res) {
        const locks = Array.from(this.analytics.locks.entries()).map(([file, lock]) => ({
            file,
            pid: lock.pid,
            mode: lock.mode,
            acquiredAt: lock.acquiredAt,
            duration: Date.now() - lock.acquiredAt
        }));
        
        res.writeHead(200);
        res.end(JSON.stringify(locks, null, 2));
    }

    getHealth(req, res) {
        const health = {
            status: 'healthy',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            timestamp: new Date().toISOString()
        };
        
        res.writeHead(200);
        res.end(JSON.stringify(health, null, 2));
    }

    getLockTree(req, res) {
        const tree = this.analytics.getLockTree();
        res.writeHead(200);
        res.end(JSON.stringify({ tree }, null, 2));
    }

    getDashboard(req, res) {
        const html = this.generateDashboardHTML();
        res.setHeader('Content-Type', 'text/html');
        res.writeHead(200);
        res.end(html);
    }

    generateDashboardHTML() {
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Locksmith Dashboard</title>
    <style>
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            margin: 0;
            padding: 20px;
            background: #0f172a;
            color: #f1f5f9;
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: #1e293b;
            padding: 20px;
            border-radius: 12px;
            text-align: center;
            border: 1px solid #334155;
        }
        .stat-number {
            font-size: 2rem;
            font-weight: bold;
            color: #3b82f6;
        }
        .stat-label {
            color: #cbd5e1;
            margin-top: 5px;
        }
        .locks-table {
            background: #1e293b;
            border-radius: 12px;
            overflow: hidden;
            border: 1px solid #334155;
        }
        .locks-table h3 {
            margin: 0;
            padding: 20px;
            background: #3b82f6;
            color: white;
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th, td {
            padding: 12px 20px;
            text-align: left;
            border-bottom: 1px solid #334155;
        }
        th {
            background: #0f172a;
            font-weight: 600;
        }
        .refresh-btn {
            background: #3b82f6;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            margin-bottom: 20px;
        }
        .refresh-btn:hover {
            background: #2563eb;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔒 Locksmith Dashboard</h1>
        <p>Real-time lock monitoring and analytics</p>
    </div>
    
    <button class="refresh-btn" onclick="refreshData()">🔄 Refresh</button>
    
    <div class="stats" id="stats">
        <!-- Stats will be populated by JavaScript -->
    </div>
    
    <div class="locks-table">
        <h3>Active Locks</h3>
        <table id="locks-table">
            <thead>
                <tr>
                    <th>File</th>
                    <th>PID</th>
                    <th>Mode</th>
                    <th>Duration</th>
                    <th>Acquired</th>
                </tr>
            </thead>
            <tbody id="locks-body">
                <!-- Locks will be populated by JavaScript -->
            </tbody>
        </table>
    </div>
    
    <script>
        async function refreshData() {
            try {
                const [metrics, locks] = await Promise.all([
                    fetch('/api/metrics').then(r => r.json()),
                    fetch('/api/locks').then(r => r.json())
                ]);
                
                updateStats(metrics);
                updateLocks(locks);
            } catch (error) {
                console.error('Failed to refresh data:', error);
            }
        }
        
        function updateStats(metrics) {
            const statsContainer = document.getElementById('stats');
            statsContainer.innerHTML = \`
                <div class="stat-card">
                    <div class="stat-number">\${metrics.activeLocks}</div>
                    <div class="stat-label">Active Locks</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">\${metrics.totalAcquisitions}</div>
                    <div class="stat-label">Total Acquisitions</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">\${metrics.averageWaitTime.toFixed(0)}ms</div>
                    <div class="stat-label">Avg Wait Time</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">\${(metrics.successRate * 100).toFixed(1)}%</div>
                    <div class="stat-label">Success Rate</div>
                </div>
            \`;
        }
        
        function updateLocks(locks) {
            const tbody = document.getElementById('locks-body');
            tbody.innerHTML = locks.map(lock => \`
                <tr>
                    <td>\${lock.file}</td>
                    <td>\${lock.pid}</td>
                    <td>\${lock.mode}</td>
                    <td>\${Math.round(lock.duration / 1000)}s</td>
                    <td>\${new Date(lock.acquiredAt).toLocaleTimeString()}</td>
                </tr>
            \`).join('');
        }
        
        // Initial load
        refreshData();
        
        // Auto-refresh every 5 seconds
        setInterval(refreshData, 5000);
    </script>
</body>
</html>
        `;
    }

    stop() {
        if (this.server) {
            this.server.close();
            console.log('Dashboard stopped');
        }
    }
}

function start(options = {}) {
    const dashboard = new Dashboard();
    return dashboard.start(options);
}

module.exports = { start }; 