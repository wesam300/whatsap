// ========================================
// Session Manager - Professional WhatsApp Session Lifecycle
// ========================================
// Centralized session management with:
// - State machine for session lifecycle
// - Smart reconnection with exponential backoff
// - Heartbeat health checks (RAM efficient)
// - Centralized cleanup and resource management

const fs = require('fs');
const path = require('path');

// ========================================
// Constants
// ========================================

// Reconnection config (maxRetries: 0 = unlimited for production stability)
const RECONNECT_CONFIG = {
    maxRetries: 0,          // 0 = unlimited; لا نوقف إعادة الاتصال إلا بعد انقطاع 14+ يوم أو انتهاء/إيقاف
    baseDelay: 10000,       // 10 seconds initial
    maxDelay: 120000,       // 2 minutes max
    backoffMultiplier: 1.5, // Exponential backoff
};

// Health check config — مهلات طويلة لتجنب فصل الجلسات فجأة (إنتاج)
const HEALTH_CONFIG = {
    heartbeatInterval: 60000,           // Check every 60 seconds
    authenticatedTimeout: 30 * 60 * 1000,  // 30 min في حالة authenticated قبل اعتبارها عالقة
    connectingTimeout: 30 * 60 * 1000,     // 30 min في حالة connecting قبل اعتبارها عالقة
};

// الجلسات المفصولة أكثر من هذه المدة لا تُعاد محاولة الاتصال تلقائياً ولا تُدمّر/تُحذف تلقائياً إلا بهذا الشرط
const DISCONNECTED_CLEANUP_DAYS = 14;

// ========================================
// Chrome Path Detection
// ========================================

function getChromeExecutablePath() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        const p = process.env.PUPPETEER_EXECUTABLE_PATH;
        if (fs.existsSync(p)) return p;
    }
    const isWin = process.platform === 'win32';
    const candidates = isWin
        ? [
            path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
            path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
        ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/snap/bin/chromium',
        ];
    for (const p of candidates) {
        if (p && fs.existsSync(p)) return p;
    }
    return null;
}

// ========================================
// Puppeteer Options
// ========================================

function getPuppeteerOptions() {
    const chromePath = getChromeExecutablePath();
    const options = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-application-cache',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-breakpad',
            '--disable-client-side-phishing-detection',
            '--disable-component-update',
            '--disable-default-apps',
            '--disable-domain-reliability',
            '--disable-features=TranslateUI',
            '--disable-hang-monitor',
            '--disable-ipc-flooding-protection',
            '--disable-notifications',
            '--disable-offer-store-unmasked-wallet-cards',
            '--disable-popup-blocking',
            '--disable-prompt-on-repost',
            '--disable-renderer-backgrounding',
            '--disable-sync',
            '--disable-translate',
            '--metrics-recording-only',
            '--no-first-run',
            '--safebrowsing-disable-auto-update',
            '--enable-automation',
            '--password-store=basic',
            '--use-mock-keychain',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=BlinkHeapDirtyFlag,BlinkHeapIncrementalMarking',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
    };
    if (chromePath) {
        options.executablePath = chromePath;
    }
    return options;
}

// ========================================
// Session Metadata Tracker
// ========================================
// Tracks per-session metadata: timers, retry count, state timestamps
// This avoids scattered Maps and Sets throughout the codebase

class SessionTracker {
    constructor() {
        // sessionId -> { reconnectTimer, reconnectCount, healthTimer, stateTimestamp, isReconnecting }
        this._meta = new Map();
    }

    _ensure(sessionId) {
        const key = String(sessionId);
        if (!this._meta.has(key)) {
            this._meta.set(key, {
                reconnectTimer: null,
                reconnectCount: 0,
                healthTimer: null,
                stateTimestamp: Date.now(),
                isReconnecting: false,
            });
        }
        return this._meta.get(key);
    }

    get(sessionId) {
        return this._ensure(String(sessionId));
    }

    setReconnecting(sessionId, value) {
        this._ensure(sessionId).isReconnecting = !!value;
    }

    isReconnecting(sessionId) {
        return this._ensure(sessionId).isReconnecting;
    }

    setReconnectTimer(sessionId, timer) {
        const meta = this._ensure(sessionId);
        if (meta.reconnectTimer) clearTimeout(meta.reconnectTimer);
        meta.reconnectTimer = timer;
    }

    clearReconnectTimer(sessionId) {
        const meta = this._ensure(sessionId);
        if (meta.reconnectTimer) {
            clearTimeout(meta.reconnectTimer);
            meta.reconnectTimer = null;
        }
    }

    incrementReconnect(sessionId) {
        const meta = this._ensure(sessionId);
        meta.reconnectCount++;
        return meta.reconnectCount;
    }

    resetReconnect(sessionId) {
        const meta = this._ensure(sessionId);
        meta.reconnectCount = 0;
        meta.isReconnecting = false;
        this.clearReconnectTimer(sessionId);
    }

    getReconnectCount(sessionId) {
        return this._ensure(sessionId).reconnectCount;
    }

    setHealthTimer(sessionId, timer) {
        const meta = this._ensure(sessionId);
        if (meta.healthTimer) clearInterval(meta.healthTimer);
        meta.healthTimer = timer;
    }

    clearHealthTimer(sessionId) {
        const meta = this._ensure(sessionId);
        if (meta.healthTimer) {
            clearInterval(meta.healthTimer);
            meta.healthTimer = null;
        }
    }

    updateStateTimestamp(sessionId) {
        this._ensure(sessionId).stateTimestamp = Date.now();
    }

    getStateAge(sessionId) {
        return Date.now() - this._ensure(sessionId).stateTimestamp;
    }

    /**
     * Full cleanup for a session - clears all timers and metadata
     */
    cleanup(sessionId) {
        const key = String(sessionId);
        const meta = this._meta.get(key);
        if (meta) {
            if (meta.reconnectTimer) clearTimeout(meta.reconnectTimer);
            if (meta.healthTimer) clearInterval(meta.healthTimer);
            this._meta.delete(key);
        }
    }

    /**
     * Cleanup all sessions
     */
    cleanupAll() {
        for (const [key, meta] of this._meta.entries()) {
            if (meta.reconnectTimer) clearTimeout(meta.reconnectTimer);
            if (meta.healthTimer) clearInterval(meta.healthTimer);
        }
        this._meta.clear();
    }

    get size() {
        return this._meta.size;
    }
}

// Singleton tracker instance
const sessionTracker = new SessionTracker();

// ========================================
// Client Destruction
// ========================================

async function destroyClientCompletely(sessionId, client, reconnectionTimers = null) {
    try {
        if (!client) {
            console.log(`[${sessionId}] No client to destroy`);
            return;
        }

        console.log(`[${sessionId}] Destroying client completely...`);

        // Clear all timers via tracker
        sessionTracker.clearReconnectTimer(sessionId);
        sessionTracker.clearHealthTimer(sessionId);

        // Legacy: also clear from reconnectionTimers map if passed
        if (reconnectionTimers && reconnectionTimers.has(String(sessionId))) {
            clearTimeout(reconnectionTimers.get(String(sessionId)));
            reconnectionTimers.delete(String(sessionId));
        }

        // Step 1: Close browser pages
        let puppeteerBrowser = null;
        try {
            puppeteerBrowser = client.pupBrowser ||
                (client.pupPage && !client.pupPage.isClosed() ? client.pupPage.browser() : null) ||
                null;
        } catch (e) { /* ignore */ }

        if (puppeteerBrowser) {
            try {
                const pages = await puppeteerBrowser.pages();
                const closePromises = [];
                for (const page of pages || []) {
                    try {
                        if (page && typeof page.isClosed === 'function' && !page.isClosed() && typeof page.close === 'function') {
                            closePromises.push(page.close().catch(() => { }));
                        }
                    } catch (e) { /* ignore */ }
                }
                await Promise.all(closePromises);
            } catch (e) { /* ignore */ }

            // Step 2: Close browser
            try {
                if (typeof puppeteerBrowser.close === 'function') {
                    await puppeteerBrowser.close();
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            } catch (e) { /* ignore */ }
        }

        // Step 3: Destroy client
        try {
            await client.destroy();
        } catch (e) { /* ignore */ }

        // Step 4: Force kill Chrome process if needed
        try {
            const browser = client.pupBrowser || (client.pupPage && client.pupPage.browser ? client.pupPage.browser() : null);
            if (browser && browser.process) {
                const proc = browser.process();
                if (proc && proc.pid) {
                    const { exec } = require('child_process');
                    const { promisify } = require('util');
                    const execAsync = promisify(exec);
                    try {
                        if (process.platform === 'win32') {
                            await execAsync(`taskkill /F /T /PID ${proc.pid}`);
                        } else {
                            await execAsync(`kill -9 ${proc.pid}`);
                        }
                    } catch (e) { /* process may already be dead */ }
                }
            }
        } catch (e) { /* ignore */ }

        console.log(`[${sessionId}] Client destroyed successfully`);
    } catch (error) {
        console.error(`[${sessionId}] Error destroying client:`, error.message);
    }
}

// ========================================
// Chrome Zombie Cleanup
// ========================================

async function cleanupChromeZombies() {
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);
    const platform = process.platform;

    console.log('🧹 Cleaning up zombie Chrome processes...');

    try {
        if (platform === 'linux' || platform === 'darwin') {
            try {
                const { stdout } = await execAsync('pgrep -f "chrome.*session-session_"');
                const pids = stdout.trim().split('\n').filter(Boolean);

                if (pids.length > 0) {
                    console.log(`🔫 Found ${pids.length} zombie processes: ${pids.join(', ')}`);
                    for (const pid of pids) {
                        try {
                            await execAsync(`kill -15 ${pid}`).catch(() => { });
                            await new Promise(resolve => setTimeout(resolve, 500));
                            await execAsync(`kill -9 ${pid}`).catch(() => { });
                        } catch (e) { /* ignore */ }
                    }
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    console.log('✅ Zombie processes cleaned');
                    return pids.length;
                } else {
                    console.log('✨ No zombie processes found');
                }
            } catch (e) {
                if (e.code === 1) {
                    console.log('✨ No zombie processes found');
                } else {
                    throw e;
                }
            }
        } else if (platform === 'win32') {
            try {
                await execAsync('wmic process where "name=\'chrome.exe\' and commandline like \'%session-session_%\'" call terminate');
                console.log('✅ Windows cleanup attempted');
            } catch (e) {
                console.log('ℹ️ Windows cleanup done (no matching processes)');
            }
        }
    } catch (error) {
        console.error('⚠️ Error cleaning zombie processes:', error.message);
    }
    return 0;
}

// ========================================
// Heartbeat Health Check
// ========================================
// A single, RAM-efficient heartbeat per session that:
// 1. Detects stuck "authenticated" state → forces reconnect
// 2. Detects disconnected clients → triggers reconnect
// 3. Syncs actual client state with DB state

function startSessionHeartbeat(sessionId, { db, activeClients, io, onReconnect }) {
    // Clear any existing heartbeat
    sessionTracker.clearHealthTimer(sessionId);
    sessionTracker.updateStateTimestamp(sessionId);

    const timer = setInterval(() => {
        try {
            const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
            if (!session) {
                // Session deleted from DB
                sessionTracker.clearHealthTimer(sessionId);
                return;
            }

            // Skip paused/expired sessions
            if (session.is_paused === 1 || session.status === 'expired') {
                return;
            }

            // Check expiry
            if (session.expires_at) {
                const row = db.prepare('SELECT datetime(?) <= CURRENT_TIMESTAMP as expired').get(session.expires_at);
                if (row && row.expired) {
                    console.log(`[${sessionId}] ⏰ Session expired during heartbeat`);
                    db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('expired', sessionId);
                    io.emit('session_disconnected', { sessionId, reason: 'EXPIRED' });
                    sessionTracker.clearHealthTimer(sessionId);
                    return;
                }
            }

            const hasClient = activeClients.has(String(sessionId));
            const client = hasClient ? activeClients.get(String(sessionId)) : null;
            const stateAge = sessionTracker.getStateAge(sessionId);

            // --- Case 1: Stuck in "authenticated" state ---
            if (session.status === 'authenticated') {
                if (stateAge > HEALTH_CONFIG.authenticatedTimeout) {
                    console.log(`[${sessionId}] ⚠️ Stuck in 'authenticated' for ${Math.round(stateAge / 1000)}s`);

                    if (hasClient && client && client.info) {
                        // Client is actually ready, just the DB state is wrong
                        console.log(`[${sessionId}] ✅ Client is actually ready, updating DB to connected`);
                        db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('connected', sessionId);
                        io.emit('session_connected', { sessionId });
                        io.emit('session_ready', { sessionId });
                        sessionTracker.updateStateTimestamp(sessionId);
                    } else {
                        // Genuinely stuck - trigger reconnect
                        console.log(`[${sessionId}] 🔄 Triggering reconnect from stuck authenticated`);
                        db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('disconnected', sessionId);
                        io.emit('session_disconnected', { sessionId, reason: 'AUTHENTICATED_TIMEOUT' });
                        sessionTracker.updateStateTimestamp(sessionId);

                        if (hasClient && client) {
                            destroyClientCompletely(sessionId, client).then(() => {
                                activeClients.delete(String(sessionId));
                                if (typeof onReconnect === 'function') {
                                    onReconnect(sessionId);
                                }
                            });
                        } else {
                            activeClients.delete(String(sessionId));
                            if (typeof onReconnect === 'function') {
                                onReconnect(sessionId);
                            }
                        }
                    }
                } else if (hasClient && client && client.info) {
                    // Client became ready before timeout - just update DB
                    console.log(`[${sessionId}] ✅ Client ready (detected by heartbeat), updating DB`);
                    db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('connected', sessionId);
                    io.emit('session_connected', { sessionId });
                    io.emit('session_ready', { sessionId });
                    sessionTracker.updateStateTimestamp(sessionId);
                }
            }

            // --- Case 2: DB says connected but no active client ---
            if (session.status === 'connected' && !hasClient) {
                console.log(`[${sessionId}] ⚠️ DB says connected but no client found`);
                db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('disconnected', sessionId);
                io.emit('session_disconnected', { sessionId, reason: 'NO_CLIENT' });
                sessionTracker.updateStateTimestamp(sessionId);
                if (typeof onReconnect === 'function') {
                    onReconnect(sessionId);
                }
            }

            // --- Case 3: DB says connected, client exists but not actually ready ---
            if (session.status === 'connected' && hasClient && client) {
                // Check if the puppeteer page is still alive
                try {
                    if (client.pupPage && client.pupPage.isClosed()) {
                        console.log(`[${sessionId}] ⚠️ Browser page is closed, triggering reconnect`);
                        db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('disconnected', sessionId);
                        io.emit('session_disconnected', { sessionId, reason: 'PAGE_CLOSED' });
                        sessionTracker.updateStateTimestamp(sessionId);

                        destroyClientCompletely(sessionId, client).then(() => {
                            activeClients.delete(String(sessionId));
                            if (typeof onReconnect === 'function') {
                                onReconnect(sessionId);
                            }
                        });
                    }
                } catch (e) {
                    // If we can't even check, the client is dead
                    console.log(`[${sessionId}] ⚠️ Cannot check client health, triggering reconnect`);
                    db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('disconnected', sessionId);
                    io.emit('session_disconnected', { sessionId, reason: 'CLIENT_ERROR' });
                    sessionTracker.updateStateTimestamp(sessionId);

                    destroyClientCompletely(sessionId, client).then(() => {
                        activeClients.delete(String(sessionId));
                        if (typeof onReconnect === 'function') {
                            onReconnect(sessionId);
                        }
                    });
                }
            }

            // --- Case 4: Stuck in "connecting" state ---
            if (session.status === 'connecting' && stateAge > HEALTH_CONFIG.connectingTimeout) {
                console.log(`[${sessionId}] ⚠️ Stuck in 'connecting' for ${Math.round(stateAge / 1000)}s`);
                db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('disconnected', sessionId);
                io.emit('session_disconnected', { sessionId, reason: 'CONNECTING_TIMEOUT' });
                sessionTracker.updateStateTimestamp(sessionId);

                if (hasClient && client) {
                    destroyClientCompletely(sessionId, client).then(() => {
                        activeClients.delete(String(sessionId));
                        if (typeof onReconnect === 'function') {
                            onReconnect(sessionId);
                        }
                    });
                }
            }

        } catch (error) {
            console.error(`[${sessionId}] Heartbeat error:`, error.message);
        }
    }, HEALTH_CONFIG.heartbeatInterval);

    sessionTracker.setHealthTimer(sessionId, timer);
}

// ========================================
// Smart Reconnection with Exponential Backoff
// ========================================

async function smartReconnect(sessionId, { db, activeClients, io, Client, LocalAuth, setupHandlers, sessionsDir }) {
    const key = String(sessionId);

    // Prevent concurrent reconnection
    if (sessionTracker.isReconnecting(sessionId)) {
        console.log(`[${sessionId}] Reconnection already in progress, skipping`);
        return;
    }

    // Validate session in DB
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) {
        console.log(`[${sessionId}] Session not found in DB, aborting reconnect`);
        sessionTracker.resetReconnect(sessionId);
        return;
    }

    // إيقاف إعادة الاتصال التلقائي فقط بعد انقطاع أكثر من DISCONNECTED_CLEANUP_DAYS (لا تدمير/حذف فجأة)
    if (session.status === 'disconnected' && session.updated_at) {
        const updatedAt = new Date(session.updated_at).getTime();
        const cutoff = Date.now() - DISCONNECTED_CLEANUP_DAYS * 24 * 60 * 60 * 1000;
        if (updatedAt < cutoff) {
            console.log(`[${sessionId}] Session disconnected for > ${DISCONNECTED_CLEANUP_DAYS} days, skipping auto-reconnect`);
            sessionTracker.resetReconnect(sessionId);
            return;
        }
    }

    // Check if max retries exceeded (0 = unlimited)
    const retryCount = sessionTracker.getReconnectCount(sessionId);
    if (RECONNECT_CONFIG.maxRetries > 0 && retryCount >= RECONNECT_CONFIG.maxRetries) {
        console.log(`[${sessionId}] Max reconnection retries (${RECONNECT_CONFIG.maxRetries}) exhausted`);
        sessionTracker.resetReconnect(sessionId);
        db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('disconnected', sessionId);
        io.emit('session_disconnected', { sessionId, reason: 'MAX_RETRIES' });
        return;
    }

    if (session.is_paused === 1 || session.status === 'expired') {
        console.log(`[${sessionId}] Session paused/expired, aborting reconnect`);
        sessionTracker.resetReconnect(sessionId);
        return;
    }

    // Check expiry
    if (session.expires_at) {
        const row = db.prepare('SELECT datetime(?) <= CURRENT_TIMESTAMP as expired').get(session.expires_at);
        if (row && row.expired) {
            console.log(`[${sessionId}] Session expired, aborting reconnect`);
            db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('expired', sessionId);
            sessionTracker.resetReconnect(sessionId);
            return;
        }
    }

    // Already has active client
    if (activeClients.has(key)) {
        console.log(`[${sessionId}] Client already active, aborting reconnect`);
        sessionTracker.resetReconnect(sessionId);
        return;
    }

    // Check if session data exists (can we reconnect without QR?)
    const sessionPath = path.join(sessionsDir, `session-session_${sessionId}`);
    const hasSessionData = fs.existsSync(sessionPath);
    if (!hasSessionData) {
        console.log(`[${sessionId}] No session data found, cannot auto-reconnect (needs QR scan)`);
        sessionTracker.resetReconnect(sessionId);
        db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('disconnected', sessionId);
        return;
    }

    // Calculate delay with exponential backoff
    const currentRetry = sessionTracker.incrementReconnect(sessionId);
    const delay = Math.min(
        RECONNECT_CONFIG.baseDelay * Math.pow(RECONNECT_CONFIG.backoffMultiplier, currentRetry - 1),
        RECONNECT_CONFIG.maxDelay
    );

    const retryLabel = RECONNECT_CONFIG.maxRetries === 0 ? '∞' : RECONNECT_CONFIG.maxRetries;
    console.log(`[${sessionId}] 🔄 Scheduling reconnect #${currentRetry}/${retryLabel} in ${Math.round(delay / 1000)}s`);

    const timer = setTimeout(async () => {
        sessionTracker.setReconnecting(sessionId, true);

        try {
            // Re-validate before attempting
            const sessionRecheck = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
            if (!sessionRecheck || sessionRecheck.is_paused === 1 || sessionRecheck.status === 'expired') {
                console.log(`[${sessionId}] Session invalid, aborting reconnect`);
                sessionTracker.resetReconnect(sessionId);
                return;
            }

            if (activeClients.has(key)) {
                console.log(`[${sessionId}] Client appeared during wait, aborting reconnect`);
                sessionTracker.resetReconnect(sessionId);
                return;
            }

            // Clean session folder locks
            await cleanSessionLocks(sessionId, sessionsDir);

            // Wait a moment after cleanup
            await new Promise(resolve => setTimeout(resolve, 2000));

            console.log(`[${sessionId}] 🔌 Attempting reconnection #${currentRetry}...`);

            // Update DB status
            db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('connecting', sessionId);
            sessionTracker.updateStateTimestamp(sessionId);

            // Create new client
            const client = new Client({
                authStrategy: new LocalAuth({
                    clientId: `session_${sessionId}`,
                    dataPath: sessionsDir
                }),
                puppeteer: getPuppeteerOptions()
            });

            activeClients.set(key, client);

            // Setup handlers
            if (typeof setupHandlers === 'function') {
                setupHandlers(sessionId, client);
            }

            await client.initialize();

            console.log(`[${sessionId}] ✅ Reconnection #${currentRetry} successful`);
            sessionTracker.resetReconnect(sessionId);

        } catch (error) {
            console.error(`[${sessionId}] ❌ Reconnection #${currentRetry} failed:`, error.message);

            // Remove from map first so no other code touches the broken client
            let failedClient = null;
            if (activeClients.has(key)) {
                failedClient = activeClients.get(key);
                activeClients.delete(key);
            }
            sessionTracker.setReconnecting(sessionId, false);

            // Safe cleanup with timeout (Puppeteer can hang on close when target is dead)
            if (failedClient) {
                try {
                    await Promise.race([
                        destroyClientCompletely(sessionId, failedClient),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('destroy_timeout')), 15000))
                    ]);
                } catch (e) { /* ignore cleanup errors */ }
            }

            // Schedule next attempt (unlimited when maxRetries === 0)
            if (RECONNECT_CONFIG.maxRetries === 0 || sessionTracker.getReconnectCount(sessionId) < RECONNECT_CONFIG.maxRetries) {
                smartReconnect(sessionId, { db, activeClients, io, Client, LocalAuth, setupHandlers, sessionsDir });
            } else {
                console.log(`[${sessionId}] Max retries exhausted after failure`);
                sessionTracker.resetReconnect(sessionId);
                db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('disconnected', sessionId);
                io.emit('session_disconnected', { sessionId, reason: 'MAX_RETRIES' });
            }
        }
    }, delay);

    sessionTracker.setReconnectTimer(sessionId, timer);
}

// ========================================
// Session Folder Cleanup Helpers
// ========================================

async function killProcessesForSession(sessionId, execAsync) {
    const pattern = `session-session_${sessionId}`;
    let pids = [];
    try {
        const { stdout } = await execAsync(`pgrep -f "${pattern}"`);
        pids = stdout.trim().split('\n').filter(Boolean);
    } catch (e) { /* لا عمليات مطابقة */ }
    pids = pids.filter(pid => pid !== String(process.pid));
    if (pids.length > 0) {
        console.log(`[${sessionId}] Killing ${pids.length} associated processes`);
        await execAsync(`kill -9 ${pids.join(' ')}`).catch(() => {});
    }
    return pids.length;
}

async function cleanSessionLocks(sessionId, sessionsDir) {
    try {
        const sessionPath = path.join(sessionsDir, `session-session_${sessionId}`);
        const fsPromises = require('fs').promises;
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        if (process.platform === 'linux' || process.platform === 'darwin') {
            // جولة أولى: قتل العمليات ثم انتظار حتى تخرج العمليات الفرعية
            await killProcessesForSession(sessionId, execAsync);
            await new Promise(resolve => setTimeout(resolve, 2200));
            // جولة ثانية: قتل أي عملية متبقية (مثلاً عمليات فرعية ظهرت بعد موت الأب)
            const killed = await killProcessesForSession(sessionId, execAsync);
            if (killed > 0) {
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }

        // إزالة ملفات القفل
        const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
        for (const lockFile of lockFiles) {
            const lockPath = path.join(sessionPath, lockFile);
            try {
                await fsPromises.unlink(lockPath);
            } catch (e) {
                if (e.code !== 'ENOENT') {
                    for (let i = 0; i < 3; i++) {
                        await new Promise(resolve => setTimeout(resolve, 500));
                        try {
                            await fsPromises.unlink(lockPath);
                            break;
                        } catch (retryErr) {
                            if (retryErr.code === 'ENOENT') break;
                        }
                    }
                }
            }
        }

        return true;
    } catch (error) {
        console.error(`[${sessionId}] Error cleaning session locks:`, error.message);
        return false;
    }
}

// ========================================
// Startup: Restore Sessions
// ========================================

async function restoreSessions({ db, activeClients, io, Client, LocalAuth, setupHandlers, sessionsDir }) {
    try {
        // Find all sessions that should be restored
        const sessions = db.prepare(`
            SELECT * FROM sessions 
            WHERE status IN ('connected', 'authenticated', 'disconnected', 'connecting')
            AND is_paused = 0
        `).all();

        console.log(`🔍 Found ${sessions.length} sessions to potentially restore`);

        let restoredCount = 0;
        let skippedCount = 0;

        const disconnectedCutoff = Date.now() - DISCONNECTED_CLEANUP_DAYS * 24 * 60 * 60 * 1000;

        for (const session of sessions) {
            try {
                // Check expiry
                if (session.expires_at) {
                    const row = db.prepare('SELECT datetime(?) <= CURRENT_TIMESTAMP as expired').get(session.expires_at);
                    if (row && row.expired) {
                        db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('expired', session.id);
                        skippedCount++;
                        continue;
                    }
                }

                // عدم استعادة الجلسات المفصولة منذ أكثر من 14 يوماً (لا تدمير ولا حذف، فقط لا نستعيدها تلقائياً)
                if (session.status === 'disconnected' && session.updated_at) {
                    if (new Date(session.updated_at).getTime() < disconnectedCutoff) {
                        skippedCount++;
                        continue;
                    }
                }

                // Check if session data exists
                const sessionPath = path.join(sessionsDir, `session-session_${session.id}`);
                if (!fs.existsSync(sessionPath)) {
                    console.log(`[${session.id}] No session data, setting to disconnected`);
                    db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('disconnected', session.id);
                    skippedCount++;
                    continue;
                }

                // Skip if already active
                if (activeClients.has(String(session.id))) {
                    skippedCount++;
                    continue;
                }

                console.log(`[${session.id}] 🔄 Restoring session "${session.session_name}"...`);

                // Clean locks first
                await cleanSessionLocks(session.id, sessionsDir);

                // Update status to connecting
                db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('connecting', session.id);
                sessionTracker.updateStateTimestamp(session.id);
                if (io && typeof io.emit === 'function') {
                    io.emit('session_connecting', { sessionId: session.id });
                }

                // Create client
                const client = new Client({
                    authStrategy: new LocalAuth({
                        clientId: `session_${session.id}`,
                        dataPath: sessionsDir
                    }),
                    puppeteer: getPuppeteerOptions()
                });

                activeClients.set(String(session.id), client);

                // Setup handlers
                if (typeof setupHandlers === 'function') {
                    setupHandlers(session.id, client);
                }

                // Initialize
                await client.initialize();
                restoredCount++;

                // Stagger: wait between sessions to avoid overloading
                await new Promise(resolve => setTimeout(resolve, 3000));

            } catch (error) {
                const errMsg = error == null ? 'unknown' : (error.message || (typeof error.toString === 'function' ? error.toString() : String(error)));
                console.error(`[${session.id}] Failed to restore:`, errMsg);

                // Remove from map first, then cleanup (avoids use of broken client)
                const failedClient = activeClients.get(String(session.id));
                activeClients.delete(String(session.id));
                if (failedClient) {
                    try {
                        await Promise.race([
                            destroyClientCompletely(session.id, failedClient),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('destroy_timeout')), 15000))
                        ]);
                    } catch (e) { /* ignore */ }
                }

                db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('disconnected', session.id);
            }
        }

        console.log(`✅ Restored ${restoredCount} sessions, skipped ${skippedCount}`);
        return { restoredCount, skippedCount };
    } catch (error) {
        console.error('Error restoring sessions:', error);
        return { restoredCount: 0, skippedCount: 0 };
    }
}

// ========================================
// Exports
// ========================================

module.exports = {
    // Constants
    RECONNECT_CONFIG,
    HEALTH_CONFIG,
    DISCONNECTED_CLEANUP_DAYS,

    // Core functions
    destroyClientCompletely,
    cleanupChromeZombies,
    getPuppeteerOptions,

    // Session tracker
    sessionTracker,

    // Heartbeat
    startSessionHeartbeat,

    // Reconnection
    smartReconnect,

    // Helpers
    cleanSessionLocks,

    // Startup
    restoreSessions,
};
