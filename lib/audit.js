'use strict';

const fs = require('graceful-fs');
const path = require('path');

class Audit {
    constructor() {
        this.enabled = false;
        this.logLevel = 'basic';
        this.destination = null;
        this.logStream = null;
    }

    init() {
        // Initialize audit system
    }

    log(event, data) {
        if (!this.enabled) return;

        const auditEntry = {
            timestamp: new Date().toISOString(),
            event,
            pid: process.pid,
            user: process.env.USER || process.env.USERNAME || 'unknown',
            data
        };

        this.writeLog(auditEntry);
    }

    writeLog(entry) {
        const logLine = JSON.stringify(entry) + '\n';
        
        if (this.destination) {
            if (this.destination.startsWith('file://')) {
                const filePath = this.destination.replace('file://', '');
                fs.appendFileSync(filePath, logLine);
            } else {
                console.log(`[AUDIT] ${logLine.trim()}`);
            }
        } else {
            console.log(`[AUDIT] ${logLine.trim()}`);
        }
    }

    setDestination(destination) {
        this.destination = destination;
        
        if (destination.startsWith('file://')) {
            const filePath = destination.replace('file://', '');
            const dir = path.dirname(filePath);
            
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
    }

    setLogLevel(level) {
        this.logLevel = level;
    }

    enable() {
        this.enabled = true;
    }

    disable() {
        this.enabled = false;
    }

    getAuditLog(options = {}) {
        if (!this.destination || !this.destination.startsWith('file://')) {
            return [];
        }

        const filePath = this.destination.replace('file://', '');
        
        if (!fs.existsSync(filePath)) {
            return [];
        }

        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.trim().split('\n').filter(line => line);
        
        return lines.map(line => {
            try {
                return JSON.parse(line);
            } catch (error) {
                return { raw: line, error: 'Invalid JSON' };
            }
        });
    }
}

module.exports = new Audit(); 