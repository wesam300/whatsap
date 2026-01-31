'use strict';

const logger = require('./Logger');

class SessionHealthMonitor {
    constructor(client, checkInterval = 30000) {
        this.client = client;
        this.checkInterval = checkInterval;
        this.lastHeartbeat = Date.now();
        this.healthCheckTimer = null;
        this.isHealthy = true;
    }

    start() {
        if (this.healthCheckTimer) {
            return;
        }

        this.healthCheckTimer = setInterval(() => {
            this.performHealthCheck();
        }, this.checkInterval);

        logger.info('Health monitor started', { interval: this.checkInterval });
    }

    async performHealthCheck() {
        try {
            if (!this.client.pupPage) {
                this.markUnhealthy('No page available');
                return;
            }

            const isConnected = await this.client.pupPage.evaluate(() => {
                return window.Store?.AppState?.state === 'CONNECTED';
            }).catch(() => false);

            if (!isConnected) {
                this.markUnhealthy('Not connected to WhatsApp');
            } else {
                this.markHealthy();
            }
        } catch (error) {
            this.markUnhealthy(`Health check failed: ${error.message}`);
        }
    }

    markHealthy() {
        if (!this.isHealthy) {
            logger.info('Session is now healthy');
            this.client.emit('session_healthy');
        }
        this.isHealthy = true;
        this.lastHeartbeat = Date.now();
    }

    markUnhealthy(reason) {
        if (this.isHealthy) {
            logger.warn('Session is unhealthy', { reason });
            this.client.emit('session_unhealthy', reason);
        }
        this.isHealthy = false;
    }

    stop() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
            logger.info('Health monitor stopped');
        }
    }

    getStatus() {
        return {
            isHealthy: this.isHealthy,
            lastHeartbeat: this.lastHeartbeat,
            timeSinceLastHeartbeat: Date.now() - this.lastHeartbeat
        };
    }
}

module.exports = SessionHealthMonitor;
