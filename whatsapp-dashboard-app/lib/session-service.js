const path = require('path');
const fs = require('fs').promises;
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');

const HEARTBEAT_MS = 2 * 60 * 1000;
const HEARTBEAT_UNHEALTHY = 2;

class SessionService {
    constructor(deps) {
        this.db = deps.db;
        this.io = deps.io;
        this.getPuppeteerOptions = deps.getPuppeteerOptions;
        this.killChrome = deps.killChromeProcessesForSession;
        this.destroyBase = deps.destroyClientCompletely;
        this.isHealthy = deps.isClientHealthy;

        this.clients = new Map();
        this.startLocks = new Set();
        this.reconnectTimers = new Map();
        this.reconnecting = new Set();
        this.heartbeats = new Map();
    }

    _sid(sessionId) {
        return String(sessionId);
    }

    _updateStatus(sessionId, status) {
        this.db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(status, sessionId);
    }

    getClient(sessionId) {
        return this.clients.get(this._sid(sessionId)) || null;
    }

    getMap() {
        return this.clients;
    }

    updateStatus(sessionId, status) {
        this._updateStatus(sessionId, status);
    }

    async cleanupFolder(sessionId) {
        const sessionPath = path.join(__dirname, '..', 'sessions', `session-session_${sessionId}`);
        const lockFile = path.join(sessionPath, 'SingletonLock');
        const cookieFile = path.join(sessionPath, 'SingletonCookie');
        try {
            await this.killChrome(sessionId);
            await new Promise(r => setTimeout(r, 2000));
            await this.killChrome(sessionId);
            await new Promise(r => setTimeout(r, 1200));
        } catch (e) {
            console.warn(`[${sessionId}] cleanup kill:`, e.message);
        }
        let retries = 3;
        while (retries > 0) {
            try {
                await fs.unlink(lockFile);
                break;
            } catch (e) {
                if (e.code === 'ENOENT') break;
                if (e.code === 'EBUSY' || e.code === 'EACCES') {
                    retries--;
                    if (retries > 0) await new Promise(r => setTimeout(r, 1000));
                } else break;
            }
        }
        try {
            await fs.unlink(cookieFile);
        } catch (e) {
            if (e.code !== 'ENOENT') {}
        }
        await new Promise(r => setTimeout(r, 1500));
    }

    _createClient(sessionId) {
        return new Client({
            authStrategy: new LocalAuth({
                clientId: `session_${sessionId}`,
                dataPath: path.join(__dirname, '..', 'sessions')
            }),
            puppeteer: this.getPuppeteerOptions(),
            authTimeoutMs: 60000
        });
    }

    _stopHeartbeat(sessionId) {
        const sid = this._sid(sessionId);
        if (this.heartbeats.has(sid)) {
            clearInterval(this.heartbeats.get(sid));
            this.heartbeats.delete(sid);
        }
    }

    _startHeartbeat(sessionId, client) {
        this._stopHeartbeat(sessionId);
        const sid = this._sid(sessionId);
        let unhealthy = 0;
        const intervalId = setInterval(async () => {
            try {
                const c = this.clients.get(sid);
                if (!c) {
                    this._stopHeartbeat(sessionId);
                    return;
                }
                const healthy = await this.isHealthy(c);
                if (!healthy) {
                    unhealthy++;
                    if (unhealthy < HEARTBEAT_UNHEALTHY) return;
                    unhealthy = 0;
                    this._stopHeartbeat(sessionId);
                    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
                    if (row && row.is_paused !== 1 && row.status !== 'expired') {
                        await this.stopSession(sessionId, c);
                        this._updateStatus(sessionId, 'disconnected');
                        this.io.emit('session_disconnected', { sessionId, reason: 'heartbeat_failure' });
                        await this._attemptReconnection(sessionId, 3, 5000);
                    }
                } else {
                    unhealthy = 0;
                }
            } catch (e) {
                console.error(`[${sessionId}] heartbeat:`, e.message);
            }
        }, HEARTBEAT_MS);
        this.heartbeats.set(sid, intervalId);
    }

    async _attemptReconnection(sessionId, maxRetries, delay) {
        const sid = this._sid(sessionId);
        if (this.reconnectTimers.has(sid)) {
            clearTimeout(this.reconnectTimers.get(sid));
            this.reconnectTimers.delete(sid);
        }
        const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
        if (!row || row.is_paused === 1 || row.status === 'expired') return;
        if (row.expires_at) {
            const exp = this.db.prepare('SELECT datetime(?) <= CURRENT_TIMESTAMP as expired').get(row.expires_at);
            if (exp.expired) return;
        }
        let retryCount = 0;
        const reconnect = async () => {
            const r = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
            if (!r || r.is_paused === 1 || r.status === 'expired') {
                this.reconnectTimers.delete(sid);
                return;
            }
            if (this.clients.has(sid)) {
                this.reconnectTimers.delete(sid);
                return;
            }
            retryCount++;
            try {
                await new Promise(r => setTimeout(r, 2000));
                await this.cleanupFolder(sessionId);
                const client = this._createClient(sessionId);
                this.clients.set(sid, client);
                this._setupHandlers(sessionId, client);
                await client.initialize();
                console.log(`[${sessionId}] إعادة اتصال ناجحة`);
                this.reconnectTimers.delete(sid);
            } catch (err) {
                console.error(`[${sessionId}] إعادة اتصال فاشلة:`, err.message);
                this.clients.delete(sid);
                if (err.message && (err.message.includes('already running') || err.message.includes('userDataDir'))) {
                    await this.killChrome(sessionId);
                    await new Promise(r => setTimeout(r, 3000));
                }
                if (retryCount < maxRetries) {
                    const next = err.message && err.message.includes('already running') ? 10000 : delay;
                    this.reconnectTimers.set(sid, setTimeout(reconnect, next));
                } else {
                    this.reconnectTimers.delete(sid);
                    this._updateStatus(sessionId, 'disconnected');
                }
            }
        };
        this.reconnectTimers.set(sid, setTimeout(reconnect, delay));
    }

    _setupHandlers(sessionId, client) {
        const sid = this._sid(sessionId);
        client.on('authenticated', () => {
            this._updateStatus(sessionId, 'authenticated');
            this.io.emit('session_authenticated', { sessionId });
        });
        client.on('ready', async () => {
            this._updateStatus(sessionId, 'connected');
            this.io.emit('session_ready', { sessionId });
            if (this.reconnectTimers.has(sid)) {
                clearTimeout(this.reconnectTimers.get(sid));
                this.reconnectTimers.delete(sid);
            }
            this._startHeartbeat(sessionId, client);
            try {
                const chats = await client.getChats().catch(err => {
                    console.error(`[${sessionId}] خطأ في الحصول على المحادثات:`, err.message);
                    return [];
                });
                let contacts = [];
                try {
                    contacts = await client.getContacts();
                } catch (e) {
                    contacts = chats.filter(c => !c.isGroup).map(c => ({
                        id: c.id._serialized,
                        pushname: c.name || c.id.user,
                        number: c.id.user
                    }));
                }
                const sessionData = {
                    sessionId,
                    chats: chats.map(c => ({ id: c.id._serialized, name: c.name || c.id.user, type: c.isGroup ? 'group' : 'private' })),
                    contacts: contacts.map(c => ({
                        id: (c.id && c.id._serialized) || c.id,
                        name: c.pushname || c.name || (c.id && c.id.user) || c.number,
                        number: (c.id && c.id.user) || c.number
                    }))
                };
                this.db.prepare('UPDATE sessions SET session_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                    .run(JSON.stringify(sessionData), sessionId);
                this.io.emit('session_data', sessionData);
            } catch (e) {
                console.error(`[${sessionId}] خطأ في الحصول على بيانات الجلسة:`, e.message);
            }
        });
        client.on('change_state', (state) => {
            console.log(`[${sessionId}] حالة: ${state}`);
        });
        client.on('disconnected', async (reason) => {
            if (this.reconnecting.has(sid)) return;
            const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
            if (!row || row.is_paused === 1 || row.status === 'expired') {
                await this.stopSession(sessionId, client);
                return;
            }
            this._updateStatus(sessionId, 'disconnected');
            this.io.emit('session_disconnected', { sessionId, reason });
            await this.stopSession(sessionId, client);
            if (reason !== 'LOGGED_OUT' && reason !== 'NAVIGATION') {
                this.reconnecting.add(sid);
                try {
                    await new Promise(r => setTimeout(r, 5000));
                    const r2 = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
                    if (r2 && r2.is_paused !== 1 && r2.status !== 'expired') {
                        await this._attemptReconnection(sessionId, 3, 15000);
                    }
                } finally {
                    this.reconnecting.delete(sid);
                }
            }
        });
        client.on('auth_failure', (msg) => {
            this._updateStatus(sessionId, 'auth_failure');
            this.io.emit('session_auth_failure', { sessionId, error: msg });
        });
        client.on('qr', async (qr) => {
            try {
                const qrCodeDataURL = await QRCode.toDataURL(qr);
                const qrTimestamp = new Date().toISOString();
                this.db.prepare('UPDATE sessions SET qr_code = ?, qr_timestamp = ?, status = ? WHERE id = ?')
                    .run(qrCodeDataURL, qrTimestamp, 'waiting_for_qr', sessionId);
                this.io.emit('qr_code', { sessionId, qrCode: qrCodeDataURL, timestamp: qrTimestamp });
            } catch (e) {
                console.error(`[${sessionId}] QR:`, e.message);
            }
        });
        client.on('loading_screen', (percent, message) => {
            this._updateStatus(sessionId, 'loading');
            this.io.emit('session_loading', { sessionId, percent, message });
        });
    }

    async stopSession(sessionId, client = null) {
        const c = client || this.clients.get(this._sid(sessionId));
        if (!c) return;
        this._stopHeartbeat(sessionId);
        if (this.reconnectTimers.has(this._sid(sessionId))) {
            clearTimeout(this.reconnectTimers.get(this._sid(sessionId)));
            this.reconnectTimers.delete(this._sid(sessionId));
        }
        await this.destroyBase(sessionId, c, this.reconnectTimers);
        this.clients.delete(this._sid(sessionId));
        await this.cleanupFolder(sessionId);
    }

    async startSession(sessionId, options = {}) {
        const sid = this._sid(sessionId);
        if (this.startLocks.has(sid)) {
            throw new Error('الجلسة قيد التشغيل');
        }
        this.startLocks.add(sid);
        try {
            const existing = this.clients.get(sid);
            if (existing) {
                await this.stopSession(sessionId, existing);
                await new Promise(r => setTimeout(r, 2500));
            }
            await this.cleanupFolder(sessionId);
            await new Promise(r => setTimeout(r, 3500));
            const client = this._createClient(sessionId);
            this.clients.set(sid, client);
            this._setupHandlers(sessionId, client);
            this._updateStatus(sessionId, options.status || 'connecting');
            return client;
        } finally {
            setTimeout(() => this.startLocks.delete(sid), 10000);
        }
    }

    isStarting(sessionId) {
        return this.startLocks.has(this._sid(sessionId));
    }

    async restoreOnStartup() {
        const connected = this.db.prepare('SELECT * FROM sessions WHERE status = ?').all('connected');
        for (const session of connected) {
            try {
                await this.cleanupFolder(session.id);
                await new Promise(r => setTimeout(r, 2000));
                const client = this._createClient(session.id);
                this.clients.set(this._sid(session.id), client);
                this._setupHandlers(session.id, client);
                this._updateStatus(session.id, 'connecting');
                client.initialize().catch(async (err) => {
                    console.error(`[${session.id}] فشل إعادة تشغيل:`, err.message);
                    this.clients.delete(this._sid(session.id));
                    this._updateStatus(session.id, 'disconnected');
                });
                await new Promise(r => setTimeout(r, 2000));
            } catch (e) {
                console.error(`[${session.id}] restore:`, e.message);
            }
        }

        const toRestore = this.db.prepare('SELECT * FROM sessions WHERE status IN (?, ?, ?)').all('disconnected', 'connecting', 'authenticated');
        let restored = 0;
        for (const session of toRestore) {
            try {
                const sessionPath = path.join(__dirname, '..', 'sessions', `session-session_${session.id}`);
                const exists = await fs.access(sessionPath).then(() => true).catch(() => false);
                if (!exists) continue;
                if (session.is_paused === 1) continue;
                if (session.expires_at) {
                    const exp = this.db.prepare('SELECT datetime(?) <= CURRENT_TIMESTAMP as expired').get(session.expires_at);
                    if (exp.expired) continue;
                }
                if (this.clients.has(this._sid(session.id)) || this.startLocks.has(this._sid(session.id))) continue;
                this.startLocks.add(this._sid(session.id));
                await this.cleanupFolder(session.id);
                await new Promise(r => setTimeout(r, 2000));
                const client = this._createClient(session.id);
                this.clients.set(this._sid(session.id), client);
                this._setupHandlers(session.id, client);
                this._updateStatus(session.id, 'connecting');
                client.initialize().catch(async (err) => {
                    this.clients.delete(this._sid(session.id));
                    this.startLocks.delete(this._sid(session.id));
                    this._updateStatus(session.id, 'disconnected');
                });
                setTimeout(() => this.startLocks.delete(this._sid(session.id)), 10000);
                restored++;
                await new Promise(r => setTimeout(r, 2000));
            } catch (e) {
                console.error(`[${session.id}] restore disconnected:`, e.message);
            }
        }
        if (restored > 0) {
            console.log(`✅ تم استعادة ${restored} جلسة`);
        }
    }
}

module.exports = { SessionService };
