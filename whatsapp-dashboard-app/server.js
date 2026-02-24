// ========================================
// WhatsApp Dashboard Server
// ========================================
// هذا الملف يحتوي على الخادم الرئيسي للتطبيق
// يدعم إدارة جلسات WhatsApp المتعددة مع نظام تحقق من البريد الإلكتروني

// تحميل متغيرات البيئة
require('dotenv').config();

// Prevent process crash on Puppeteer/Chrome "Target closed" and protocol errors (handled via cleanup in session-manager)
process.on('unhandledRejection', (reason, promise) => {
    const msg = reason && (reason.message || String(reason));
    const name = reason && reason.name;
    if (name === 'TargetCloseError' || (msg && (msg.includes('Target closed') || msg.includes('Protocol error')))) {
        console.warn('⚠️ [Puppeteer] Caught unhandled rejection (target closed/protocol error). Session cleanup will retry.', msg || name);
        return;
    }
});

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs').promises;
const { Client, LocalAuth, MessageMedia, Location } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const cors = require('cors');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { sendVerificationEmail, getServiceStatus } = require('./multi-email-service');
const { router: apiRoutes, setActiveClientsRef, setIoRef } = require('./api-routes');
const {
    createApiKey, getUserApiKeys, deleteApiKey,
    createSessionToken, getUserSessionTokens, deleteSessionToken,
    getUserApiLogs, getUserApiKey, deleteUserApiKey,
    getSessionTokenBySessionId, deleteSessionTokenBySessionId
} = require('./api-key-manager');

// التحكم في تخزين الرسائل (افتراضياً معطّل لضمان عدم حفظ أي رسائل أو ميديا)
const DISABLE_MESSAGE_STORAGE = (process.env.DISABLE_MESSAGE_STORAGE ?? 'true') === 'true';

// Helpers
function ensureUserIsActive(req, res) {
    const user = db.prepare('SELECT is_active FROM users WHERE id = ?').get(req.session.userId);
    if (!user || user.is_active !== 1) {
        res.status(403).json({ error: 'تم إيقاف المستخدم من قبل الإدارة' });
        return false;
    }
    return true;
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Trust proxy (لإصلاح مشكلة express-rate-limit) - استخدام إعداد محدود بدلاً من true
// إذا كان السيرفر خلف proxy (مثل nginx)، استخدم: app.set('trust proxy', 1)
// إذا لم يكن خلف proxy، استخدم: app.set('trust proxy', false)
// هنا نستخدم false لتجنب مشاكل الأمان مع rate limiting
app.set('trust proxy', false);

// Middleware
// CORS configuration (explicit to ensure headers on all responses including errors)
const corsOptions = {
    origin: true, // reflect request origin
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'X-Requested-With', 'x-api-key', 'x-session-token', 'Authorization', 'Accept'],
    exposedHeaders: ['Content-Type'],
    credentials: false,
};

// Rate limiting configurations
// تعطيل التحقق من trust proxy لتجنب الأخطاء
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 1000 requests per windowMs
    message: { error: 'تم تجاوز الحد المسموح من الطلبات، يرجى المحاولة لاحقاً' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: false, // تعطيل التحقق من trust proxy
});

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // limit each IP to 500 API requests per windowMs
    message: { error: 'تم تجاوز الحد المسموح من طلبات API، يرجى المحاولة لاحقاً' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: false, // تعطيل التحقق من trust proxy
});

const messageLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // limit each IP to 60 messages per minute
    message: { error: 'تم تجاوز الحد المسموح من الرسائل في الدقيقة، يرجى المحاولة لاحقاً' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: false, // تعطيل التحقق من trust proxy
});

const dailyMessageLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    max: 10000, // limit each IP to 10000 messages per day
    message: { error: 'تم تجاوز الحد المسموح من الرسائل اليومية، يرجى المحاولة غداً' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: false, // تعطيل التحقق من trust proxy
});


// Global CORS
app.use(cors(corsOptions));

// Apply rate limiting
app.use(generalLimiter);
app.use('/api', apiLimiter);
app.options('*', cors(corsOptions));

// إعداد JSON parser مع معالجة أخطاء أفضل
app.use(express.json({
    limit: '10mb',
    strict: false,
    // تجاهل الأخطاء في JSON parsing للسماح بمعالجة أفضل
    verify: (req, res, buf, encoding) => {
        // محاولة تنظيف البيانات من الأحرف غير الصالحة
        if (buf && buf.length) {
            try {
                // إزالة الأحرف غير الصالحة من JSON
                const cleaned = buf.toString('utf8').replace(/[\x00-\x1F\x7F]/g, '');
                req.rawBody = cleaned;
            } catch (e) {
                // تجاهل الأخطاء
            }
        }
    }
}));

// معالجة أخطاء JSON parsing - يجب أن يكون قبل استخدام apiRoutes
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        const msg = (err.message || '');
        const hint = msg.includes('control character') || msg.includes('Bad control')
            ? 'قد يحتوي النص على أحرف تحكم (سطر جديد أو تاب). استخدم \\n أو \\t في القيمة بدلاً من الحرف الفعلي.'
            : 'يرجى التحقق من صحة البيانات المرسلة';
        console.error('JSON parsing error:', msg);
        console.error('Request URL:', req.url);
        console.error('Request method:', req.method);
        return res.status(400).json({
            success: false,
            error: 'خطأ في تنسيق JSON',
            details: hint,
            code: 'INVALID_JSON'
        });
    }
    next(err);
});

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

const activeClients = new Map();

setActiveClientsRef(activeClients);
setIoRef(io);

const {
    destroyClientCompletely: destroyClientCompletelyBase,
    cleanupChromeZombies,
    getPuppeteerOptions,
    sessionTracker,
    startSessionHeartbeat,
    smartReconnect,
    cleanSessionLocks,
    restoreSessions,
    RECONNECT_CONFIG,
    HEALTH_CONFIG,
} = require('./session-manager');

// Reconnection helper: context passed to smartReconnect
const sessionsDir = path.join(__dirname, 'sessions');
function getReconnectContext() {
    return {
        db,
        activeClients,
        io,
        Client,
        LocalAuth,
        setupHandlers: setupClientEventHandlers,
        sessionsDir,
    };
}

// دالة مساعدة لحذف مجلد الجلسة من القرص
async function deleteSessionFolder(sessionId) {
    try {
        const sessionPath = path.join(__dirname, 'sessions', `session-session_${sessionId}`);
        const sessionExists = await fs.access(sessionPath).then(() => true).catch(() => false);

        if (sessionExists) {
            console.log(`[${sessionId}] حذف مجلد الجلسة: ${sessionPath}`);
            await fs.rm(sessionPath, { recursive: true, force: true, maxRetries: 5 });
            console.log(`[${sessionId}] تم حذف مجلد الجلسة بنجاح`);
            return true;
        }
        return false;
    } catch (error) {
        console.error(`[${sessionId}] خطأ في حذف مجلد الجلسة:`, error.message);
        return false;
    }
}

// دالة مساعدة لتنظيف الجلسات المحذوفة التي لا تزال موجودة على القرص
async function cleanupOrphanedSessions() {
    try {
        const sessionsDir = path.join(__dirname, 'sessions');
        const entries = await fs.readdir(sessionsDir, { withFileTypes: true });

        // الحصول على جميع معرفات الجلسات من قاعدة البيانات
        const dbSessions = db.prepare('SELECT id FROM sessions').all();
        const validSessionIds = new Set(dbSessions.map(s => s.id));

        let cleanedCount = 0;
        let cleanedSize = 0;

        for (const entry of entries) {
            if (entry.isDirectory() && entry.name.startsWith('session-session_')) {
                // استخراج معرف الجلسة من اسم المجلد
                const match = entry.name.match(/session-session_(\d+)/);
                if (match) {
                    const sessionId = parseInt(match[1]);

                    // إذا كانت الجلسة غير موجودة في قاعدة البيانات، احذفها
                    if (!validSessionIds.has(sessionId)) {
                        const sessionPath = path.join(sessionsDir, entry.name);
                        try {
                            // حساب حجم المجلد قبل الحذف
                            const stats = await fs.stat(sessionPath);
                            const size = await getDirectorySize(sessionPath);
                            cleanedSize += size;

                            console.log(`[تنظيف] حذف جلسة محذوفة: ${entry.name} (${(size / 1024 / 1024).toFixed(2)} MB)`);
                            await fs.rm(sessionPath, { recursive: true, force: true, maxRetries: 5 });
                            cleanedCount++;
                        } catch (error) {
                            console.error(`[تنظيف] خطأ في حذف ${entry.name}:`, error.message);
                        }
                    }
                }
            }
        }

        if (cleanedCount > 0) {
            console.log(`[تنظيف] تم تنظيف ${cleanedCount} جلسة محذوفة، تم تحرير ${(cleanedSize / 1024 / 1024).toFixed(2)} MB`);
        }

        return { cleanedCount, cleanedSize };
    } catch (error) {
        console.error('[تنظيف] خطأ في تنظيف الجلسات المحذوفة:', error.message);
        return { cleanedCount: 0, cleanedSize: 0 };
    }
}

// دالة مساعدة لحساب حجم المجلد
async function getDirectorySize(dirPath) {
    let totalSize = 0;
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const entryPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                totalSize += await getDirectorySize(entryPath);
            } else {
                try {
                    const stats = await fs.stat(entryPath);
                    totalSize += stats.size;
                } catch (e) {
                    // تجاهل الأخطاء في الوصول للملفات
                }
            }
        }
    } catch (e) {
        // تجاهل الأخطاء
    }
    return totalSize;
}

// دالة مساعدة لإغلاق الجلسة بشكل كامل مع إغلاق عملية Chrome
async function destroyClientCompletely(sessionId, client) {
    // تنظيف جميع المؤقتات والبيانات الوصفية عبر sessionTracker
    sessionTracker.cleanup(sessionId);

    // استدعاء الدالة الأساسية
    await destroyClientCompletelyBase(sessionId, client);

    // حذف العميل من الخريطة
    activeClients.delete(String(sessionId));

    // تنظيف مجلد الجلسة (lock files فقط)
    await cleanSessionLocks(sessionId, sessionsDir);
}

// دالة لإعداد معالجات الأحداث للعميل (احترافي - بدون تسرب ذاكرة)
function setupClientEventHandlers(sessionId, client) {
    // ── authenticated ──
    client.on('authenticated', () => {
        console.log(`[${sessionId}] ✅ Authenticated`);
        db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('authenticated', sessionId);
        io.emit('session_authenticated', { sessionId });
        sessionTracker.updateStateTimestamp(sessionId);
    });

    // ── ready ──
    client.on('ready', async () => {
        console.log(`[${sessionId}] ✅ Session READY`);
        db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('connected', sessionId);
        io.emit('session_connected', { sessionId });
        io.emit('session_ready', { sessionId });
        sessionTracker.updateStateTimestamp(sessionId);
        sessionTracker.resetReconnect(sessionId);

        // Fetch session data (chats/contacts)
        try {
            // Wait slightly for WhatsApp to settle
            await new Promise(resolve => setTimeout(resolve, 3000));

            if (!client.info) return;

            // تجنّب استدعاء getChats/getContacts إذا الصفحة مغلقة (detached) لتقليل أخطاء Puppeteer في السجلات
            try {
                if (client.pupPage && typeof client.pupPage.isClosed === 'function' && client.pupPage.isClosed()) return;
            } catch (_) { return; }

            const chats = await client.getChats().catch(() => []);
            let contacts = [];
            try {
                contacts = await client.getContacts();
            } catch (e) {
                // Fallback: extract from chats
                contacts = (chats || []).filter(c => !c.isGroup).map(c => ({
                    id: c.id._serialized,
                    pushname: c.name || c.id.user,
                    number: c.id.user
                }));
            }

            const sessionData = {
                sessionId,
                chats: (chats || []).map(c => ({ id: c.id._serialized, name: c.name || c.id.user, type: c.isGroup ? 'group' : 'private' })),
                contacts: (contacts || []).map(c => ({ id: c.id._serialized, name: c.pushname || c.name || c.id?.user || c.number, number: c.id?.user || c.number }))
            };

            db.prepare('UPDATE sessions SET session_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(JSON.stringify(sessionData), sessionId);

            io.emit('session_data', sessionData);
        } catch (error) {
            const errMsg = (error && error.message) || String(error);
            const isDetachedOrClosed = typeof errMsg === 'string' && (errMsg.includes('detached') || errMsg.includes('Target closed'));
            if (!isDetachedOrClosed) {
                console.error(`[${sessionId}] Error fetching initial data:`, errMsg);
            }
        }
    });

    // ── message storage ──
    if (!DISABLE_MESSAGE_STORAGE) {
        client.on('message', async (msg) => {
            try {
                const insert = db.prepare(`
                    INSERT OR IGNORE INTO messages (
                        session_id, chat_id, message_id, from_me, type, body, has_media, media_mime_type, media_base64, sender, receiver, timestamp
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `);

                let mediaBase64 = null, mediaMime = null, hasMedia = false;
                if (msg.hasMedia) {
                    try {
                        const media = await msg.downloadMedia();
                        if (media) {
                            mediaBase64 = media.data;
                            mediaMime = media.mimetype;
                            hasMedia = true;
                        }
                    } catch (_) { }
                }

                const chatId = msg.from?._serialized || msg.from || '';
                const messageId = msg.id?._serialized || msg.id || `${Date.now()}`;

                insert.run(
                    String(sessionId), String(chatId), String(messageId),
                    msg.fromMe ? 1 : 0, String(msg.type || 'chat'), String(msg.body || ''),
                    hasMedia ? 1 : 0, mediaMime, mediaBase64,
                    String(msg.from?._serialized || msg.from || ''),
                    String(msg.to?._serialized || msg.to || '')
                );
            } catch (e) {
                console.error(`[${sessionId}] Message save error:`, e.message);
            }
        });
    }

    // ── disconnected ──
    client.on('disconnected', async (reason) => {
        console.log(`[${sessionId}] ❌ Disconnected - Reason: ${reason}`);

        if (sessionTracker.isReconnecting(sessionId)) return;

        const sessionCheck = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
        if (!sessionCheck) return;

        if (sessionCheck.is_paused === 1 || sessionCheck.status === 'expired') {
            await destroyClientCompletely(sessionId, client);
            return;
        }

        db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('disconnected', sessionId);
        io.emit('session_disconnected', { sessionId, reason });
        sessionTracker.updateStateTimestamp(sessionId);

        await destroyClientCompletely(sessionId, client);

        if (reason !== 'LOGGED_OUT' && reason !== 'NAVIGATION') {
            smartReconnect(sessionId, getReconnectContext());
        }
    });

    // ── auth_failure, qr, loading_screen ──
    client.on('auth_failure', (msg) => {
        db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('auth_failure', sessionId);
        io.emit('session_auth_failure', { sessionId, error: msg });
        sessionTracker.updateStateTimestamp(sessionId);
    });

    client.on('qr', async (qr) => {
        try {
            const qrCodeDataURL = await QRCode.toDataURL(qr);
            db.prepare('UPDATE sessions SET qr_code = ?, qr_timestamp = ?, status = ? WHERE id = ?')
                .run(qrCodeDataURL, new Date().toISOString(), 'waiting_for_qr', sessionId);

            io.emit('session_qr', { sessionId, qrCode: qrCodeDataURL, timestamp: new Date().toISOString() });
            sessionTracker.updateStateTimestamp(sessionId);
        } catch (e) { }
    });

    client.on('loading_screen', (percent, message) => {
        db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('loading', sessionId);
        io.emit('session_loading', { sessionId, percent, message });
        sessionTracker.updateStateTimestamp(sessionId);
    });

    // ── Start heartbeat ──
    startSessionHeartbeat(sessionId, {
        db, activeClients, io,
        onReconnect: (sid) => smartReconnect(sid, getReconnectContext()),
    });
}









// ── Startup Session Restoration ──
// Use the new single robust restore function
async function performSessionRestoration() {
    console.log('🔄 Starting session restoration process...');
    await restoreSessions(getReconnectContext());
}

// دالة لمراقبة وتنظيف عمليات Chrome الزائدة
async function monitorChromeProcesses() {
    try {
        const util = require('util');
        const exec = require('child_process').exec;
        const execAsync = util.promisify(exec);

        let chromeCount = 0;

        try {
            if (process.platform === 'linux' || process.platform === 'darwin') {
                const { stdout } = await execAsync('ps aux | grep -i chrome | grep -v grep | wc -l');
                chromeCount = parseInt(stdout.trim());
            } else if (process.platform === 'win32') {
                const { stdout } = await execAsync('tasklist | find /c "chrome.exe"');
                chromeCount = parseInt(stdout.trim());
            }
        } catch (e) {
            return;
        }

        const activeSessionsCount = activeClients.size;
        const expectedMax = Math.max(activeSessionsCount * 3, 5);

        console.log(`🔍 فحص العمليات المتبقية من Chrome...`);
        console.log(`📊 تم العثور على ${chromeCount} عملية Chrome`);

        if (chromeCount > expectedMax) {
            console.warn(`⚠️ عدد عمليات Chrome (${chromeCount}) أكبر من المتوقع (${expectedMax})`);
            console.warn(`💡 يتم الان تنظيف العمليات الزائدة (جلسات غير نشطة فقط)...`);
            await cleanupChromeZombies(sessionsDir, activeClients);
        }

    } catch (error) {
        console.error('خطأ في مراقبة Chrome:', error.message);
    }
}

// Authentication middleware
const requireAuth = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        res.status(401).json({ error: 'Authentication required' });
    }
};

// Routes
app.get('/', (req, res) => {
    if (req.session.userId) {
        res.redirect('/dashboard');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/dashboard', requireAuth, (req, res) => {
    if (!ensureUserIsActive(req, res)) return;
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/session/:id', requireAuth, (req, res) => {
    if (!ensureUserIsActive(req, res)) return;
    res.sendFile(path.join(__dirname, 'public', 'session.html'));
});


app.get('/api-docs', requireAuth, (req, res) => {
    if (!ensureUserIsActive(req, res)) return;
    res.sendFile(path.join(__dirname, 'public', 'api-docs.html'));
});

app.get('/api-test', requireAuth, (req, res) => {
    if (!ensureUserIsActive(req, res)) return;
    res.sendFile(path.join(__dirname, 'public', 'api-test.html'));
});

// مسار صفحة الباقات والاشتراكات
app.get('/subscriptions', requireAuth, (req, res) => {
    if (!ensureUserIsActive(req, res)) return;
    res.sendFile(path.join(__dirname, 'public', 'subscriptions.html'));
});

// مسار صفحة إدارة الباقات (للأدمن)
app.get('/packages', requireAuth, requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'packages.html'));
});

// معلومات المستخدم الحالية
app.get('/api/me', requireAuth, (req, res) => {
    try {
        const row = db.prepare('SELECT username, is_admin, is_active, max_sessions, session_ttl_days FROM users WHERE id = ?').get(req.session.userId);
        if (!row) return res.status(404).json({ error: 'User not found' });
        res.json({
            success: true, user: {
                id: req.session.userId,
                username: row.username,
                isAdmin: !!row.is_admin,
                isActive: !!row.is_active,
                maxSessions: row.max_sessions,
                sessionTtlDays: row.session_ttl_days
            }
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed to load user info' });
    }
});

// إحصائيات الاستخدام للمستخدم
app.get('/api/stats', requireAuth, (req, res) => {
    try {
        const userId = req.session.userId;
        if (!ensureUserIsActive(req, res)) return;
        const totalSessions = db.prepare('SELECT COUNT(1) as c FROM sessions WHERE user_id = ?').get(userId).c;
        const connectedSessions = db.prepare("SELECT COUNT(1) as c FROM sessions WHERE user_id = ? AND status = 'connected'").get(userId).c;
        const messages24h = db.prepare(`
            SELECT COUNT(1) as c
            FROM messages m
            JOIN sessions s ON s.id = m.session_id
            WHERE s.user_id = ? AND m.timestamp >= datetime(CURRENT_TIMESTAMP,'-1 day')
        `).get(userId).c;
        const api24h = db.prepare("SELECT COUNT(1) as c FROM api_logs WHERE user_id = ? AND created_at >= datetime(CURRENT_TIMESTAMP,'-1 day')").get(userId).c;
        res.json({ success: true, stats: { totalSessions, connectedSessions, messages24h, api24h } });
    } catch (e) {
        res.status(500).json({ error: 'Failed to load stats' });
    }
});

// إحصائيات عامة للأدمن
app.get('/api/admin/stats', requireAuth, requireAdmin, (req, res) => {
    try {
        const stats = {
            totalUsers: db.prepare('SELECT COUNT(*) as count FROM users').get().count,
            activeUsers: db.prepare('SELECT COUNT(*) as count FROM users WHERE is_active = 1').get().count,
            totalSessions: db.prepare('SELECT COUNT(*) as count FROM sessions').get().count,
            connectedSessions: db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'connected'").get().count,
            totalMessages: db.prepare('SELECT COUNT(*) as count FROM messages').get().count,
            messages24h: db.prepare("SELECT COUNT(*) as count FROM messages WHERE timestamp >= datetime(CURRENT_TIMESTAMP,'-1 day')").get().count,
            apiCalls: db.prepare('SELECT COUNT(*) as count FROM api_logs').get().count,
            api24h: db.prepare("SELECT COUNT(*) as count FROM api_logs WHERE created_at >= datetime(CURRENT_TIMESTAMP,'-1 day')").get().count
        };
        res.json({ success: true, stats });
    } catch (error) {
        console.error('Error getting admin stats:', error);
        res.status(500).json({ success: false, error: 'فشل في جلب الإحصائيات' });
    }
});

// إعدادات عامة (الهاتف والباقات)
app.get('/api/settings', requireAuth, (req, res) => {
    try {
        const row = db.prepare('SELECT admin_phone, packages_json FROM settings WHERE id = 1').get();
        const packages = row && row.packages_json ? JSON.parse(row.packages_json) : [];
        res.json({ success: true, adminPhone: row?.admin_phone || '', packages });
    } catch (e) {
        res.status(500).json({ error: 'Failed to load settings' });
    }
});

// لوحة تحكم الأدمن
app.get('/admin', requireAuth, (req, res) => {
    const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
    if (!row || row.is_admin !== 1) {
        return res.status(403).send('غير مصرح');
    }
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// APIs للأدمن
function requireAdmin(req, res, next) {
    const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
    if (!row || row.is_admin !== 1) {
        return res.status(403).json({ error: 'غير مصرح' });
    }
    next();
}

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
    const rows = db.prepare('SELECT id, username, email, is_active, is_admin, max_sessions, session_ttl_days, created_at FROM users ORDER BY id DESC').all();
    res.json({ success: true, users: rows });
});

// الحصول على تفاصيل المستخدم (API keys, tokens, sessions)
app.get('/api/admin/users/:userId/details', requireAuth, requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);

        // الحصول على معلومات المستخدم
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
        }

        // الحصول على API keys
        const apiKeys = getUserApiKeys(userId);

        // الحصول على session tokens
        const sessionTokens = getUserSessionTokens(userId);

        // الحصول على جلسات المستخدم
        const userSessions = db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC').all(userId);

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                is_active: user.is_active,
                is_admin: user.is_admin,
                max_sessions: user.max_sessions,
                session_ttl_days: user.session_ttl_days,
                created_at: user.created_at
            },
            apiKeys: apiKeys || [],
            sessionTokens: sessionTokens || [],
            sessions: userSessions || []
        });
    } catch (error) {
        console.error('Error getting user details:', error);
        res.status(500).json({ success: false, error: 'فشل في الحصول على تفاصيل المستخدم' });
    }
});

// إنشاء مستخدم جديد
app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { username, email, password, maxSessions, sessionDays, isAdmin } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ success: false, error: 'اسم المستخدم والبريد الإلكتروني وكلمة المرور مطلوبة' });
        }

        const exists = db.prepare('SELECT 1 FROM users WHERE username = ? OR email = ?').get(username, email);
        if (exists) {
            return res.status(400).json({ success: false, error: 'اسم المستخدم أو البريد الإلكتروني موجود مسبقاً' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const insert = db.prepare('INSERT INTO users (username, email, password_hash, is_admin, is_active, max_sessions, session_ttl_days) VALUES (?, ?, ?, ?, 1, ?, ?)');
        const result = insert.run(
            username,
            email,
            passwordHash,
            isAdmin ? 1 : 0,
            Number.isFinite(Number(maxSessions)) ? Number(maxSessions) : 1,
            Number.isFinite(Number(sessionDays)) ? Number(sessionDays) : 30
        );
        res.json({ success: true, userId: result.lastInsertRowid });
    } catch (error) {
        console.error('Error creating user (admin):', error);
        res.status(500).json({ success: false, error: 'فشل في إنشاء المستخدم' });
    }
});

// تحديث حدود الجلسات لمستخدم
app.put('/api/admin/users/:userId/limits', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { maxSessions, sessionTtlDays } = req.body;

        if (maxSessions !== undefined && (maxSessions < 1 || maxSessions > 1000)) {
            return res.status(400).json({
                success: false,
                error: 'عدد الجلسات المسموحة يجب أن يكون بين 1 و 1000'
            });
        }

        if (sessionTtlDays !== undefined && (sessionTtlDays < 1 || sessionTtlDays > 9999)) {
            return res.status(400).json({
                success: false,
                error: 'عدد أيام انتهاء الجلسة يجب أن يكون بين 1 و 9999'
            });
        }

        const updateFields = [];
        const updateValues = [];

        if (maxSessions !== undefined) {
            updateFields.push('max_sessions = ?');
            updateValues.push(Number(maxSessions));
        }

        if (sessionTtlDays !== undefined) {
            updateFields.push('session_ttl_days = ?');
            updateValues.push(Number(sessionTtlDays));
        }

        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'لم يتم تحديد أي قيم للتحديث'
            });
        }

        updateValues.push(userId);
        const query = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;

        const result = db.prepare(query).run(...updateValues);

        if (result.changes > 0) {
            res.json({ success: true, message: 'تم تحديث حدود الجلسات بنجاح' });
        } else {
            res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
        }
    } catch (error) {
        console.error('Error updating user limits:', error);
        res.status(500).json({ success: false, error: 'فشل في تحديث حدود الجلسات' });
    }
});

// تحديث إعدادات الجلسة
app.put('/api/admin/sessions/:sessionId/settings', requireAuth, requireAdmin, (req, res) => {
    try {
        const { sessionId } = req.params;
        const { maxDays, daysRemaining, isPaused, pauseReason } = req.body;

        if (maxDays < 1 || maxDays > 9999) {
            return res.status(400).json({
                success: false,
                error: 'عدد الأيام يجب أن يكون بين 1 و 9999'
            });
        }

        if (daysRemaining < 0 || daysRemaining > maxDays) {
            return res.status(400).json({
                success: false,
                error: 'الأيام المتبقية يجب أن تكون بين 0 و ' + maxDays
            });
        }

        // تحديث تاريخ الانتهاء بناءً على الأيام المتبقية
        const newExpiryDate = new Date();
        newExpiryDate.setDate(newExpiryDate.getDate() + daysRemaining);

        db.prepare(`
            UPDATE sessions 
            SET max_days = ?, days_remaining = ?, expires_at = ?, is_paused = ?, pause_reason = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `).run(maxDays, daysRemaining, newExpiryDate.toISOString(), isPaused ? 1 : 0, pauseReason, sessionId);

        res.json({ success: true, message: 'تم تحديث إعدادات الجلسة بنجاح' });
    } catch (error) {
        console.error('Error updating session settings:', error);
        res.status(500).json({ success: false, error: 'فشل في تحديث إعدادات الجلسة' });
    }
});

app.post('/api/admin/sessions/:sessionId/extend', requireAuth, requireAdmin, (req, res) => {
    try {
        const { sessionId } = req.params;
        const { days } = req.body;

        if (days < 1 || days > 9999) {
            return res.status(400).json({
                success: false,
                error: 'عدد الأيام يجب أن يكون بين 1 و 9999'
            });
        }

        const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
        if (!session) {
            return res.status(404).json({ success: false, error: 'الجلسة غير موجودة' });
        }

        const newDaysRemaining = (session.days_remaining || 0) + days;
        const newExpiryDate = new Date();
        newExpiryDate.setDate(newExpiryDate.getDate() + newDaysRemaining);

        db.prepare(`
            UPDATE sessions 
            SET days_remaining = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `).run(newDaysRemaining, newExpiryDate.toISOString(), sessionId);

        res.json({
            success: true,
            message: `تم تمديد الجلسة بـ ${days} يوم`,
            daysRemaining: newDaysRemaining,
            expiresAt: newExpiryDate.toISOString()
        });
    } catch (error) {
        console.error('Error extending session:', error);
        res.status(500).json({ success: false, error: 'فشل في تمديد الجلسة' });
    }
});

// إيقاف/تفعيل الجلسة
app.post('/api/admin/sessions/:sessionId/toggle-pause', requireAuth, requireAdmin, (req, res) => {
    try {
        const { sessionId } = req.params;
        const { isPaused, pauseReason } = req.body;

        const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
        if (!session) {
            return res.status(404).json({ success: false, error: 'الجلسة غير موجودة' });
        }

        db.prepare(`
            UPDATE sessions 
            SET is_paused = ?, pause_reason = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `).run(isPaused ? 1 : 0, pauseReason, sessionId);

        res.json({
            success: true,
            message: isPaused ? 'تم إيقاف الجلسة' : 'تم تفعيل الجلسة',
            isPaused: isPaused
        });
    } catch (error) {
        console.error('Error toggling session pause:', error);
        res.status(500).json({ success: false, error: 'فشل في تغيير حالة الجلسة' });
    }
});

// الحصول على جميع الجلسات (للأدمن)
app.get('/api/admin/sessions', requireAuth, requireAdmin, (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT s.*, u.username, u.email, u.max_sessions, u.session_ttl_days,
                   CASE 
                       WHEN s.expires_at IS NULL THEN 'unlimited'
                       WHEN s.expires_at < CURRENT_TIMESTAMP THEN 'expired'
                       ELSE 'active'
                   END as expiry_status
            FROM sessions s 
            JOIN users u ON s.user_id = u.id 
            ORDER BY s.created_at DESC
        `).all();

        // تحديث الأيام المتبقية بناءً على الوقت الفعلي
        const now = new Date();
        rows.forEach(session => {
            if (session.expires_at) {
                const expiryDate = new Date(session.expires_at);
                const timeDiff = expiryDate.getTime() - now.getTime();
                const daysRemaining = Math.ceil(timeDiff / (1000 * 3600 * 24));

                // تحديث الأيام المتبقية في قاعدة البيانات إذا تغيرت
                if (daysRemaining !== session.days_remaining) {
                    db.prepare(`
                        UPDATE sessions 
                        SET days_remaining = ?, updated_at = CURRENT_TIMESTAMP 
                        WHERE id = ?
                    `).run(Math.max(0, daysRemaining), session.id);

                    // تحديث القيمة في النتيجة
                    session.days_remaining = Math.max(0, daysRemaining);
                }
            }
        });

        res.json({ success: true, sessions: rows });
    } catch (error) {
        console.error('Error fetching sessions:', error);
        res.status(500).json({ success: false, error: 'فشل في جلب الجلسات' });
    }
});

// حذف جلسة (للأدمن)
app.delete('/api/admin/sessions/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const sessionId = req.params.id;

        // إغلاق الجلسة إذا كانت نشطة
        if (activeClients.has(String(sessionId))) {
            const client = activeClients.get(String(sessionId));
            await destroyClientCompletely(sessionId, client);
        }

        const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);

        if (result.changes > 0) {
            res.json({ success: true, message: 'تم حذف الجلسة بنجاح' });
        } else {
            res.status(404).json({ success: false, error: 'الجلسة غير موجودة' });
        }
    } catch (error) {
        console.error('Error deleting session:', error);
        res.status(500).json({ success: false, error: 'فشل في حذف الجلسة' });
    }
});

// إعادة تشغيل جلسة (للأدمن)
app.post('/api/admin/sessions/:id/restart', requireAuth, requireAdmin, (req, res) => {
    try {
        const sessionId = req.params.id;
        // إعادة تعيين حالة الجلسة
        db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('disconnected', sessionId);
        res.json({ success: true, message: 'تم إعادة تعيين الجلسة' });
    } catch (error) {
        console.error('Error restarting session:', error);
        res.status(500).json({ success: false, error: 'فشل في إعادة تشغيل الجلسة' });
    }
});

// تم إزالة API التمديد للمستخدمين - فقط المدير يمكنه التمديد

// الحصول على معلومات انتهاء الصلاحية
app.get('/api/sessions/:id/expiry', requireAuth, async (req, res) => {
    try {
        const sessionId = req.params.id;
        const userId = req.session.userId;

        const session = db.prepare(`
            SELECT s.*, u.session_ttl_days 
            FROM sessions s 
            JOIN users u ON s.user_id = u.id 
            WHERE s.id = ? AND s.user_id = ?
        `).get(sessionId, userId);

        if (!session) {
            return res.status(404).json({ success: false, error: 'الجلسة غير موجودة' });
        }

        const now = new Date();
        const expiresAt = session.expires_at ? new Date(session.expires_at) : null;
        const isExpired = expiresAt && expiresAt < now;
        const daysRemaining = expiresAt ? Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)) : null;

        res.json({
            success: true,
            session: {
                id: session.id,
                name: session.session_name,
                status: session.status,
                expiresAt: expiresAt ? expiresAt.toISOString() : null,
                isExpired,
                daysRemaining: isExpired ? 0 : daysRemaining,
                canRenew: !isExpired && session.status !== 'expired'
            }
        });
    } catch (error) {
        console.error('Error getting session expiry:', error);
        res.status(500).json({ success: false, error: 'فشل في جلب معلومات انتهاء الصلاحية' });
    }
});

// إدارة الإعدادات العامة
app.get('/api/admin/settings', requireAuth, requireAdmin, (req, res) => {
    try {
        const settings = db.prepare('SELECT * FROM settings WHERE id = 1').get();
        res.json({
            success: true,
            settings: settings || {
                adminPhone: '',
                defaultMaxSessions: 5,
                defaultSessionDays: 30
            }
        });
    } catch (error) {
        console.error('Error fetching settings:', error);
        res.status(500).json({ success: false, error: 'فشل في جلب الإعدادات' });
    }
});

app.put('/api/admin/settings', requireAuth, requireAdmin, (req, res) => {
    try {
        const { adminPhone, defaultMaxSessions, defaultSessionDays } = req.body;

        // تحديث أو إنشاء الإعدادات
        db.prepare(`
            INSERT OR REPLACE INTO settings (id, admin_phone, default_max_sessions, default_session_days, updated_at) 
            VALUES (1, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(adminPhone, defaultMaxSessions, defaultSessionDays);

        res.json({ success: true, message: 'تم حفظ الإعدادات بنجاح' });
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ success: false, error: 'فشل في حفظ الإعدادات' });
    }
});

// تنظيف الجلسات المنتهية الصلاحية
app.post('/api/admin/cleanup-expired-sessions', requireAuth, requireAdmin, (req, res) => {
    try {
        const result = db.prepare(`
            UPDATE sessions 
            SET status = 'expired' 
            WHERE expires_at IS NOT NULL 
            AND expires_at < CURRENT_TIMESTAMP 
            AND status != 'expired'
        `).run();

        res.json({
            success: true,
            message: `تم تحديث ${result.changes} جلسة منتهية الصلاحية`
        });
    } catch (error) {
        console.error('Error cleaning up expired sessions:', error);
        res.status(500).json({ success: false, error: 'فشل في تنظيف الجلسات المنتهية' });
    }
});

// تنظيف الجلسات المحذوفة التي لا تزال موجودة على القرص
app.post('/api/admin/cleanup-orphaned-sessions', requireAuth, requireAdmin, async (req, res) => {
    try {
        const result = await cleanupOrphanedSessions();
        res.json({
            success: true,
            message: `تم تنظيف ${result.cleanedCount} جلسة محذوفة، تم تحرير ${(result.cleanedSize / 1024 / 1024).toFixed(2)} MB`,
            cleanedCount: result.cleanedCount,
            cleanedSizeMB: (result.cleanedSize / 1024 / 1024).toFixed(2)
        });
    } catch (error) {
        console.error('Error cleaning up orphaned sessions:', error);
        res.status(500).json({ success: false, error: 'فشل في تنظيف الجلسات المحذوفة' });
    }
});

// تحديث بيانات مستخدم
app.put('/api/admin/users/:userId', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { username, email, password, maxSessions, sessionDays, isAdmin, isActive } = req.body;

        if (!username || !email) {
            return res.status(400).json({ success: false, error: 'اسم المستخدم والبريد الإلكتروني مطلوبان' });
        }

        // التأكد من عدم تعارض البريد/الاسم مع مستخدم آخر
        const conflict = db.prepare('SELECT id FROM users WHERE (username = ? OR email = ?) AND id != ?').get(username, email, userId);
        if (conflict) {
            return res.status(400).json({ success: false, error: 'اسم المستخدم أو البريد الإلكتروني مستخدم من حساب آخر' });
        }

        if (password && password.length > 0) {
            const passwordHash = await bcrypt.hash(password, 10);
            db.prepare('UPDATE users SET username = ?, email = ?, password_hash = ?, is_admin = ?, is_active = ?, max_sessions = ?, session_ttl_days = ? WHERE id = ?')
                .run(
                    username,
                    email,
                    passwordHash,
                    isAdmin ? 1 : 0,
                    isActive ? 1 : 0,
                    Number.isFinite(Number(maxSessions)) ? Number(maxSessions) : null,
                    Number.isFinite(Number(sessionDays)) ? Number(sessionDays) : null,
                    userId
                );
        } else {
            db.prepare('UPDATE users SET username = ?, email = ?, is_admin = ?, is_active = ?, max_sessions = ?, session_ttl_days = ? WHERE id = ?')
                .run(
                    username,
                    email,
                    isAdmin ? 1 : 0,
                    isActive ? 1 : 0,
                    Number.isFinite(Number(maxSessions)) ? Number(maxSessions) : null,
                    Number.isFinite(Number(sessionDays)) ? Number(sessionDays) : null,
                    userId
                );
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating user (admin):', error);
        res.status(500).json({ success: false, error: 'فشل في تحديث المستخدم' });
    }
});

// تبديل حالة تفعيل المستخدم
app.post('/api/admin/users/:userId/toggle', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;

        // منع إيقاف المستخدم الحالي (الأدمن الذي يقوم بالإيقاف)
        if (parseInt(userId) === req.user.id) {
            return res.status(400).json({ success: false, error: 'لا يمكنك إيقاف حسابك الخاص' });
        }

        const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (!row) {
            return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
        }

        const newVal = row.is_active === 1 ? 0 : 1;
        db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(newVal, userId);

        // إذا تم إيقاف المستخدم، إغلاق جميع جلساته النشطة
        if (newVal === 0) {
            const sessions = db.prepare('SELECT id FROM sessions WHERE user_id = ?').all(userId);
            for (const session of sessions) {
                const sessionId = String(session.id);
                if (activeClients.has(sessionId)) {
                    const client = activeClients.get(sessionId);
                    await destroyClientCompletely(sessionId, client);
                }
            }
            // تحديث حالة الجلسات إلى disconnected
            db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run('disconnected', userId);
            console.log(`✅ تم إيقاف المستخدم ${userId} (${row.username}) وإغلاق جميع جلساته من قبل الأدمن ${req.user.username}`);
        } else {
            console.log(`✅ تم تفعيل المستخدم ${userId} (${row.username}) من قبل الأدمن ${req.user.username}`);
        }

        res.json({ success: true, isActive: newVal === 1, message: newVal === 1 ? 'تم تفعيل المستخدم' : 'تم إيقاف المستخدم' });
    } catch (error) {
        console.error('Error toggling user (admin):', error);
        res.status(500).json({ success: false, error: 'فشل في تحديث الحالة' });
    }
});

// حذف مستخدم
app.delete('/api/admin/users/:userId', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;

        // منع حذف المستخدم الحالي (الأدمن الذي يقوم بالحذف)
        if (parseInt(userId) === req.user.id) {
            return res.status(400).json({ success: false, error: 'لا يمكنك حذف حسابك الخاص' });
        }

        // التحقق من وجود المستخدم
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
        }

        // إغلاق جميع الجلسات النشطة للمستخدم
        const sessions = db.prepare('SELECT id FROM sessions WHERE user_id = ?').all(userId);
        for (const session of sessions) {
            const sessionId = String(session.id);
            if (activeClients.has(sessionId)) {
                const client = activeClients.get(sessionId);
                await destroyClientCompletely(sessionId, client);
            }
        }

        // إلغاء تفعيل مفاتيح/توكنات API
        try { db.prepare('UPDATE api_keys SET is_active = 0 WHERE user_id = ?').run(userId); } catch (_) { }
        try { db.prepare('UPDATE session_tokens SET is_active = 0 WHERE user_id = ?').run(userId); } catch (_) { }

        // حذف المستخدم (سيتم حذف الجلسات المرتبطة تلقائياً بسبب ON DELETE CASCADE)
        const del = db.prepare('DELETE FROM users WHERE id = ?').run(userId);

        if (del.changes === 0) {
            return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
        }

        console.log(`✅ تم حذف المستخدم ${userId} (${user.username}) من قبل الأدمن ${req.user.username}`);
        res.json({ success: true, message: 'تم حذف المستخدم بنجاح' });
    } catch (error) {
        console.error('Error deleting user (admin):', error);
        res.status(500).json({ success: false, error: 'فشل في حذف المستخدم' });
    }
});

app.post('/api/admin/users/:userId/active', requireAuth, requireAdmin, (req, res) => {
    const { userId } = req.params;
    const { isActive } = req.body;
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, userId);
    res.json({ success: true });
});

// تم إزالة هذا المسار القديم - استخدم PUT /api/admin/users/:userId/limits بدلاً منه

app.post('/api/admin/users/:userId/logout', requireAuth, requireAdmin, async (req, res) => {
    const { userId } = req.params;
    // Destroy all active sessions for this user
    const sessions = db.prepare('SELECT id FROM sessions WHERE user_id = ?').all(userId);
    for (const s of sessions) {
        const key = String(s.id);
        if (activeClients.has(key)) {
            const client = activeClients.get(key);
            await destroyClientCompletely(key, client);
        }
    }
    // Optionally, invalidate API keys/session tokens
    db.prepare('UPDATE api_keys SET is_active = FALSE WHERE user_id = ?').run(userId);
    db.prepare('UPDATE session_tokens SET is_active = FALSE WHERE user_id = ?').run(userId);
    res.json({ success: true });
});

// تم دمج هذا المسار مع المسار السابق - لا حاجة للتكرار

// ========================================
// مسارات Profile/User Settings
// ========================================

// الحصول على بيانات المستخدم الشخصية
app.get('/api/user/profile', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        if (!ensureUserIsActive(req, res)) return;

        const user = db.prepare('SELECT id, username, email, created_at, is_active, max_sessions FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
        }

        // عدد الجلسات
        const sessionsCount = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE user_id = ?').get(userId).count;

        res.json({
            success: true,
            user: {
                ...user,
                sessions_count: sessionsCount
            }
        });
    } catch (error) {
        console.error('Error getting user profile:', error);
        res.status(500).json({ success: false, error: 'فشل في جلب بيانات المستخدم' });
    }
});

// تحديث بيانات المستخدم الشخصية
app.put('/api/user/profile', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        if (!ensureUserIsActive(req, res)) return;

        const { username, email } = req.body;

        if (!username || !email) {
            return res.status(400).json({ success: false, error: 'اسم المستخدم والبريد الإلكتروني مطلوبان' });
        }

        // التحقق من صحة البريد الإلكتروني
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ success: false, error: 'البريد الإلكتروني غير صحيح' });
        }

        // التحقق من عدم تعارض البريد/الاسم مع مستخدم آخر
        const conflict = db.prepare('SELECT id FROM users WHERE (username = ? OR email = ?) AND id != ?').get(username, email, userId);
        if (conflict) {
            return res.status(400).json({ success: false, error: 'اسم المستخدم أو البريد الإلكتروني مستخدم من حساب آخر' });
        }

        // تحديث البيانات
        const result = db.prepare('UPDATE users SET username = ?, email = ? WHERE id = ?').run(username, email, userId);

        if (result.changes > 0) {
            console.log(`✅ تم تحديث بيانات المستخدم ${userId} (${username})`);
            res.json({ success: true, message: 'تم تحديث البيانات بنجاح' });
        } else {
            res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
        }
    } catch (error) {
        console.error('Error updating user profile:', error);
        res.status(500).json({ success: false, error: 'فشل في تحديث البيانات' });
    }
});

// تغيير كلمة المرور
app.post('/api/user/change-password', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        if (!ensureUserIsActive(req, res)) return;

        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, error: 'كلمة المرور الحالية والجديدة مطلوبتان' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
        }

        // التحقق من كلمة المرور الحالية
        const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
        }

        const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isValidPassword) {
            return res.status(400).json({ success: false, error: 'كلمة المرور الحالية غير صحيحة' });
        }

        // تحديث كلمة المرور
        const newPasswordHash = await bcrypt.hash(newPassword, 10);
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newPasswordHash, userId);

        console.log(`✅ تم تغيير كلمة مرور المستخدم ${userId}`);
        res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
    } catch (error) {
        console.error('Error changing password:', error);
        res.status(500).json({ success: false, error: 'فشل في تغيير كلمة المرور' });
    }
});

// ========================================
// مسارات API
// ========================================

// استخدام مسارات API
app.use('/api', apiRoutes);

// مسار فحص حالة خدمات البريد الإلكتروني
app.get('/api/email-status', (req, res) => {
    try {
        const status = getServiceStatus();
        res.json({ success: true, status });
    } catch (error) {
        console.error('Error checking email service status:', error);
        res.status(500).json({ error: 'فشل في فحص حالة الخدمات' });
    }
});

// ========================================
// مسارات إدارة API (مبسطة)
// ========================================

// الحصول على معلومات API للمستخدم (مفتاح API + توكنات الجلسات)
app.get('/api/user-api-info', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        if (!ensureUserIsActive(req, res)) return;

        // الحصول على مفتاح API للمستخدم (أو إنشاؤه إذا لم يكن موجود)
        let apiKey = getUserApiKey(userId);
        if (!apiKey) {
            const result = createApiKey(userId, 'API Key');
            apiKey = result.apiKey;
        }

        // الحصول على جميع الجلسات مع توكناتها
        const sessions = await getSessionsForUser(userId);
        const sessionTokens = [];

        for (const session of sessions) {
            // البحث عن توكن الجلسة أو إنشاؤه
            let token = getSessionTokenBySessionId(userId, String(session.id));
            if (!token) {
                const result = createSessionToken(userId, String(session.id));
                token = result.token;
            }

            sessionTokens.push({
                sessionId: session.id, // استخدام ID الفعلي للجلسة
                sessionName: session.session_name,
                token: token,
                status: session.status
            });
        }

        res.json({
            success: true,
            apiKey: apiKey,
            message: 'تم إنشاء مفتاح API وتوكنات الجلسات تلقائياً',
            sessionTokens: sessionTokens
        });
    } catch (error) {
        console.error('Error getting user API info:', error);
        res.status(500).json({ error: 'فشل في الحصول على معلومات API' });
    }
});

// دالة مساعدة للحصول على جلسات المستخدم
async function getSessionsForUser(userId) {
    try {
        const stmt = db.prepare(`
            SELECT id, session_name, status, created_at, updated_at 
            FROM sessions 
            WHERE user_id = ? 
            ORDER BY created_at DESC
        `);
        return stmt.all(userId);
    } catch (error) {
        console.error('Error getting sessions for user:', error);
        return [];
    }
}

// إعادة إنشاء مفتاح API جديد
app.post('/api/regenerate-api-key', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        if (!ensureUserIsActive(req, res)) return;

        // حذف المفتاح القديم
        deleteUserApiKey(userId);

        // إنشاء مفتاح جديد
        const result = createApiKey(userId, 'API Key');

        res.json({
            success: true,
            message: 'تم إنشاء مفتاح API جديد',
            apiKey: result.apiKey
        });
    } catch (error) {
        console.error('Error regenerating API key:', error);
        res.status(500).json({ error: 'فشل في إنشاء مفتاح API جديد' });
    }
});

// الحصول على معلومات التوكن لجلسة محددة
app.get('/api/session/:sessionId/token', requireAuth, async (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        const userId = req.session.userId;
        if (!ensureUserIsActive(req, res)) return;

        // التحقق من أن الجلسة تنتمي للمستخدم
        const sessionStmt = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?');
        const session = sessionStmt.get(sessionId, userId);

        if (!session) {
            return res.status(404).json({ error: 'الجلسة غير موجودة' });
        }

        // البحث عن توكن الجلسة أو إنشاؤه
        let token = getSessionTokenBySessionId(userId, String(session.id));
        if (!token) {
            const result = createSessionToken(userId, String(session.id));
            token = result.token;
        }

        res.json({
            success: true,
            sessionId: session.id,
            sessionName: session.session_name,
            token: token,
            status: session.status
        });
    } catch (error) {
        console.error('Error getting session token:', error);
        res.status(500).json({ error: 'فشل في الحصول على توكن الجلسة' });
    }
});

// إعادة إنشاء توكن جلسة
app.post('/api/regenerate-session-token', requireAuth, async (req, res) => {
    try {
        const { sessionId } = req.body;
        const userId = req.session.userId;
        if (!ensureUserIsActive(req, res)) return;

        if (!sessionId) {
            return res.status(400).json({ error: 'معرف الجلسة مطلوب' });
        }

        // التحقق من ملكية الجلسة
        const sessionStmt = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?');
        const session = sessionStmt.get(sessionId, userId);

        if (!session) {
            return res.status(404).json({ error: 'الجلسة غير موجودة' });
        }

        // حذف التوكن القديم
        deleteSessionTokenBySessionId(userId, String(sessionId));

        // إنشاء توكن جديد
        const result = createSessionToken(userId, String(sessionId));

        res.json({
            success: true,
            message: 'تم إنشاء توكن جلسة جديد',
            token: result.token
        });
    } catch (error) {
        console.error('Error regenerating session token:', error);
        res.status(500).json({ error: 'فشل في إنشاء توكن جلسة جديد' });
    }
});

// ========================================
// مسارات إدارة API
// ========================================

// إنشاء مفتاح API جديد
app.post('/api/create-api-key', requireAuth, async (req, res) => {
    try {
        const { keyName } = req.body;
        const userId = req.session.userId;

        if (!keyName) {
            return res.status(400).json({ error: 'اسم المفتاح مطلوب' });
        }

        const result = createApiKey(userId, keyName);

        if (result.success) {
            res.json({
                success: true,
                message: 'تم إنشاء مفتاح API بنجاح',
                apiKey: result.apiKey
            });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (error) {
        console.error('Error creating API key:', error);
        res.status(500).json({ error: 'فشل في إنشاء مفتاح API' });
    }
});

// الحصول على مفاتيح API للمستخدم
app.get('/api/user-api-keys', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const apiKeys = getUserApiKeys(userId);

        res.json({ success: true, apiKeys });
    } catch (error) {
        console.error('Error getting user API keys:', error);
        res.status(500).json({ error: 'فشل في الحصول على مفاتيح API' });
    }
});

// حذف مفتاح API
app.delete('/api/delete-api-key/:keyId', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const keyId = parseInt(req.params.keyId);

        const result = deleteApiKey(userId, keyId);

        if (result.success) {
            res.json({ success: true, message: result.message });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error) {
        console.error('Error deleting API key:', error);
        res.status(500).json({ error: 'فشل في حذف مفتاح API' });
    }
});

// إنشاء توكن جلسة جديد
app.post('/api/create-session-token', requireAuth, async (req, res) => {
    try {
        const { sessionId } = req.body;
        const userId = req.session.userId;

        if (!sessionId) {
            return res.status(400).json({ error: 'معرف الجلسة مطلوب' });
        }

        const result = createSessionToken(userId, String(sessionId));

        if (result.success) {
            res.json({
                success: true,
                message: 'تم إنشاء توكن الجلسة بنجاح',
                token: result.token
            });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (error) {
        console.error('Error creating session token:', error);
        res.status(500).json({ error: 'فشل في إنشاء توكن الجلسة' });
    }
});

// الحصول على توكنات الجلسات للمستخدم
app.get('/api/user-session-tokens', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const sessionTokens = getUserSessionTokens(userId);

        res.json({ success: true, sessionTokens });
    } catch (error) {
        console.error('Error getting user session tokens:', error);
        res.status(500).json({ error: 'فشل في الحصول على توكنات الجلسات' });
    }
});

// حذف توكن جلسة
app.delete('/api/delete-session-token/:tokenId', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const tokenId = parseInt(req.params.tokenId);

        const result = deleteSessionToken(userId, tokenId);

        if (result.success) {
            res.json({ success: true, message: result.message });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error) {
        console.error('Error deleting session token:', error);
        res.status(500).json({ error: 'فشل في حذف توكن الجلسة' });
    }
});

// الحصول على سجلات API للمستخدم
app.get('/api/user-api-logs', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const apiLogs = getUserApiLogs(userId);

        res.json({ success: true, apiLogs });
    } catch (error) {
        console.error('Error getting user API logs:', error);
        res.status(500).json({ error: 'فشل في الحصول على سجلات API' });
    }
});

// مسار التسجيل مع التحقق من البريد الإلكتروني
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ error: 'اسم المستخدم والبريد الإلكتروني وكلمة المرور مطلوبة' });
        }

        // التحقق من صحة البريد الإلكتروني
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'البريد الإلكتروني غير صحيح' });
        }

        // التحقق من عدم وجود المستخدم أو البريد الإلكتروني
        const existingUser = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, email);
        if (existingUser) {
            if (existingUser.username === username) {
                return res.status(400).json({ error: 'اسم المستخدم موجود بالفعل' });
            } else {
                return res.status(400).json({ error: 'البريد الإلكتروني مستخدم بالفعل' });
            }
        }

        const passwordHash = await bcrypt.hash(password, 10);

        // إنشاء المستخدم
        const insertUserStmt = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)');
        const result = insertUserStmt.run(username, email, passwordHash);
        const userId = result.lastInsertRowid;

        // تم إلغاء التحقق من البريد الإلكتروني مؤقتاً
        // المستخدم يدخل مباشرة للداش بورد

        // تحديث حالة التحقق إلى true
        const updateVerificationStmt = db.prepare('UPDATE users SET email_verified = TRUE WHERE id = ?');
        updateVerificationStmt.run(userId);

        res.json({ success: true, message: 'تم إنشاء الحساب بنجاح! يمكنك الدخول الآن.' });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'فشل في التسجيل' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
        const user = stmt.get(username);

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const isValidPassword = await bcrypt.compare(password, user.password_hash);

        if (!isValidPassword) {
            return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
        }

        if (user.is_active === 0) {
            return res.status(403).json({ error: 'تم إيقاف المستخدم من قبل الإدارة' });
        }

        // تم إلغاء التحقق من البريد الإلكتروني مؤقتاً
        // المستخدم يدخل مباشرة للداش بورد

        req.session.userId = user.id;
        req.session.username = user.username;

        res.json({ success: true, userId: user.id });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'فشل في تسجيل الدخول' });
    }
});

// ========================================
// مسار التحقق من البريد الإلكتروني
// ========================================
// يتحقق من صحة رمز التحقق المرسل عبر البريد الإلكتروني
app.post('/api/verify-email', async (req, res) => {
    try {
        const { email, code } = req.body;

        if (!email || !code) {
            return res.status(400).json({ error: 'البريد الإلكتروني ورمز التحقق مطلوبان' });
        }

        // البحث عن المستخدم
        const userStmt = db.prepare('SELECT * FROM users WHERE email = ?');
        const user = userStmt.get(email);

        if (!user) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }

        // البحث عن رمز التحقق
        const tokenStmt = db.prepare('SELECT * FROM email_verification_tokens WHERE user_id = ? AND token = ? AND expires_at > CURRENT_TIMESTAMP');
        const token = tokenStmt.get(user.id, code);

        if (!token) {
            return res.status(400).json({ error: 'رمز التحقق غير صحيح أو منتهي الصلاحية' });
        }

        // تحديث حالة التحقق من البريد الإلكتروني
        const updateStmt = db.prepare('UPDATE users SET email_verified = TRUE WHERE id = ?');
        updateStmt.run(user.id);

        // حذف رمز التحقق المستخدم
        const deleteTokenStmt = db.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?');
        deleteTokenStmt.run(user.id);

        res.json({ success: true, message: 'تم التحقق من البريد الإلكتروني بنجاح' });
    } catch (error) {
        console.error('Email verification error:', error);
        res.status(500).json({ error: 'فشل في التحقق من البريد الإلكتروني' });
    }
});

// ========================================
// مسار إعادة إرسال رمز التحقق
// ========================================
// يرسل رمز تحقق جديد إذا انتهت صلاحية الرمز السابق
app.post('/api/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'البريد الإلكتروني مطلوب' });
        }

        // البحث عن المستخدم
        const userStmt = db.prepare('SELECT * FROM users WHERE email = ?');
        const user = userStmt.get(email);

        if (!user) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }

        // حذف الرموز القديمة
        const deleteOldTokensStmt = db.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?');
        deleteOldTokensStmt.run(user.id);

        // إنشاء رمز تحقق جديد
        const verificationCode = crypto.randomInt(100000, 999999).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 دقائق

        const insertTokenStmt = db.prepare('INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES (?, ?, ?)');
        insertTokenStmt.run(user.id, verificationCode, expiresAt.toISOString());

        // إرسال رمز التحقق الجديد
        try {
            await sendVerificationEmail(email, verificationCode, user.username);
            res.json({ success: true, message: 'تم إعادة إرسال رمز التحقق' });
        } catch (emailError) {
            console.error('Email sending failed:', emailError);
            res.status(500).json({ error: 'فشل في إرسال رمز التحقق' });
        }
    } catch (error) {
        console.error('Resend verification error:', error);
        res.status(500).json({ error: 'فشل في إعادة إرسال رمز التحقق' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.post('/api/sessions', requireAuth, async (req, res) => {
    try {
        const { sessionName } = req.body;
        const userId = req.session.userId;
        if (!ensureUserIsActive(req, res)) return;

        // التحقق من حدود الجلسات المسموحة للمستخدم
        const user = db.prepare('SELECT max_sessions, session_ttl_days FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
        }

        const maxSessions = user.max_sessions != null ? Number(user.max_sessions) : 5;
        const days = user.session_ttl_days != null ? Number(user.session_ttl_days) : 30;

        // عد جميع الجلسات للمستخدم (بما فيها المنفصلة)
        const allSessions = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE user_id = ?').get(userId);

        // التحقق من الحد الأقصى للجلسات
        if (maxSessions > 0 && allSessions.count >= maxSessions) {
            return res.status(403).json({
                success: false,
                error: `تم بلوغ الحد الأقصى للجلسات المسموحة (${maxSessions}). يرجى حذف جلسة أخرى أولاً.`
            });
        }

        // إنشاء الجلسة
        const stmt = db.prepare('INSERT INTO sessions (session_name, user_id) VALUES (?, ?)');
        const result = stmt.run(sessionName, userId);

        // إعداد تاريخ الانتهاء والحدود للجلسة
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + days);

        db.prepare(`
            UPDATE sessions 
            SET expires_at = ?, max_days = ?, days_remaining = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `).run(expiryDate.toISOString(), days, days, result.lastInsertRowid);

        res.json({ success: true, sessionId: result.lastInsertRowid, message: 'تم إنشاء الجلسة بنجاح' });
    } catch (error) {
        console.error('Error creating session:', error);
        res.status(500).json({
            success: false,
            error: 'فشل في إنشاء الجلسة',
            details: error.message
        });
    }
});

app.get('/api/sessions', requireAuth, (req, res) => {
    try {
        const userId = req.session.userId;
        if (!ensureUserIsActive(req, res)) return;
        const stmt = db.prepare(`
            SELECT s.*, 
                   CASE 
                       WHEN s.expires_at IS NOT NULL AND s.expires_at < CURRENT_TIMESTAMP THEN 'expired'
                       ELSE s.status 
                   END as status
            FROM sessions s 
            WHERE s.user_id = ? 
            ORDER BY s.created_at DESC
        `);
        const sessions = stmt.all(userId);

        // تحديث الأيام المتبقية بناءً على الوقت الفعلي
        const now = new Date();
        sessions.forEach(session => {
            if (session.expires_at) {
                const expiryDate = new Date(session.expires_at);
                const timeDiff = expiryDate.getTime() - now.getTime();
                const daysRemaining = Math.ceil(timeDiff / (1000 * 3600 * 24));

                // تحديث الأيام المتبقية في قاعدة البيانات إذا تغيرت
                if (daysRemaining !== session.days_remaining) {
                    db.prepare(`
                        UPDATE sessions 
                        SET days_remaining = ?, updated_at = CURRENT_TIMESTAMP 
                        WHERE id = ?
                    `).run(Math.max(0, daysRemaining), session.id);

                    // تحديث القيمة في النتيجة
                    session.days_remaining = Math.max(0, daysRemaining);
                }
            }
        });

        res.json(sessions);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch sessions' });
    }
});

app.get('/api/sessions/:id', requireAuth, (req, res) => {
    try {
        const sessionId = req.params.id;
        const userId = req.session.userId;
        if (!ensureUserIsActive(req, res)) return;

        const stmt = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?');
        const session = stmt.get(sessionId, userId);

        if (session) {
            res.json(session);
        } else {
            res.status(404).json({ error: 'Session not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch session' });
    }
});

// التحقق من الحالة الحقيقية للجلسة (لإعادة الاتصال التلقائي)
app.get('/api/sessions/:id/check-status', requireAuth, async (req, res) => {
    try {
        const sessionId = req.params.id;
        const userId = req.session.userId;
        if (!ensureUserIsActive(req, res)) return;

        // التحقق من أن الجلسة تخص المستخدم
        const session = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
        if (!session) {
            return res.status(404).json({ success: false, error: 'الجلسة غير موجودة' });
        }

        // التحقق من الحالة الحقيقية
        const hasActiveClient = activeClients.has(String(sessionId));
        let actualStatus = session.status;

        if (hasActiveClient) {
            const client = activeClients.get(String(sessionId));
            if (client.info) {
                actualStatus = 'connected';
            } else if (client.state === 'READY') {
                actualStatus = 'connected';
            } else if (client.state === 'OPENING') {
                actualStatus = 'connecting';
            }
        }

        // التحقق من وجود بيانات الجلسة
        const sessionPath = path.join(__dirname, 'sessions', `session-session_${sessionId}`);
        const hasSessionData = await fs.access(sessionPath).then(() => true).catch(() => false);

        res.json({
            success: true,
            sessionId: sessionId,
            currentStatus: session.status,
            actualStatus: actualStatus,
            hasActiveClient: hasActiveClient,
            hasSessionData: hasSessionData,
            isExpired: session.expires_at ? new Date(session.expires_at) <= new Date() : false,
            isPaused: session.is_paused === 1
        });
    } catch (error) {
        console.error('Error checking session status:', error);
        res.status(500).json({ success: false, error: 'فشل في التحقق من حالة الجلسة' });
    }
});

app.delete('/api/sessions/:id', requireAuth, async (req, res) => {
    try {
        const sessionId = req.params.id;
        const userId = req.session.userId;
        if (!ensureUserIsActive(req, res)) return;

        // Stop the client if it's running
        if (activeClients.has(String(sessionId))) {
            const client = activeClients.get(String(sessionId));
            await destroyClientCompletely(sessionId, client);
        }

        const stmt = db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?');
        const result = stmt.run(sessionId, userId);

        if (result.changes > 0) {
            // حذف مجلد الجلسة من القرص
            await deleteSessionFolder(sessionId);

            // حذف توكنات الجلسة المرتبطة
            deleteSessionTokenBySessionId(userId, String(sessionId));

            res.json({ success: true, message: 'تم حذف الجلسة ومجلدها بنجاح' });
        } else {
            res.status(404).json({ error: 'Session not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete session' });
    }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('start_session', async (data) => {
        try {
            const { sessionId, forceNewQR = false } = data;
            const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);

            if (!session) {
                socket.emit('session_error', { error: 'Session not found' });
                return;
            }

            if (session.expires_at) {
                const row = db.prepare('SELECT datetime(?) <= CURRENT_TIMESTAMP as expired').get(session.expires_at);
                if (row.expired) {
                    socket.emit('session_error', { error: 'انتهت صلاحية الجلسة. يرجى التجديد.' });
                    return;
                }
            }

            if (activeClients.has(String(sessionId))) {
                await destroyClientCompletely(sessionId, activeClients.get(String(sessionId)));
            }

            // تجنب "The browser is already running": تنظيف أي عملية Chrome قديمة تستخدم نفس مجلد الجلسة
            await cleanSessionLocks(sessionId, sessionsDir);
            await new Promise(resolve => setTimeout(resolve, 2500));

            const sessionPath = path.join(__dirname, 'sessions', `session-session_${sessionId}`);
            // مسح QR القديم دائماً عند البدء حتى لا يظهر رمز منتهي للمستخدم
            db.prepare('UPDATE sessions SET qr_code = NULL WHERE id = ?').run(sessionId);

            if (forceNewQR || session.status === 'auth_failure') {
                try {
                    await fs.rm(sessionPath, { recursive: true, force: true }).catch(() => { });
                    db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('waiting_for_qr', sessionId);
                } catch (e) { }
            }

            const client = new Client({
                authStrategy: new LocalAuth({ clientId: `session_${sessionId}`, dataPath: path.join(__dirname, 'sessions') }),
                puppeteer: getPuppeteerOptions()
            });

            activeClients.set(String(sessionId), client);
            setupClientEventHandlers(sessionId, client);

            client.initialize().catch(async (err) => {
                console.error(`[${sessionId}] Init error:`, err.message);
                if (activeClients.has(String(sessionId))) {
                    const failed = activeClients.get(String(sessionId));
                    activeClients.delete(String(sessionId));
                    try { await destroyClientCompletely(sessionId, failed); } catch (e) { /* ignore */ }
                }
                db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('disconnected', sessionId);
                io.emit('session_disconnected', { sessionId, reason: 'INIT_FAILED' });
                socket.emit('session_error', { error: 'فشل تهيئة الجلسة', code: 'INIT_FAILED' });
            });

        } catch (error) {
            console.error('Session start error:', error);
            socket.emit('session_error', { error: 'Failed to start session' });
        }
    });

    socket.on('stop_session', async (data) => {
        try {
            const { sessionId } = data;
            if (activeClients.has(String(sessionId))) {
                await destroyClientCompletely(sessionId, activeClients.get(String(sessionId)));
                db.prepare('UPDATE sessions SET qr_code = NULL, qr_timestamp = NULL, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('disconnected', sessionId);
                socket.emit('session_stopped', { sessionId });
            }
        } catch (error) {
            console.error('Session stop error:', error);
        }
    });

    socket.on('get_session_data', async (data) => {
        try {
            const { sessionId } = data;
            const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);

            if (!session) return;

            if (!activeClients.has(String(sessionId)) && session.status === 'connected') {
                const client = new Client({
                    authStrategy: new LocalAuth({ clientId: `session_${sessionId}`, dataPath: path.join(__dirname, 'sessions') }),
                    puppeteer: getPuppeteerOptions()
                });
                activeClients.set(String(sessionId), client);
                setupClientEventHandlers(sessionId, client);
                client.initialize().catch(async () => {
                    if (activeClients.has(String(sessionId))) {
                        const failed = activeClients.get(String(sessionId));
                        activeClients.delete(String(sessionId));
                        try { await destroyClientCompletely(sessionId, failed); } catch (e) { /* ignore */ }
                    }
                    db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('disconnected', sessionId);
                    io.emit('session_disconnected', { sessionId, reason: 'INIT_FAILED' });
                });
                return;
            }

            if (activeClients.has(String(sessionId))) {
                const client = activeClients.get(String(sessionId));
                if (client.info && session.session_data) {
                    socket.emit('session_data', JSON.parse(session.session_data));
                } else {
                    socket.emit('session_error', { error: 'Session initializing', code: 'BUSY' });
                }
            }
        } catch (error) { }
    });

    socket.on('send_message', async (data) => {
        try {
            const { sessionId, contacts, message } = data;
            if (!activeClients.has(String(sessionId))) {
                socket.emit('message_error', { error: 'Session not active' });
                return;
            }

            const client = activeClients.get(String(sessionId));
            const results = [];
            for (const contactId of contacts) {
                try {
                    const chatId = contactId.includes('@c.us') ? contactId : `${contactId}@c.us`;
                    await client.sendMessage(chatId, message);
                    results.push({ contactId, success: true });
                } catch (error) {
                    results.push({ contactId, success: false, error: error.message });
                }
            }
            socket.emit('message_sent', { results });
        } catch (error) {
            socket.emit('message_error', { error: error.message });
        }
    });

    socket.on('send_bulk_message', async (data) => {
        try {
            const { sessionId, contacts, message } = data;
            const client = activeClients.get(String(sessionId));
            if (!client) return;

            const results = [];
            for (const contactId of contacts) {
                try {
                    const chatId = contactId.includes('@c.us') ? contactId : `${contactId}@c.us`;
                    await client.sendMessage(chatId, message);
                    results.push({ contactId, success: true });
                } catch (error) {
                    results.push({ contactId, success: false, error: error.message });
                }
            }
            socket.emit('bulk_message_sent', { results });
        } catch (error) { }
    });

    socket.on('send_file', async (data) => {
        try {
            const { sessionId, contacts, fileData, fileName, fileType, caption } = data;
            const client = activeClients.get(String(sessionId));
            if (!client) return;

            const media = new MessageMedia(fileType, fileData, fileName);
            const results = [];
            for (const contactId of contacts) {
                try {
                    const chatId = contactId.includes('@c.us') ? contactId : `${contactId}@c.us`;
                    await client.sendMessage(chatId, media, { caption: caption || '' });
                    results.push({ contactId, success: true });
                } catch (error) {
                    results.push({ contactId, success: false, error: error.message });
                }
            }
            socket.emit('file_sent', { results });
        } catch (error) { }
    });

    socket.on('send_location', async (data) => {
        try {
            const { sessionId, contacts, latitude, longitude, name } = data;
            const client = activeClients.get(String(sessionId));
            if (!client) return;

            const results = [];
            for (const contactId of contacts) {
                try {
                    const chatId = contactId.includes('@c.us') ? contactId : `${contactId}@c.us`;
                    await client.sendMessage(chatId, new Location(latitude, longitude, name || ''));
                    results.push({ contactId, success: true });
                } catch (error) {
                    results.push({ contactId, success: false, error: error.message });
                }
            }
            socket.emit('location_sent', { results });
        } catch (error) { }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// تنظيف الجلسات المنتهية الصلاحية
async function cleanupExpiredSessions() {
    try {
        // الحصول على جميع الجلسات المنتهية الصلاحية التي لا تزال نشطة
        const expiredSessions = db.prepare(`
            SELECT id, is_paused FROM sessions 
            WHERE expires_at IS NOT NULL 
            AND expires_at < CURRENT_TIMESTAMP 
            AND status != 'expired'
        `).all();

        let closedCount = 0;

        // إغلاق العملاء النشطين للجلسات المنتهية
        for (const session of expiredSessions) {
            // تخطي الجلسات المتوقفة (قد يرغب المستخدم في تمديدها لاحقاً)
            if (session.is_paused === 1) {
                console.log(`[${session.id}] تخطي جلسة منتهية الصلاحية متوقفة`);
                continue;
            }

            const sessionId = String(session.id);

            // التحقق من وجود عميل نشط
            if (activeClients.has(sessionId)) {
                try {
                    const client = activeClients.get(sessionId);
                    console.log(`[${session.id}] إغلاق جلسة منتهية الصلاحية...`);

                    // إزالة العميل من activeClients قبل إغلاقه
                    activeClients.delete(sessionId);

                    // إغلاق العميل بشكل كامل
                    await destroyClientCompletely(session.id, client);

                    closedCount++;

                    // انتظار قليل بين كل جلسة
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (closeError) {
                    console.error(`[${session.id}] خطأ في إغلاق الجلسة المنتهية:`, closeError.message);
                    // إزالة العميل من activeClients حتى لو فشل الإغلاق
                    activeClients.delete(sessionId);
                }
            }
        }

        // تحديث حالة جميع الجلسات المنتهية في قاعدة البيانات (باستثناء المتوقفة)
        const result = db.prepare(`
            UPDATE sessions 
            SET status = 'expired' 
            WHERE expires_at IS NOT NULL 
            AND expires_at < CURRENT_TIMESTAMP 
            AND status != 'expired'
            AND is_paused = 0
        `).run();

        if (result.changes > 0 || closedCount > 0) {
            console.log(`🧹 تم تنظيف ${result.changes} جلسة منتهية الصلاحية (تم إغلاق ${closedCount} جلسة نشطة)`);
        }
    } catch (error) {
        console.error('خطأ في تنظيف الجلسات المنتهية:', error);
    }
}

const PORT = process.env.PORT || 3000;

// معالجة إغلاق الخادم بشكل نظيف (Graceful Shutdown)
async function gracefulShutdown(signal) {
    console.log(`\n🏴 تلقي إشارة ${signal}، بدء إغلاق الخادم...`);

    // إيقاف مؤقتات إعادة الاتصال والـ heartbeat حتى لا تُنشئ جلسات جديدة أثناء الإغلاق
    if (typeof sessionTracker.cleanupAll === 'function') {
        sessionTracker.cleanupAll();
    }

    // إيقاف استقبال اتصالات جديدة إذا أمكن (server.close)
    if (server) {
        server.close(() => {
            console.log('🛑 تم إغلاق خادم HTTP');
        });
    }

    // إغلاق جميع الجلسات النشطة
    if (activeClients.size > 0) {
        console.log(`🔌 إغلاق ${activeClients.size} جلسة نشطة...`);
        const closePromises = [];

        for (const [sessionId, client] of activeClients.entries()) {
            closePromises.push(destroyClientCompletely(sessionId, client));
        }

        try {
            // انتظار إغلاق جميع الجلسات (بحد أقصى 10 ثواني)
            await Promise.race([
                Promise.all(closePromises),
                new Promise(resolve => setTimeout(resolve, 10000))
            ]);
            console.log('✅ تم إغلاق جميع الجلسات');
        } catch (error) {
            console.error('⚠️ خطأ أثناء إغلاق الجلسات:', error.message);
        }
    } else {
        console.log('✨ لا توجد جلسات نشطة للإغلاق');
    }

    console.log('👋 وداعاً!');
    process.exit(0);
}

// تسجيل معالجات الإشارات
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

server.listen(PORT, async () => {
    console.log(`🚀 WhatsApp Dashboard Server running on port ${PORT}`);
    console.log(`📱 Open http://localhost:${PORT} in your browser`);

    // تنظيف عمليات Chrome المعلقة عند بدء التشغيل (قبل الاستعادة، activeClients فارغ فتُنظَّف كل المجلدات)
    await cleanupChromeZombies(sessionsDir, activeClients);

    // تنظيف الجلسات المنتهية الصلاحية
    cleanupExpiredSessions().catch(err => {
        console.error('خطأ في تنظيف الجلسات المنتهية (بدء التشغيل):', err);
    });

    // تنظيف الجلسات المحذوفة التي لا تزال موجودة على القرص
    console.log('🧹 تنظيف الجلسات المحذوفة...');
    const cleanupResult = await cleanupOrphanedSessions();
    if (cleanupResult.cleanedCount > 0) {
        console.log(`✅ تم تنظيف ${cleanupResult.cleanedCount} جلسة محذوفة، تم تحرير ${(cleanupResult.cleanedSize / 1024 / 1024).toFixed(2)} MB`);
    }

    // ── Modern Session Restoration ──
    await performSessionRestoration();

    // تنظيف الجلسات المنتهية كل 24 ساعة
    setInterval(() => {
        cleanupExpiredSessions().catch(err => {
            console.error('خطأ في تنظيف الجلسات المنتهية (دوري):', err);
        });
    }, 24 * 60 * 60 * 1000);

    setInterval(async () => {
        console.log('🧹 تنظيف دوري للجلسات المحذوفة...');
        const cleanupResult = await cleanupOrphanedSessions();
        if (cleanupResult.cleanedCount > 0) {
            console.log(`✅ تم تنظيف ${cleanupResult.cleanedCount} جلسة محذوفة، تم تحرير ${(cleanupResult.cleanedSize / 1024 / 1024).toFixed(2)} MB`);
        }
    }, 24 * 60 * 60 * 1000); // 24 ساعة

    // مراقبة عمليات Chrome كل 5 دقائق
    setInterval(monitorChromeProcesses, 10 * 60 * 1000);

    // مراقبة عند بدء الخادم
    setTimeout(monitorChromeProcesses, 10000); // بعد 10 ثوان

    // تحديث الأيام المتبقية للجلسات كل 6 ساعات
    setInterval(() => {
        try {
            const sessions = db.prepare('SELECT id, expires_at, days_remaining FROM sessions WHERE expires_at IS NOT NULL').all();
            const now = new Date();

            sessions.forEach(session => {
                const expiryDate = new Date(session.expires_at);
                const timeDiff = expiryDate.getTime() - now.getTime();
                const daysRemaining = Math.ceil(timeDiff / (1000 * 3600 * 24));

                if (daysRemaining !== session.days_remaining) {
                    db.prepare(`
                        UPDATE sessions 
                        SET days_remaining = ?, updated_at = CURRENT_TIMESTAMP 
                        WHERE id = ?
                    `).run(Math.max(0, daysRemaining), session.id);
                }
            });

            console.log(`🔄 تم تحديث الأيام المتبقية لـ ${sessions.length} جلسة`);
        } catch (error) {
            console.error('خطأ في تحديث الأيام المتبقية:', error.message);
        }
    }, 6 * 60 * 60 * 1000); // كل 6 ساعات

});
