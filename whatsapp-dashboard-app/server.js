require('dotenv').config();

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
const apiRoutes = require('./api-routes');
const { router: apiRouter, setActiveClientsRef: apiRoutesSetActiveClientsRef } = apiRoutes;
const reportRoutes = require('./report-routes');
const invoiceRoutes = require('./invoice-routes');
const {
    createApiKey, getUserApiKeys, deleteApiKey,
    createSessionToken, getUserSessionTokens, deleteSessionToken,
    getUserApiLogs, getUserApiKey, deleteUserApiKey,
    getSessionTokenBySessionId, deleteSessionTokenBySessionId
} = require('./api-key-manager');

const DISABLE_MESSAGE_STORAGE = (process.env.DISABLE_MESSAGE_STORAGE ?? 'true') === 'true';

function ensureUserIsActive(req, res) {
    const user = db.prepare('SELECT is_active FROM users WHERE id = ?').get(req.session.userId);
    if (!user || user.is_active !== 1) {
        res.status(403).json({ error: 'تم إيقاف المستخدم من قبل الإدارة' });
        return false;
    }
    return true;
}

const { destroyClientCompletely: destroyClientCompletelyBase, killChromeProcessesForSession, getPuppeteerOptions, isClientHealthy } = require('./session-manager');
const { SessionService } = require('./lib/session-service');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const sessionService = new SessionService({
    db,
    io,
    getPuppeteerOptions,
    killChromeProcessesForSession,
    destroyClientCompletely: destroyClientCompletelyBase,
    isClientHealthy
});

app.set('trust proxy', 1);

const corsOptions = {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'X-Requested-With', 'x-api-key', 'x-session-token', 'Authorization', 'Accept'],
    exposedHeaders: ['Content-Type'],
    credentials: false,
};

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: { error: 'تم تجاوز الحد المسموح من الطلبات، يرجى المحاولة لاحقاً' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
});

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: { error: 'تم تجاوز الحد المسموح من طلبات API، يرجى المحاولة لاحقاً' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
});

const messageLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { error: 'تم تجاوز الحد المسموح من الرسائل في الدقيقة، يرجى المحاولة لاحقاً' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
});

const dailyMessageLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    max: 10000,
    message: { error: 'تم تجاوز الحد المسموح من الرسائل اليومية، يرجى المحاولة غداً' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
});


app.use(cors(corsOptions));

app.use((req, res, next) => {
    const q = req.url.indexOf('?');
    const pathPart = q >= 0 ? req.url.slice(0, q) : req.url;
    const queryPart = q >= 0 ? req.url.slice(q) : '';
    req.url = pathPart.replace(/\/+/g, '/') + queryPart;
    next();
});

const JSON_LIMIT = '10mb';
const jsonParser = express.json({ limit: JSON_LIMIT, strict: false });
app.use((req, res, next) => {
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('application/json')) {
        return jsonParser(req, res, (err) => {
            if (err) {
                const msg = (err.message || '').includes('control character')
                    ? 'محتوى الطلب يحتوي على أحرف تحكم غير مسموحة. استخدم \\n للأسطر الجديدة في النص.'
                    : 'يرجى التحقق من تنسيق JSON والبيانات المرسلة.';
                return res.status(400).json({ success: false, error: 'خطأ في تنسيق JSON', details: msg });
            }
            next();
        });
    }
    const chunks = [];
    let len = 0;
    const limit = 10 * 1024 * 1024;
    req.on('data', (chunk) => {
        len += chunk.length;
        if (len > limit) { req.destroy(); return; }
        chunks.push(chunk);
    });
    req.on('end', () => {
        try {
            const buf = Buffer.concat(chunks);
            const str = (buf.length ? buf.toString('utf8') : '{}').replace(/[\x00-\x1F\x7F]/g, ' ');
            req.body = JSON.parse(str || '{}');
            next();
        } catch (e) {
            res.status(400).json({ success: false, error: 'خطأ في تنسيق JSON', details: 'يرجى التحقق من البيانات المرسلة. استخدم \\n للأسطر الجديدة.' });
        }
    });
    req.on('error', () => res.status(400).end());
});

app.use(generalLimiter);
app.use('/api', apiLimiter);
app.use('/api/invoices', invoiceRoutes);
app.options('*', cors(corsOptions));

app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

const activeClients = sessionService.getMap();
app.set('activeClients', activeClients);
apiRoutesSetActiveClientsRef(activeClients);
invoiceRoutes.setActiveClientsRef(activeClients);

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

async function cleanupOrphanedSessions() {
    try {
        const sessionsDir = path.join(__dirname, 'sessions');
        const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
        const dbSessions = db.prepare('SELECT id FROM sessions').all();
        const validSessionIds = new Set(dbSessions.map(s => s.id));
        let cleanedCount = 0;
        let cleanedSize = 0;

        for (const entry of entries) {
            if (entry.isDirectory() && entry.name.startsWith('session-session_')) {
                const match = entry.name.match(/session-session_(\d+)/);
                if (match) {
                    const sessionId = parseInt(match[1]);
                    if (!validSessionIds.has(sessionId)) {
                        const sessionPath = path.join(sessionsDir, entry.name);
                        try {
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
                } catch (e) { }
            }
        }
    } catch (e) { }
    return totalSize;
}

const requireAuth = (req, res, next) => {
    if (req.session.userId) {
        try {
            const user = db.prepare('SELECT id, username, is_admin, is_active FROM users WHERE id = ?').get(req.session.userId);
            if (!user) {
                return res.status(401).json({ error: 'User not found' });
            }
            req.user = user;
            next();
        } catch (error) {
            console.error('Auth error:', error);
            res.status(500).json({ error: 'Authentication error' });
        }
    } else {
        res.status(401).json({ error: 'Authentication required' });
    }
};

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

app.get('/subscriptions', requireAuth, (req, res) => {
    if (!ensureUserIsActive(req, res)) return;
    res.sendFile(path.join(__dirname, 'public', 'subscriptions.html'));
});

app.get('/packages', requireAuth, requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'packages.html'));
});

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

app.get('/api/active-sessions-list', requireAuth, (req, res) => {
    try {
        const userId = req.session.userId;
        const sessions = db.prepare(`
            SELECT id, session_name as name, status 
            FROM sessions 
            WHERE user_id = ? AND status IN ('connected', 'authenticated')
            ORDER BY session_name
        `).all(userId);
        res.json(sessions);
    } catch (error) {
        console.error('Error fetching active sessions list:', error);
        res.status(500).json({ error: 'Failed to fetch sessions' });
    }
});

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

app.get('/api/settings', requireAuth, (req, res) => {
    try {
        const row = db.prepare('SELECT admin_phone, packages_json FROM settings WHERE id = 1').get();
        const packages = row && row.packages_json ? JSON.parse(row.packages_json) : [];
        res.json({ success: true, adminPhone: row?.admin_phone || '', packages });
    } catch (e) {
        res.status(500).json({ error: 'Failed to load settings' });
    }
});

app.get('/admin', requireAuth, (req, res) => {
    const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
    if (!row || row.is_admin !== 1) {
        return res.status(403).send('غير مصرح');
    }
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

function requireAdmin(req, res, next) {
    if (!req.user || req.user.is_admin !== 1) {
        return res.status(403).json({ error: 'غير مصرح' });
    }
    next();
}

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
    const rows = db.prepare('SELECT id, username, email, is_active, is_admin, max_sessions, session_ttl_days, created_at FROM users ORDER BY id DESC').all();
    res.json({ success: true, users: rows });
});

app.get('/api/admin/users/:userId/details', requireAuth, requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
        }

        const apiKeys = getUserApiKeys(userId);

        const sessionTokens = getUserSessionTokens(userId);

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

        const now = new Date();
        rows.forEach(session => {
            if (session.expires_at) {
                const expiryDate = new Date(session.expires_at);
                const timeDiff = expiryDate.getTime() - now.getTime();
                const daysRemaining = Math.ceil(timeDiff / (1000 * 3600 * 24));

                if (daysRemaining !== session.days_remaining) {
                    db.prepare(`
                        UPDATE sessions 
                        SET days_remaining = ?, updated_at = CURRENT_TIMESTAMP 
                        WHERE id = ?
                    `).run(Math.max(0, daysRemaining), session.id);

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

app.delete('/api/admin/sessions/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const sessionId = req.params.id;

        const client = sessionService.getClient(sessionId);
        if (client) {
            await sessionService.stopSession(sessionId, client);
            await new Promise(r => setTimeout(r, 2000));
        }
        await killChromeProcessesForSession(sessionId);
        await new Promise(r => setTimeout(r, 1000));

        const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);

        if (result.changes > 0) {
            await killChromeProcessesForSession(sessionId);
            await new Promise(r => setTimeout(r, 1000));
            const sessionPath = path.join(__dirname, 'sessions', `session-session_${sessionId}`);
            try {
                await fs.rm(sessionPath, { recursive: true, force: true, maxRetries: 5 });
            } catch (_) { }
            res.json({ success: true, message: 'تم حذف الجلسة بنجاح' });
        } else {
            res.status(404).json({ success: false, error: 'الجلسة غير موجودة' });
        }
    } catch (error) {
        console.error('Error deleting session:', error);
        res.status(500).json({ success: false, error: 'فشل في حذف الجلسة' });
    }
});

app.post('/api/admin/sessions/:id/restart', requireAuth, requireAdmin, (req, res) => {
    try {
        const sessionId = req.params.id;
        sessionService.updateStatus(sessionId, 'disconnected');
        res.json({ success: true, message: 'تم إعادة تعيين الجلسة' });
    } catch (error) {
        console.error('Error restarting session:', error);
        res.status(500).json({ success: false, error: 'فشل في إعادة تشغيل الجلسة' });
    }
});


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

app.put('/api/admin/users/:userId', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { username, email, password, maxSessions, sessionDays, isAdmin, isActive } = req.body;

        if (!username || !email) {
            return res.status(400).json({ success: false, error: 'اسم المستخدم والبريد الإلكتروني مطلوبان' });
        }

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

app.post('/api/admin/users/:userId/toggle', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;

        if (parseInt(userId) === req.user.id) {
            return res.status(400).json({ success: false, error: 'لا يمكنك إيقاف حسابك الخاص' });
        }

        const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (!row) {
            return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
        }

        const newVal = row.is_active === 1 ? 0 : 1;
        db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(newVal, userId);

        if (newVal === 0) {
            const sessions = db.prepare('SELECT id FROM sessions WHERE user_id = ?').all(userId);
            for (const session of sessions) {
                const sessionId = String(session.id);
                const client = sessionService.getClient(session.id);
                if (client) await sessionService.stopSession(session.id, client);
            }
            db.prepare('UPDATE sessions SET status = ? WHERE user_id = ?').run('disconnected', userId);
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

app.delete('/api/admin/users/:userId', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;

        if (parseInt(userId) === req.user.id) {
            return res.status(400).json({ success: false, error: 'لا يمكنك حذف حسابك الخاص' });
        }

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
        }

        const sessions = db.prepare('SELECT id FROM sessions WHERE user_id = ?').all(userId);
        for (const session of sessions) {
            const client = sessionService.getClient(session.id);
            if (client) await sessionService.stopSession(session.id, client);
        }

        try { db.prepare('UPDATE api_keys SET is_active = 0 WHERE user_id = ?').run(userId); } catch (_) { }
        try { db.prepare('UPDATE session_tokens SET is_active = 0 WHERE user_id = ?').run(userId); } catch (_) { }

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


app.post('/api/admin/users/:userId/logout', requireAuth, requireAdmin, async (req, res) => {
    const { userId } = req.params;
    const sessions = db.prepare('SELECT id FROM sessions WHERE user_id = ?').all(userId);
    for (const s of sessions) {
        const key = String(s.id);
        const client = sessionService.getClient(key);
        if (client) await sessionService.stopSession(key, client);
    }
    db.prepare('UPDATE api_keys SET is_active = FALSE WHERE user_id = ?').run(userId);
    db.prepare('UPDATE session_tokens SET is_active = FALSE WHERE user_id = ?').run(userId);
    res.json({ success: true });
});



app.use('/api', apiRouter);
app.use('/api/reports', reportRoutes);

app.get('/api/email-status', (req, res) => {
    try {
        const status = getServiceStatus();
        res.json({ success: true, status });
    } catch (error) {
        console.error('Error checking email service status:', error);
        res.status(500).json({ error: 'فشل في فحص حالة الخدمات' });
    }
});


app.get('/api/user-api-info', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        if (!ensureUserIsActive(req, res)) return;

        let apiKey = getUserApiKey(userId);
        if (!apiKey) {
            const result = createApiKey(userId, 'API Key');
            apiKey = result.apiKey;
        }

        const sessions = await getSessionsForUser(userId);
        const sessionTokens = [];

        for (const session of sessions) {
            let token = getSessionTokenBySessionId(userId, String(session.id));
            if (!token) {
                const result = createSessionToken(userId, String(session.id));
                token = result.token;
            }

            sessionTokens.push({
                sessionId: session.id,
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

app.post('/api/regenerate-api-key', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        if (!ensureUserIsActive(req, res)) return;

        deleteUserApiKey(userId);

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

app.get('/api/session/:sessionId/token', requireAuth, async (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        const userId = req.session.userId;
        if (!ensureUserIsActive(req, res)) return;

        const sessionStmt = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?');
        const session = sessionStmt.get(sessionId, userId);

        if (!session) {
            return res.status(404).json({ error: 'الجلسة غير موجودة' });
        }

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

app.post('/api/regenerate-session-token', requireAuth, async (req, res) => {
    try {
        const { sessionId } = req.body;
        const userId = req.session.userId;
        if (!ensureUserIsActive(req, res)) return;

        if (!sessionId) {
            return res.status(400).json({ error: 'معرف الجلسة مطلوب' });
        }

        const sessionStmt = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?');
        const session = sessionStmt.get(sessionId, userId);

        if (!session) {
            return res.status(404).json({ error: 'الجلسة غير موجودة' });
        }

        deleteSessionTokenBySessionId(userId, String(sessionId));

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

app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ error: 'اسم المستخدم والبريد الإلكتروني وكلمة المرور مطلوبة' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'البريد الإلكتروني غير صحيح' });
        }

        const existingUser = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, email);
        if (existingUser) {
            if (existingUser.username === username) {
                return res.status(400).json({ error: 'اسم المستخدم موجود بالفعل' });
            } else {
                return res.status(400).json({ error: 'البريد الإلكتروني مستخدم بالفعل' });
            }
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const insertUserStmt = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)');
        const result = insertUserStmt.run(username, email, passwordHash);
        const userId = result.lastInsertRowid;


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


        req.session.userId = user.id;
        req.session.username = user.username;

        res.json({ success: true, userId: user.id });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'فشل في تسجيل الدخول' });
    }
});

app.post('/api/verify-email', async (req, res) => {
    try {
        const { email, code } = req.body;

        if (!email || !code) {
            return res.status(400).json({ error: 'البريد الإلكتروني ورمز التحقق مطلوبان' });
        }

        const userStmt = db.prepare('SELECT * FROM users WHERE email = ?');
        const user = userStmt.get(email);

        if (!user) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }

        const tokenStmt = db.prepare('SELECT * FROM email_verification_tokens WHERE user_id = ? AND token = ? AND expires_at > CURRENT_TIMESTAMP');
        const token = tokenStmt.get(user.id, code);

        if (!token) {
            return res.status(400).json({ error: 'رمز التحقق غير صحيح أو منتهي الصلاحية' });
        }

        const updateStmt = db.prepare('UPDATE users SET email_verified = TRUE WHERE id = ?');
        updateStmt.run(user.id);

        const deleteTokenStmt = db.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?');
        deleteTokenStmt.run(user.id);

        res.json({ success: true, message: 'تم التحقق من البريد الإلكتروني بنجاح' });
    } catch (error) {
        console.error('Email verification error:', error);
        res.status(500).json({ error: 'فشل في التحقق من البريد الإلكتروني' });
    }
});

app.post('/api/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'البريد الإلكتروني مطلوب' });
        }

        const userStmt = db.prepare('SELECT * FROM users WHERE email = ?');
        const user = userStmt.get(email);

        if (!user) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }

        const deleteOldTokensStmt = db.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?');
        deleteOldTokensStmt.run(user.id);

        const verificationCode = crypto.randomInt(100000, 999999).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        const insertTokenStmt = db.prepare('INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES (?, ?, ?)');
        insertTokenStmt.run(user.id, verificationCode, expiresAt.toISOString());

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

        const user = db.prepare('SELECT max_sessions, session_ttl_days FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
        }

        const maxSessions = user.max_sessions != null ? Number(user.max_sessions) : 5;
        const days = user.session_ttl_days != null ? Number(user.session_ttl_days) : 30;

        const allSessions = db.prepare('SELECT COUNT(*) as count FROM sessions WHERE user_id = ?').get(userId);

        if (maxSessions > 0 && allSessions.count >= maxSessions) {
            return res.status(403).json({
                success: false,
                error: `تم بلوغ الحد الأقصى للجلسات المسموحة (${maxSessions}). يرجى حذف جلسة أخرى أولاً.`
            });
        }

        const stmt = db.prepare('INSERT INTO sessions (session_name, user_id) VALUES (?, ?)');
        const result = stmt.run(sessionName, userId);

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

        const now = new Date();
        sessions.forEach(session => {
            if (session.expires_at) {
                const expiryDate = new Date(session.expires_at);
                const timeDiff = expiryDate.getTime() - now.getTime();
                const daysRemaining = Math.ceil(timeDiff / (1000 * 3600 * 24));

                if (daysRemaining !== session.days_remaining) {
                    db.prepare(`
                        UPDATE sessions 
                        SET days_remaining = ?, updated_at = CURRENT_TIMESTAMP 
                        WHERE id = ?
                    `).run(Math.max(0, daysRemaining), session.id);

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

app.delete('/api/sessions/:id', requireAuth, async (req, res) => {
    try {
        const sessionId = req.params.id;
        const userId = req.session.userId;
        if (!ensureUserIsActive(req, res)) return;

        const client = sessionService.getClient(sessionId);
        if (client) {
            await sessionService.stopSession(sessionId, client);
            await new Promise(r => setTimeout(r, 2000));
        }
        await killChromeProcessesForSession(sessionId);
        await new Promise(r => setTimeout(r, 1500));

        const stmt = db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?');
        const result = stmt.run(sessionId, userId);

        if (result.changes > 0) {
            await killChromeProcessesForSession(sessionId);
            await new Promise(r => setTimeout(r, 1500));
            await deleteSessionFolder(sessionId);
            deleteSessionTokenBySessionId(userId, String(sessionId));
            res.json({ success: true, message: 'تم حذف الجلسة ومجلدها بنجاح' });
        } else {
            res.status(404).json({ error: 'Session not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete session' });
    }
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('start_session', async (data) => {
        const sid = data && data.sessionId != null ? String(data.sessionId) : null;
        try {
            const { sessionId, forceNewQR = false } = data;

            const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
            const session = stmt.get(sessionId);

            if (!session) {
                socket.emit('session_error', { error: 'Session not found' });
                return;
            }

            if (sessionService.isStarting(sessionId)) {
                socket.emit('session_error', { error: 'الجلسة قيد التشغيل بالفعل، انتظر قليلاً ثم أعد المحاولة.' });
                return;
            }

            if (session.expires_at) {
                const row = db.prepare('SELECT datetime(?) <= CURRENT_TIMESTAMP as expired').get(session.expires_at);
                if (row.expired) {
                    socket.emit('session_error', { error: 'انتهت صلاحية الجلسة. يرجى التجديد.' });
                    return;
                }
            }

            const sessionPath = path.join(__dirname, 'sessions', `session-session_${sessionId}`);
            if (forceNewQR || session.status === 'auth_failure') {
                try {
                    const sessionExists = await fs.access(sessionPath).then(() => true).catch(() => false);
                    if (sessionExists) {
                        console.log(`[${sessionId}] حذف بيانات الجلسة (forceNewQR: ${forceNewQR}, auth_failure: ${session.status === 'auth_failure'})`);
                        await fs.rm(sessionPath, { recursive: true, force: true });
                    }
                    if (forceNewQR || session.status === 'auth_failure') {
                        db.prepare('UPDATE sessions SET qr_code = NULL WHERE id = ?').run(sessionId);
                    }
                } catch (err) {
                    console.error(`[${sessionId}] خطأ في حذف بيانات الجلسة:`, err.message);
                }
            }

            const sessionDataExists = await fs.access(sessionPath).then(() => true).catch(() => false);
            const status = (sessionDataExists && !forceNewQR && session.status !== 'auth_failure') ? 'connecting' : 'waiting_for_qr';

            let client;
            try {
                client = await sessionService.startSession(sessionId, { status });
            } catch (err) {
                socket.emit('session_error', { error: err.message || 'Failed to start session' });
                return;
            }

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
                                if (media) { mediaBase64 = media.data; mediaMime = media.mimetype; hasMedia = true; }
                            } catch (_) { }
                        }
                        const chatId = (typeof msg.from === 'object' && msg.from !== null) ? msg.from._serialized : (msg.from || '');
                        const messageId = (typeof msg.id === 'object' && msg.id !== null) ? msg.id._serialized : (msg.id || `${Date.now()}-${Math.random()}`);
                        const sender = (typeof msg.from === 'object' && msg.from !== null) ? msg.from._serialized : (msg.from || '');
                        const receiver = (typeof msg.to === 'object' && msg.to !== null) ? msg.to._serialized : (msg.to || '');
                        insert.run(
                            String(sessionId), String(chatId), String(messageId), msg.fromMe ? 1 : 0,
                            String(msg.type || 'chat'), String(msg.body || ''), hasMedia ? 1 : 0,
                            mediaMime ? String(mediaMime) : null, mediaBase64 ? String(mediaBase64) : null,
                            String(sender), String(receiver)
                        );
                    } catch (e) {
                        console.error('فشل في حفظ الرسالة الواردة:', e.message);
                    }
                });
            }

            client.initialize().catch(async (err) => {
                console.error(`[${sessionId}] فشل تهيئة الجلسة:`, err.message);
                sessionService.getMap().delete(String(sessionId));
                sessionService.updateStatus(sessionId, 'disconnected');
                socket.emit('session_error', { error: err.message || 'Failed to start session' });
            });

        } catch (error) {
            console.error('Session start error:', error);
            socket.emit('session_error', { error: 'Failed to start session' });
        }
    });

    socket.on('stop_session', async (data) => {
        try {
            const { sessionId } = data;
            const client = sessionService.getClient(sessionId);
            if (client) {
                await sessionService.stopSession(sessionId, client);
                db.prepare('UPDATE sessions SET qr_code = NULL, qr_timestamp = NULL WHERE id = ?').run(sessionId);
                sessionService.updateStatus(sessionId, 'disconnected');
                socket.emit('session_stopped', { sessionId });
            }
        } catch (error) {
            console.error('Session stop error:', error);
        }
    });

    socket.on('get_session_data', async (data) => {
        try {
            const { sessionId } = data;

            const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
            const session = stmt.get(sessionId);

            if (!session) {
                socket.emit('session_error', { error: 'Session not found' });
                return;
            }

            let client = sessionService.getClient(sessionId);
            if (!client && session.status === 'connected') {
                console.log(`Restarting inactive session ${sessionId} (get_session_data)`);
                try {
                    client = await sessionService.startSession(sessionId, { status: 'connecting' });
                    await new Promise((resolve, reject) => {
                        client.once('ready', resolve);
                        client.once('auth_failure', () => reject(new Error('Auth failure')));
                        client.initialize().catch(reject);
                        setTimeout(() => reject(new Error('Timeout')), 30000);
                    });
                    client = sessionService.getClient(sessionId);
                    await new Promise(r => setTimeout(r, 2000));
                } catch (err) {
                    socket.emit('session_error', { error: err.message || 'Failed to restart session' });
                    return;
                }
            }

            if (client) {
                if (!client.info) {
                    socket.emit('session_error', { error: 'الجلسة غير جاهزة بعد، يرجى المحاولة لاحقاً', code: 'SESSION_NOT_READY' });
                    return;
                }
                try {
                    const chats = await client.getChats().catch(() => []);
                    let contacts = [];
                    try { contacts = await client.getContacts(); } catch (_) {
                        contacts = chats.filter(c => !c.isGroup).map(c => ({ id: c.id._serialized, pushname: c.name || c.id?.user, number: c.id?.user }));
                    }
                    const sessionData = {
                        sessionId,
                        chats: (chats || []).map(chat => ({ id: chat.id._serialized, name: chat.name || chat.id?.user, type: chat.isGroup ? 'group' : 'private' })),
                        contacts: (contacts || []).map(contact => ({ id: contact.id?._serialized || contact.id, name: contact.pushname || contact.name || contact.number, number: contact.id?.user ?? contact.number }))
                    };
                    db.prepare('UPDATE sessions SET session_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(sessionData), sessionId);
                    socket.emit('session_data', sessionData);
                } catch (err) {
                    socket.emit('session_error', { error: err.message || 'Failed to get session data' });
                }
            } else {
                socket.emit('session_error', { error: 'Session not active and cannot be restarted' });
            }

        } catch (error) {
            console.error('Get session data error:', error);
            socket.emit('session_error', { error: 'Failed to get session data' });
        }
    });

    socket.on('send_message', async (data) => {
        try {
            const { sessionId, contacts, message } = data;

            const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
            const session = stmt.get(sessionId);

            if (!session) {
                socket.emit('message_error', { error: 'Session not found' });
                return;
            }

            let client = sessionService.getClient(sessionId);
            if (!client && session.status === 'connected') {
                console.log(`Restarting inactive session ${sessionId} for message sending`);
                try {
                    client = await sessionService.startSession(sessionId, { status: 'connecting' });
                    await new Promise((resolve, reject) => {
                        client.once('ready', resolve);
                        client.once('auth_failure', () => reject(new Error('Auth failure')));
                        client.initialize().catch(reject);
                        setTimeout(() => reject(new Error('Timeout')), 30000);
                    });
                    client = sessionService.getClient(sessionId);
                    await new Promise(r => setTimeout(r, 1000));
                } catch (err) {
                    socket.emit('message_error', { error: 'Failed to restart session' });
                    return;
                }
            }
            if (!client) {
                socket.emit('message_error', { error: 'Failed to restart session' });
                return;
            }
            const results = [];

            for (const contactId of contacts) {
                try {
                    const chat = await client.getChatById(contactId);
                    await chat.sendMessage(message);
                    results.push({ contactId, success: true });
                } catch (error) {
                    results.push({ contactId, success: false, error: error.message });
                }
            }

            socket.emit('message_sent', { results });

        } catch (error) {
            console.error('خطأ في إرسال الرسالة:', error);
            socket.emit('message_error', { error: 'فشل في إرسال الرسالة: ' + error.message });
        }
    });

    socket.on('send_bulk_message', async (data) => {
        try {
            const { sessionId, contacts, message } = data;

            const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
            const session = stmt.get(sessionId);

            if (!session) {
                socket.emit('message_error', { error: 'Session not found' });
                return;
            }

            const client = sessionService.getClient(sessionId);
            if (!client) {
                socket.emit('message_error', { error: 'Session not active' });
                return;
            }

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

        } catch (error) {
            console.error('خطأ في إرسال الرسائل الجماعية:', error);
            socket.emit('message_error', { error: 'فشل في إرسال الرسائل الجماعية: ' + error.message });
        }
    });

    socket.on('send_file', async (data) => {
        try {
            const { sessionId, contacts, fileData, fileName, fileType, caption } = data;

            const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
            const session = stmt.get(sessionId);

            if (!session) {
                socket.emit('file_error', { error: 'Session not found' });
                return;
            }

            let client = sessionService.getClient(sessionId);
            if (!client && session.status === 'connected') {
                console.log(`Restarting inactive session ${sessionId} for file sending`);
                try {
                    client = await sessionService.startSession(sessionId, { status: 'connecting' });
                    await new Promise((resolve, reject) => {
                        client.once('ready', resolve);
                        client.once('auth_failure', () => reject(new Error('Auth failure')));
                        client.initialize().catch(reject);
                        setTimeout(() => reject(new Error('Timeout')), 30000);
                    });
                    client = sessionService.getClient(sessionId);
                    await new Promise(r => setTimeout(r, 1000));
                } catch (err) {
                    socket.emit('file_error', { error: 'Failed to restart session' });
                    return;
                }
            }
            if (!client) {
                socket.emit('file_error', { error: 'Failed to restart session' });
                return;
            }
            const results = [];

            const fileBuffer = Buffer.from(fileData, 'base64');

            for (const contactId of contacts) {
                try {
                    const chat = await client.getChatById(contactId);

                    const media = new MessageMedia(fileType, fileData, fileName);
                    await chat.sendMessage(media, { caption: caption || '' });

                    results.push({ contactId, success: true });
                } catch (error) {
                    results.push({ contactId, success: false, error: error.message });
                }
            }

            socket.emit('file_sent', { results });

        } catch (error) {
            console.error('خطأ في إرسال الملف:', error);
            socket.emit('file_error', { error: 'فشل في إرسال الملف: ' + error.message });
        }
    });

    socket.on('send_location', async (data) => {
        try {
            const { sessionId, contacts, latitude, longitude, name } = data;

            const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
            const session = stmt.get(sessionId);

            if (!session) {
                socket.emit('message_error', { error: 'Session not found' });
                return;
            }

            const client = sessionService.getClient(sessionId);
            if (!client) {
                socket.emit('message_error', { error: 'Session not active' });
                return;
            }

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

        } catch (error) {
            console.error('خطأ في إرسال الموقع:', error);
            socket.emit('message_error', { error: 'فشل في إرسال الموقع: ' + error.message });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;

async function gracefulShutdown(signal) {
    console.log(`\n🏴 تلقي إشارة ${signal}، بدء إغلاق الخادم...`);

    if (server) {
        server.close(() => {
            console.log('🛑 تم إغلاق خادم HTTP');
        });
    }

    const map = sessionService.getMap();
    if (map.size > 0) {
        console.log(`🔌 إغلاق ${map.size} جلسة نشطة...`);
        const closePromises = [];
        for (const [sessionId, client] of map.entries()) {
            closePromises.push(sessionService.stopSession(sessionId, client));
        }

        try {
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

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

server.listen(PORT, async () => {
    console.log(`🚀 WhatsApp Dashboard Server running on port ${PORT}`);
    console.log(`📱 Open http://localhost:${PORT} in your browser`);
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'your-secret-key-change-this-in-production') {
        console.warn('⚠️ تحذير: SESSION_SECRET غير معيّن أو افتراضي. ضع متغير البيئة SESSION_SECRET في الإنتاج.');
    }

    console.log('🔄 استعادة الجلسات...');
    await sessionService.restoreOnStartup();

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
    }, 6 * 60 * 60 * 1000);
});
