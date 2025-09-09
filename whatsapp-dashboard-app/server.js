// ========================================
// WhatsApp Dashboard Server
// ========================================
// هذا الملف يحتوي على الخادم الرئيسي للتطبيق
// يدعم إدارة جلسات WhatsApp المتعددة مع نظام تحقق من البريد الإلكتروني

// تحميل متغيرات البيئة
require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const { Client, LocalAuth, MessageMedia, Location } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const cors = require('cors');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { sendVerificationEmail, getServiceStatus } = require('./multi-email-service');
const { router: apiRoutes, setActiveClientsRef } = require('./api-routes');
const { 
    createApiKey, getUserApiKeys, deleteApiKey,
    createSessionToken, getUserSessionTokens, deleteSessionToken,
    getUserApiLogs, getUserApiKey, deleteUserApiKey,
    getSessionTokenBySessionId, deleteSessionTokenBySessionId
} = require('./api-key-manager');

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
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 1000 requests per windowMs
    message: { error: 'تم تجاوز الحد المسموح من الطلبات، يرجى المحاولة لاحقاً' },
    standardHeaders: true,
    legacyHeaders: false,
});

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // limit each IP to 500 API requests per windowMs
    message: { error: 'تم تجاوز الحد المسموح من طلبات API، يرجى المحاولة لاحقاً' },
    standardHeaders: true,
    legacyHeaders: false,
});

const messageLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // limit each IP to 60 messages per minute
    message: { error: 'تم تجاوز الحد المسموح من الرسائل في الدقيقة، يرجى المحاولة لاحقاً' },
    standardHeaders: true,
    legacyHeaders: false,
});

const dailyMessageLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    max: 10000, // limit each IP to 10000 messages per day
    message: { error: 'تم تجاوز الحد المسموح من الرسائل اليومية، يرجى المحاولة غداً' },
    standardHeaders: true,
    legacyHeaders: false,
});


// Global CORS
app.use(cors(corsOptions));

// Apply rate limiting
app.use(generalLimiter);
app.use('/api', apiLimiter);
app.options('*', cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Store active WhatsApp clients
const activeClients = new Map();

// تعيين مرجع activeClients في api-routes
setActiveClientsRef(activeClients);

// إعادة تشغيل الجلسات المتصلة عند بدء الخادم
async function restartConnectedSessions() {
    try {
        const connectedSessionsStmt = db.prepare('SELECT * FROM sessions WHERE status = ?');
        const connectedSessions = connectedSessionsStmt.all('connected');
        
        console.log(`إعادة تشغيل ${connectedSessions.length} جلسة متصلة...`);
        
        for (const session of connectedSessions) {
            try {
                const { Client, LocalAuth } = require('whatsapp-web.js');
                const path = require('path');
                
                const client = new Client({
                    authStrategy: new LocalAuth({
                        clientId: `session_${session.id}`,
                        dataPath: path.join(__dirname, 'sessions')
                    }),
                    puppeteer: {
                        headless: true,
                        args: ['--no-sandbox', '--disable-setuid-sandbox']
                    }
                });
                
                activeClients.set(String(session.id), client);
                
                client.on('authenticated', () => {
                    console.log(`الجلسة ${session.id} (${session.session_name}) تم التحقق من الهوية!`);
                    
                    // تحديث الحالة في قاعدة البيانات
                    const statusStmt = db.prepare('UPDATE sessions SET status = ? WHERE id = ?');
                    statusStmt.run('authenticated', session.id);
                    
                    // إرسال إشعار للواجهة
                    io.emit('session_authenticated', { 
                        sessionId: session.id, 
                        sessionName: session.session_name 
                    });
                });
                
                client.on('auth_failure', (msg) => {
                    console.log(`فشل التحقق من الهوية للجلسة ${session.id} (${session.session_name}): ${msg}`);
                    
                    // تحديث الحالة في قاعدة البيانات
                    const statusStmt = db.prepare('UPDATE sessions SET status = ? WHERE id = ?');
                    statusStmt.run('auth_failure', session.id);
                    
                    // إرسال إشعار للواجهة
                    io.emit('session_auth_failure', { 
                        sessionId: session.id, 
                        sessionName: session.session_name,
                        error: msg 
                    });
                });
                
                client.on('qr', async (qr) => {
                    console.log(`QR Code للجلسة ${session.id} (${session.session_name})`);
                    
                    try {
                        const qrCodeDataURL = await QRCode.toDataURL(qr);
                        
                        // تحديث QR Code في قاعدة البيانات
                        const qrStmt = db.prepare('UPDATE sessions SET qr_code = ? WHERE id = ?');
                        qrStmt.run(qrCodeDataURL, session.id);
                        
                        // إرسال QR Code للواجهة
                        io.emit('session_qr', { 
                            sessionId: session.id, 
                            sessionName: session.session_name,
                            qrCode: qrCodeDataURL 
                        });
                    } catch (error) {
                        console.error('خطأ في توليد QR Code:', error);
                    }
                });
                
                client.on('loading_screen', (percent, message) => {
                    console.log(`تحميل الجلسة ${session.id} (${session.session_name}): ${percent}% - ${message}`);
                    
                    // إرسال تحديث التحميل للواجهة
                    io.emit('session_loading', { 
                        sessionId: session.id, 
                        sessionName: session.session_name,
                        percent: percent,
                        message: message 
                    });
                });
                
                client.on('ready', async () => {
                    console.log(`الجلسة ${session.id} (${session.session_name}) جاهزة!`);
                    
                    // تحديث الحالة في قاعدة البيانات
                    const statusStmt = db.prepare('UPDATE sessions SET status = ? WHERE id = ?');
                    statusStmt.run('connected', session.id);
                    
                    // إرسال إشعار للواجهة
                    io.emit('session_connected', { 
                        sessionId: session.id, 
                        sessionName: session.session_name 
                    });
                });
                
                client.on('disconnected', (reason) => {
                    console.log(`الجلسة ${session.id} (${session.session_name}) انفصلت - السبب: ${reason}`);
                    activeClients.delete(String(session.id));
                    
                    // تحديث الحالة في قاعدة البيانات
                    const statusStmt = db.prepare('UPDATE sessions SET status = ? WHERE id = ?');
                    statusStmt.run('disconnected', session.id);
                    
                    // إرسال إشعار للواجهة
                    io.emit('session_disconnected', { 
                        sessionId: session.id, 
                        sessionName: session.session_name,
                        reason: reason 
                    });
                });
                
                client.initialize();
                
                // انتظار قليل بين كل جلسة
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (error) {
                console.error(`خطأ في إعادة تشغيل الجلسة ${session.id}:`, error);
            }
        }
    } catch (error) {
        console.error('خطأ في إعادة تشغيل الجلسات المتصلة:', error);
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
        res.json({ success: true, user: {
            id: req.session.userId,
            username: row.username,
            isAdmin: !!row.is_admin,
            isActive: !!row.is_active,
            maxSessions: row.max_sessions,
            sessionTtlDays: row.session_ttl_days
        }});
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
            WHERE s.user_id = ? AND m.timestamp >= datetime('now','-1 day')
        `).get(userId).c;
        const api24h = db.prepare("SELECT COUNT(1) as c FROM api_logs WHERE user_id = ? AND created_at >= datetime('now','-1 day')").get(userId).c;
        res.json({ success: true, stats: { totalSessions, connectedSessions, messages24h, api24h }});
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
            messages24h: db.prepare("SELECT COUNT(*) as count FROM messages WHERE timestamp >= datetime('now','-1 day')").get().count,
            apiCalls: db.prepare('SELECT COUNT(*) as count FROM api_logs').get().count,
            api24h: db.prepare("SELECT COUNT(*) as count FROM api_logs WHERE created_at >= datetime('now','-1 day')").get().count
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
app.post('/api/admin/users/:userId/toggle', requireAuth, requireAdmin, (req, res) => {
    try {
        const { userId } = req.params;
        const row = db.prepare('SELECT is_active FROM users WHERE id = ?').get(userId);
        if (!row) return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
        const newVal = row.is_active === 1 ? 0 : 1;
        db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(newVal, userId);
        res.json({ success: true, isActive: newVal === 1 });
    } catch (error) {
        console.error('Error toggling user (admin):', error);
        res.status(500).json({ success: false, error: 'فشل في تحديث الحالة' });
    }
});

// حذف مستخدم
app.delete('/api/admin/users/:userId', requireAuth, requireAdmin, (req, res) => {
    try {
        const { userId } = req.params;
        const del = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
        // سيتم حذف الجلسات المرتبطة بسبب قيود العلاقات (ON DELETE CASCADE)
        if (del.changes === 0) return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });
        // إلغاء تفعيل مفاتيح/توكنات API إن وجدت
        try { db.prepare('UPDATE api_keys SET is_active = 0 WHERE user_id = ?').run(userId); } catch (_) {}
        try { db.prepare('UPDATE session_tokens SET is_active = 0 WHERE user_id = ?').run(userId); } catch (_) {}
        res.json({ success: true });
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

app.post('/api/admin/users/:userId/limits', requireAuth, requireAdmin, (req, res) => {
    const { userId } = req.params;
    const { maxSessions, sessionTtlHours } = req.body;
    db.prepare('UPDATE users SET max_sessions = ?, session_ttl_hours = ? WHERE id = ?').run(
        maxSessions != null ? Number(maxSessions) : null,
        sessionTtlHours != null ? Number(sessionTtlHours) : null,
        userId
    );
    res.json({ success: true });
});

app.post('/api/admin/users/:userId/logout', requireAuth, requireAdmin, async (req, res) => {
    const { userId } = req.params;
    // Destroy all active sessions for this user
    const sessions = db.prepare('SELECT id FROM sessions WHERE user_id = ?').all(userId);
    for (const s of sessions) {
        const key = String(s.id);
        if (activeClients.has(key)) {
            try { await activeClients.get(key).destroy(); } catch (_) {}
            activeClients.delete(key);
        }
    }
    // Optionally, invalidate API keys/session tokens
    db.prepare('UPDATE api_keys SET is_active = FALSE WHERE user_id = ?').run(userId);
    db.prepare('UPDATE session_tokens SET is_active = FALSE WHERE user_id = ?').run(userId);
    res.json({ success: true });
});

// إعدادات الأدمن (الهاتف والباقات)
app.get('/api/admin/settings', requireAuth, requireAdmin, (req, res) => {
    try {
        const row = db.prepare('SELECT admin_phone, packages_json, updated_at FROM settings WHERE id = 1').get();
        res.json({ success: true, settings: { adminPhone: row?.admin_phone || '', packagesJson: row?.packages_json || '[]', updatedAt: row?.updated_at } });
    } catch (e) { res.status(500).json({ error: 'Failed to load settings' }); }
});

app.post('/api/admin/settings', requireAuth, requireAdmin, (req, res) => {
    try {
        const { adminPhone, packagesJson } = req.body;
        // Validate JSON
        let parsed = [];
        if (packagesJson) { parsed = JSON.parse(packagesJson); }
        db.prepare('INSERT INTO settings (id, admin_phone, packages_json, updated_at) VALUES (1, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET admin_phone=excluded.admin_phone, packages_json=excluded.packages_json, updated_at=CURRENT_TIMESTAMP')
          .run(adminPhone || '', JSON.stringify(parsed));
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: 'Invalid packages JSON' }); }
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
        const tokenStmt = db.prepare('SELECT * FROM email_verification_tokens WHERE user_id = ? AND token = ? AND expires_at > datetime("now")');
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

        // تحقق من الحد الأقصى للجلسات
        const { max_sessions } = db.prepare('SELECT max_sessions FROM users WHERE id = ?').get(userId);
        const { c } = db.prepare('SELECT COUNT(1) as c FROM sessions WHERE user_id = ?').get(userId);
        if (max_sessions != null && c >= max_sessions) {
            return res.status(403).json({ error: 'تم بلوغ الحد الأقصى للجلسات' });
        }
        
        const stmt = db.prepare('INSERT INTO sessions (session_name, user_id) VALUES (?, ?)');
        const result = stmt.run(sessionName, userId);

        // إعداد تاريخ الانتهاء للجلسة لو كان TTL محدد
        const user = db.prepare('SELECT session_ttl_days FROM users WHERE id = ?').get(userId);
        const days = user && user.session_ttl_days != null ? Number(user.session_ttl_days) : 5;
        if (days > 0) {
            db.prepare('UPDATE sessions SET expires_at = datetime("now", ? ) WHERE id = ?')
              .run(`+${days} days`, result.lastInsertRowid);
        }
        
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
        const stmt = db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC');
        const sessions = stmt.all(userId);
        
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
        
        // Stop the client if it's running
        if (activeClients.has(String(sessionId))) {
            const client = activeClients.get(String(sessionId));
            await client.destroy();
            activeClients.delete(String(sessionId));
        }
        
        const stmt = db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?');
        const result = stmt.run(sessionId, userId);
        
        if (result.changes > 0) {
            res.json({ success: true });
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
            const { sessionId } = data;
            
            // Check if session exists and belongs to user
            const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
            const session = stmt.get(sessionId);
            
            if (!session) {
                socket.emit('session_error', { error: 'Session not found' });
                return;
            }
            
            // منع بدء جلسة منتهية الصلاحية
            if (session.expires_at) {
                const row = db.prepare('SELECT datetime(?) <= datetime("now") as expired').get(session.expires_at);
                if (row.expired) {
                    socket.emit('session_error', { error: 'انتهت صلاحية الجلسة. يرجى التجديد.' });
                    return;
                }
            }

            // Update status to waiting for QR
            const updateStmt = db.prepare('UPDATE sessions SET status = ? WHERE id = ?');
            updateStmt.run('waiting_for_qr', sessionId);
            
            // Create WhatsApp client
            const client = new Client({
                authStrategy: new LocalAuth({
                    clientId: `session_${sessionId}`,
                    dataPath: path.join(__dirname, 'sessions')
                }),
                puppeteer: {
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                }
            });
            
            activeClients.set(String(sessionId), client);
            
            client.on('qr', async (qr) => {
                try {
                    const qrCode = await QRCode.toDataURL(qr);
                    socket.emit('qr_code', { sessionId, qrCode });
                    
                    // Update database with QR code
                    const qrStmt = db.prepare('UPDATE sessions SET qr_code = ? WHERE id = ?');
                    qrStmt.run(qrCode, sessionId);
                } catch (error) {
                    console.error('QR generation error:', error);
                }
            });
            
            client.on('authenticated', () => {
                console.log(`Session ${sessionId} authenticated!`);
                
                // Update status to authenticated
                const statusStmt = db.prepare('UPDATE sessions SET status = ? WHERE id = ?');
                statusStmt.run('authenticated', sessionId);
                
                socket.emit('session_authenticated', { sessionId });
            });
            
            client.on('auth_failure', (msg) => {
                console.log(`Session ${sessionId} auth failure: ${msg}`);
                
                // Update status to auth_failure
                const statusStmt = db.prepare('UPDATE sessions SET status = ? WHERE id = ?');
                statusStmt.run('auth_failure', sessionId);
                
                socket.emit('session_auth_failure', { sessionId, error: msg });
            });
            
            client.on('loading_screen', (percent, message) => {
                console.log(`Session ${sessionId} loading: ${percent}% - ${message}`);
                
                // Update status to loading
                const statusStmt = db.prepare('UPDATE sessions SET status = ? WHERE id = ?');
                statusStmt.run('loading', sessionId);
                
                socket.emit('session_loading', { sessionId, percent, message });
            });
            
            client.on('ready', async () => {
                console.log(`Session ${sessionId} is ready!`);
                
                // Update status to connected
                const statusStmt = db.prepare('UPDATE sessions SET status = ? WHERE id = ?');
                statusStmt.run('connected', sessionId);
                
                socket.emit('session_ready', { sessionId });
                
                // Get contacts and chats
                const chats = await client.getChats();
                const contacts = await client.getContacts();
                
                const sessionData = { 
                    sessionId, 
                    chats: chats.map(chat => ({
                        id: chat.id._serialized,
                        name: chat.name || chat.id.user,
                        type: chat.isGroup ? 'group' : 'private'
                    })),
                    contacts: contacts.map(contact => ({
                        id: contact.id._serialized,
                        name: contact.pushname || contact.id.user,
                        number: contact.id.user
                    }))
                };
                
                // Save session data to database
                const sessionDataStmt = db.prepare('UPDATE sessions SET session_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
                sessionDataStmt.run(JSON.stringify(sessionData), sessionId);
                
                socket.emit('session_data', sessionData);
            });
            
            // Add a fallback: if authenticated event is fired, also emit session_ready
            client.on('authenticated', async () => {
                console.log(`Session ${sessionId} authenticated - emitting session_ready as fallback`);
                // Update status to connected
                const statusStmt = db.prepare('UPDATE sessions SET status = ? WHERE id = ?');
                statusStmt.run('connected', sessionId);
                socket.emit('session_ready', { sessionId });
                
                // Also try to get session data as fallback
                try {
                    // انتظار حتى يكون العميل جاهزاً تماماً
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // التحقق من أن العميل جاهز
                    if (!client.info) {
                        console.log(`Session ${sessionId} not ready yet, skipping data fetch`);
                        return;
                    }
                    
                    const chats = await client.getChats();
                    const contacts = await client.getContacts();
                    
                    const sessionData = { 
                        sessionId, 
                        chats: chats.map(chat => ({
                            id: chat.id._serialized,
                            name: chat.name || chat.id.user,
                            type: chat.isGroup ? 'group' : 'private'
                        })),
                        contacts: contacts.map(contact => ({
                            id: contact.id._serialized,
                            name: contact.pushname || contact.id.user,
                            number: contact.id.user
                        }))
                    };
                    
                    // Save session data to database
                    const sessionDataStmt = db.prepare('UPDATE sessions SET session_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
                    sessionDataStmt.run(JSON.stringify(sessionData), sessionId);
                    
                    socket.emit('session_data', sessionData);
                } catch (error) {
                    console.error('Error getting session data in authenticated fallback:', error);
                }
            });
            
            client.on('disconnected', (reason) => {
                console.log(`Session ${sessionId} disconnected - Reason: ${reason}`);
                
                // Update status to disconnected
                const statusStmt = db.prepare('UPDATE sessions SET status = ? WHERE id = ?');
                statusStmt.run('disconnected', sessionId);
                
                socket.emit('session_disconnected', { sessionId, reason });
                activeClients.delete(String(sessionId));
            });
            
            // الاستماع للرسائل الواردة وتخزينها
            client.on('message', async (msg) => {
                try {
                    const insert = db.prepare(`
                        INSERT OR IGNORE INTO messages (
                            session_id, chat_id, message_id, from_me, type, body, has_media, media_mime_type, media_base64, sender, receiver, timestamp
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                    `);
                    let mediaBase64 = null;
                    let mediaMime = null;
                    let hasMedia = false;
                    if (msg.hasMedia) {
                        try {
                            const media = await msg.downloadMedia();
                            if (media) {
                                mediaBase64 = media.data;
                                mediaMime = media.mimetype;
                                hasMedia = true;
                            }
                        } catch (_) {}
                    }
                    insert.run(
                        String(sessionId),
                        msg.from || (msg.to || ''),
                        msg.id?._serialized || msg.id || `${Date.now()}-${Math.random()}`,
                        !!msg.fromMe,
                        msg.type || 'chat',
                        msg.body || '',
                        hasMedia,
                        mediaMime,
                        mediaBase64,
                        msg.from || '',
                        msg.to || ''
                    );
                } catch (e) {
                    console.error('Failed to persist incoming message:', e.message);
                }
            });

            client.initialize();
            
        } catch (error) {
            console.error('Session start error:', error);
            socket.emit('session_error', { error: 'Failed to start session' });
        }
    });
    
    socket.on('stop_session', async (data) => {
        try {
            const { sessionId } = data;
            
            if (activeClients.has(String(sessionId))) {
                const client = activeClients.get(String(sessionId));
                await client.destroy();
                activeClients.delete(String(sessionId));
                
                // Update status to disconnected
                const statusStmt = db.prepare('UPDATE sessions SET status = ? WHERE id = ?');
                statusStmt.run('disconnected', sessionId);
                
                socket.emit('session_stopped', { sessionId });
            }
        } catch (error) {
            console.error('Session stop error:', error);
        }
    });
    
    socket.on('get_session_data', async (data) => {
        try {
            const { sessionId } = data;
            
            // Check if session exists and is connected
            const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
            const session = stmt.get(sessionId);
            
            if (!session) {
                socket.emit('session_error', { error: 'Session not found' });
                return;
            }
            
            // If session is not active but should be connected, restart it
            if (!activeClients.has(String(sessionId)) && session.status === 'connected') {
                console.log(`Restarting inactive session ${sessionId}`);
                
                // Create WhatsApp client
                const client = new Client({
                    authStrategy: new LocalAuth({
                        clientId: `session_${sessionId}`,
                        dataPath: path.join(__dirname, 'sessions')
                    }),
                    puppeteer: {
                        headless: true,
                        args: ['--no-sandbox', '--disable-setuid-sandbox']
                    }
                });
                
                activeClients.set(String(sessionId), client);
                
                // Set up event handlers
                client.on('ready', async () => {
                    console.log(`Session ${sessionId} restarted successfully!`);
                    
                    // Get contacts and chats
                    const chats = await client.getChats();
                    const contacts = await client.getContacts();
                    
                    const sessionData = { 
                        sessionId, 
                        chats: chats.map(chat => ({
                            id: chat.id._serialized,
                            name: chat.name || chat.id.user,
                            type: chat.isGroup ? 'group' : 'private'
                        })),
                        contacts: contacts.map(contact => ({
                            id: contact.id._serialized,
                            name: contact.pushname || contact.id.user,
                            number: contact.id.user
                        }))
                    };
                    
                    // Update database with session data
                    const sessionDataStmt = db.prepare('UPDATE sessions SET session_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
                    sessionDataStmt.run(JSON.stringify(sessionData), sessionId);
                    
                    socket.emit('session_data', sessionData);
                });
                
                client.on('disconnected', () => {
                    console.log(`Restarted session ${sessionId} disconnected`);
                    activeClients.delete(sessionId);
                });
                
                client.initialize();
                return;
            }
            
            // If session is active, get data normally
            if (activeClients.has(String(sessionId))) {
                const client = activeClients.get(String(sessionId));
                
                // التحقق من أن العميل جاهز
                if (!client.info) {
                    return res.status(400).json({
                        success: false,
                        error: 'الجلسة غير جاهزة بعد، يرجى المحاولة لاحقاً',
                        code: 'SESSION_NOT_READY'
                    });
                }
                
                // Get contacts and chats
                const chats = await client.getChats();
                const contacts = await client.getContacts();
                
                const sessionData = { 
                    sessionId, 
                    chats: chats.map(chat => ({
                        id: chat.id._serialized,
                        name: chat.name || chat.id.user,
                        type: chat.isGroup ? 'group' : 'private'
                    })),
                    contacts: contacts.map(contact => ({
                        id: contact.id._serialized,
                        name: contact.pushname || contact.id.user,
                        number: contact.id.user
                    }))
                };
                
                // Update database with session data
                const sessionDataStmt = db.prepare('UPDATE sessions SET session_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
                sessionDataStmt.run(JSON.stringify(sessionData), sessionId);
                
                socket.emit('session_data', sessionData);
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
            
            // Check if session exists and is connected
            const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
            const session = stmt.get(sessionId);
            
            if (!session) {
                socket.emit('message_error', { error: 'Session not found' });
                return;
            }
            
            // If session is not active but should be connected, restart it
            if (!activeClients.has(String(sessionId)) && session.status === 'connected') {
                console.log(`Restarting inactive session ${sessionId} for message sending`);
                
                // Create WhatsApp client
                const client = new Client({
                    authStrategy: new LocalAuth({
                        clientId: `session_${sessionId}`,
                        dataPath: path.join(__dirname, 'sessions')
                    }),
                    puppeteer: {
                        headless: true,
                        args: ['--no-sandbox', '--disable-setuid-sandbox']
                    }
                });
                
                activeClients.set(String(sessionId), client);
                
                // Wait for client to be ready
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Timeout waiting for client')), 30000);
                    
                    client.on('ready', () => {
                        clearTimeout(timeout);
                        resolve();
                    });
                    
                    client.on('disconnected', () => {
                        clearTimeout(timeout);
                        reject(new Error('Client disconnected'));
                    });
                    
                    client.initialize();
                });
            }
            
            if (!activeClients.has(String(sessionId))) {
                socket.emit('message_error', { error: 'Failed to restart session' });
                return;
            }
            
            const client = activeClients.get(String(sessionId));
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
            console.error('Send message error:', error);
            socket.emit('message_error', { error: 'Failed to send message: ' + error.message });
        }
    });
    
    socket.on('send_bulk_message', async (data) => {
        try {
            const { sessionId, contacts, message } = data;
            
            // Check if session exists and is connected
            const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
            const session = stmt.get(sessionId);
            
            if (!session) {
                socket.emit('message_error', { error: 'Session not found' });
                return;
            }
            
            const client = activeClients.get(String(sessionId));
            if (!client) {
                socket.emit('message_error', { error: 'Session not active' });
                return;
            }
            
            // Send message to all selected contacts
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
            console.error('Send bulk message error:', error);
            socket.emit('message_error', { error: 'Failed to send bulk message: ' + error.message });
        }
    });
    
    socket.on('send_file', async (data) => {
        try {
            const { sessionId, contacts, fileData, fileName, fileType, caption } = data;
            
            // Check if session exists and is connected
            const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
            const session = stmt.get(sessionId);
            
            if (!session) {
                socket.emit('file_error', { error: 'Session not found' });
                return;
            }
            
            // If session is not active but should be connected, restart it
            if (!activeClients.has(String(sessionId)) && session.status === 'connected') {
                console.log(`Restarting inactive session ${sessionId} for file sending`);
                
                // Create WhatsApp client
                const client = new Client({
                    authStrategy: new LocalAuth({
                        clientId: `session_${sessionId}`,
                        dataPath: path.join(__dirname, 'sessions')
                    }),
                    puppeteer: {
                        headless: true,
                        args: ['--no-sandbox', '--disable-setuid-sandbox']
                    }
                });
                
                activeClients.set(String(sessionId), client);
                
                // Wait for client to be ready
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Timeout waiting for client')), 30000);
                    
                    client.on('ready', () => {
                        clearTimeout(timeout);
                        resolve();
                    });
                    
                    client.on('disconnected', () => {
                        clearTimeout(timeout);
                        reject(new Error('Client disconnected'));
                    });
                    
                    client.initialize();
                });
            }
            
            if (!activeClients.has(String(sessionId))) {
                socket.emit('file_error', { error: 'Failed to restart session' });
                return;
            }
            
            const client = activeClients.get(String(sessionId));
            const results = [];
            
            // Convert base64 to buffer
            const fileBuffer = Buffer.from(fileData, 'base64');
            
            for (const contactId of contacts) {
                try {
                    const chat = await client.getChatById(contactId);
                    
                    // Create media message
                    const media = new MessageMedia(fileType, fileData, fileName);
                    await chat.sendMessage(media, { caption: caption || '' });
                    
                    results.push({ contactId, success: true });
                } catch (error) {
                    results.push({ contactId, success: false, error: error.message });
                }
            }
            
            socket.emit('file_sent', { results });
            
        } catch (error) {
            console.error('Send file error:', error);
            socket.emit('file_error', { error: 'Failed to send file: ' + error.message });
        }
    });
    
    socket.on('send_location', async (data) => {
        try {
            const { sessionId, contacts, latitude, longitude, name } = data;
            
            // Check if session exists and is connected
            const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
            const session = stmt.get(sessionId);
            
            if (!session) {
                socket.emit('message_error', { error: 'Session not found' });
                return;
            }
            
            const client = activeClients.get(String(sessionId));
            if (!client) {
                socket.emit('message_error', { error: 'Session not active' });
                return;
            }
            
            // Send location to all selected contacts
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
            console.error('Send location error:', error);
            socket.emit('message_error', { error: 'Failed to send location: ' + error.message });
        }
    });
    
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
    console.log(`🚀 WhatsApp Dashboard Server running on port ${PORT}`);
    console.log(`📱 Open http://localhost:${PORT} in your browser`);
    
    // إعادة تشغيل الجلسات المتصلة
    await restartConnectedSessions();
});
