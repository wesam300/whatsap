'use strict';

const logger = require('./Logger');

class ErrorHandler {
    static async handleSessionError(error, client) {
        logger.error('Session error occurred', { error: error.message, stack: error.stack });

        try {
            if (error.message.includes('TargetCloseError') || error.message.includes('Protocol error')) {
                logger.info('Attempting to restart session after protocol error');
                await client.destroy();
                await new Promise(resolve => setTimeout(resolve, 3000));
                await client.initialize();
                return true;
            }

            if (error.message.includes('Navigation timeout') || error.message.includes('Session closed')) {
                logger.info('Attempting to restart session after timeout');
                await client.destroy();
                await new Promise(resolve => setTimeout(resolve, 2000));
                await client.initialize();
                return true;
            }
        } catch (recoveryError) {
            logger.error('Failed to recover from session error', {
                originalError: error.message,
                recoveryError: recoveryError.message
            });
            return false;
        }

        return false;
    }

    static async handleAuthError(error, client) {
        logger.error('Authentication error occurred', { error: error.message });

        try {
            await client.authStrategy.disconnect();
            await new Promise(resolve => setTimeout(resolve, 2000));
            return true;
        } catch (cleanupError) {
            logger.error('Failed to cleanup after auth error', { error: cleanupError.message });
            return false;
        }
    }

    static async handleBrowserError(error, browser) {
        logger.error('Browser error occurred', { error: error.message });

        try {
            if (browser && browser.isConnected()) {
                const pages = await browser.pages();
                await Promise.all(pages.map(page => page.close().catch(() => { })));
                await browser.close();
            }
            return true;
        } catch (cleanupError) {
            logger.error('Failed to cleanup browser', { error: cleanupError.message });
            return false;
        }
    }
}

module.exports = ErrorHandler;
