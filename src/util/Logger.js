'use strict';

const fs = require('fs');
const path = require('path');

class Logger {
    constructor(logDir = './logs') {
        this.logDir = logDir;
        this.ensureLogDir();
    }

    ensureLogDir() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    getTimestamp() {
        return new Date().toISOString();
    }

    formatMessage(level, message, data) {
        const timestamp = this.getTimestamp();
        const logEntry = { timestamp, level, message };
        if (data) logEntry.data = data;
        return JSON.stringify(logEntry) + '\n';
    }

    writeLog(level, message, data) {
        const logFile = path.join(this.logDir, `${level}.log`);
        const formattedMessage = this.formatMessage(level, message, data);

        fs.appendFile(logFile, formattedMessage, (err) => {
            if (err && level !== 'error') {
                console.error('Failed to write log:', err);
            }
        });

        if (level === 'error') {
            console.error(`[${level.toUpperCase()}]`, message, data || '');
        }
    }

    info(message, data) {
        this.writeLog('info', message, data);
    }

    error(message, data) {
        this.writeLog('error', message, data);
    }

    warn(message, data) {
        this.writeLog('warn', message, data);
    }

    debug(message, data) {
        this.writeLog('debug', message, data);
    }
}

module.exports = new Logger();
