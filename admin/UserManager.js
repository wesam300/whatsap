'use strict';

const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, Logger } = require('../index');

class UserManager {
    constructor(dataFile = './users.json') {
        this.dataFile = dataFile;
        this.users = new Map();
        this.clients = new Map();
        this.loadUsers();
    }

    loadUsers() {
        try {
            if (fs.existsSync(this.dataFile)) {
                const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
                data.forEach(user => {
                    this.users.set(user.id, user);
                });
            }
        } catch (error) {
            Logger.error('Failed to load users', { error: error.message });
        }
    }

    saveUsers() {
        try {
            const data = Array.from(this.users.values());
            fs.writeFileSync(this.dataFile, JSON.stringify(data, null, 2));
        } catch (error) {
            Logger.error('Failed to save users', { error: error.message });
        }
    }

    async addUser(userData) {
        const userId = userData.id || `user_${Date.now()}`;

        if (this.users.has(userId)) {
            throw new Error('User already exists');
        }

        const user = {
            id: userId,
            name: userData.name,
            phone: userData.phone,
            email: userData.email || '',
            status: 'inactive',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this.users.set(userId, user);
        this.saveUsers();

        return user;
    }

    async updateUser(userId, updates) {
        const user = this.users.get(userId);
        if (!user) {
            throw new Error('User not found');
        }

        Object.assign(user, updates, { updatedAt: new Date().toISOString() });
        this.saveUsers();

        return user;
    }

    async deleteUser(userId) {
        const user = this.users.get(userId);
        if (!user) {
            throw new Error('User not found');
        }

        await this.stopSession(userId);
        this.users.delete(userId);
        this.saveUsers();

        return { success: true };
    }

    getUser(userId) {
        return this.users.get(userId);
    }

    getAllUsers() {
        return Array.from(this.users.values());
    }

    async startSession(userId) {
        const user = this.users.get(userId);
        if (!user) {
            throw new Error('User not found');
        }

        if (this.clients.has(userId)) {
            throw new Error('Session already active');
        }

        const client = new Client({
            authStrategy: new LocalAuth({ clientId: userId }),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        });

        const sessionData = {
            client,
            qrCode: null,
            status: 'initializing'
        };

        this.clients.set(userId, sessionData);

        client.on('qr', (qr) => {
            sessionData.qrCode = qr;
            sessionData.status = 'qr_ready';
            user.status = 'qr_ready';
            this.saveUsers();
        });

        client.on('ready', () => {
            sessionData.status = 'connected';
            user.status = 'connected';
            this.saveUsers();
            Logger.info('Client ready', { userId });
        });

        client.on('authenticated', () => {
            sessionData.status = 'authenticated';
            user.status = 'authenticated';
            this.saveUsers();
        });

        client.on('auth_failure', () => {
            sessionData.status = 'auth_failed';
            user.status = 'auth_failed';
            this.saveUsers();
        });

        client.on('disconnected', async () => {
            sessionData.status = 'disconnected';
            user.status = 'disconnected';
            this.saveUsers();
            await this.stopSession(userId);
        });

        try {
            await client.initialize();
            return { success: true, status: sessionData.status };
        } catch (error) {
            this.clients.delete(userId);
            user.status = 'error';
            this.saveUsers();
            throw error;
        }
    }

    async stopSession(userId) {
        const sessionData = this.clients.get(userId);
        if (!sessionData) {
            return { success: true, message: 'No active session' };
        }

        try {
            await sessionData.client.destroy();
        } catch (error) {
            Logger.error('Error stopping session', { userId, error: error.message });
        }

        this.clients.delete(userId);

        const user = this.users.get(userId);
        if (user) {
            user.status = 'inactive';
            this.saveUsers();
        }

        return { success: true };
    }

    async restartSession(userId) {
        await this.stopSession(userId);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return await this.startSession(userId);
    }

    getSessionStatus(userId) {
        const sessionData = this.clients.get(userId);
        const user = this.users.get(userId);

        return {
            userId,
            status: user?.status || 'inactive',
            hasActiveSession: this.clients.has(userId),
            qrAvailable: sessionData?.qrCode ? true : false
        };
    }

    getQRCode(userId) {
        const sessionData = this.clients.get(userId);
        if (!sessionData || !sessionData.qrCode) {
            return null;
        }
        return sessionData.qrCode;
    }

    async cleanup() {
        const userIds = Array.from(this.clients.keys());
        for (const userId of userIds) {
            await this.stopSession(userId);
        }
    }
}

module.exports = UserManager;
