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
const fs = require('fs').promises;
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

// Store reconnection timers for sessions
const reconnectionTimers = new Map();

// تعيين مرجع activeClients في api-routes
setActiveClientsRef(activeClients);

// استيراد دالة إغلاق الجلسة من ملف مشترك
const { destroyClientCompletely: destroyClientCompletelyBase } = require('./session-manager');

// دالة مساعدة لإغلاق الجلسة بشكل كامل مع إغلاق عملية Chrome
async function destroyClientCompletely(sessionId, client) {
    // إلغاء أي محاولات إعادة اتصال
    if (reconnectionTimers.has(String(sessionId))) {
        clearTimeout(reconnectionTimers.get(String(sessionId)));
        reconnectionTimers.delete(String(sessionId));
    }

    // استدعاء الدالة الأساسية
    await destroyClientCompletelyBase(sessionId, client, reconnectionTimers);

    // حذف العميل من الخريطة
    activeClients.delete(String(sessionId));
}

// دالة لإعادة الاتصال التلقائي عند انقطاع الجلسة
async function attemptReconnection(sessionId, maxRetries = 3, delay = 5000) {
    // إلغاء أي محاولة إعادة اتصال سابقة
    if (reconnectionTimers.has(String(sessionId))) {
        clearTimeout(reconnectionTimers.get(String(sessionId)));
    }

                const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
                if (!session) {
        console.log(`[${sessionId}] الجلسة غير موجودة، إلغاء إعادة الاتصال`);
        return;
    }

    // عدم إعادة الاتصال إذا كانت الجلسة متوقفة أو منتهية
    if (session.status === 'disconnected' || session.status === 'expired' || session.is_paused === 1) {
        console.log(`[${sessionId}] الجلسة متوقفة أو منتهية، إلغاء إعادة الاتصال`);
        return;
    }

    // التحقق من انتهاء الصلاحية
        if (session.expires_at) {
        const row = db.prepare('SELECT datetime(?) <= CURRENT_TIMESTAMP as expired').get(session.expires_at);
        if (row.expired) {
            console.log(`[${sessionId}] الجلسة منتهية الصلاحية، إلغاء إعادة الاتصال`);
            return;
        }
    }

    let retryCount = 0;
    
    const reconnect = async () => {
        if (activeClients.has(String(sessionId))) {
            console.log(`[${sessionId}] الجلسة نشطة بالفعل، إلغاء إعادة الاتصال`);
            reconnectionTimers.delete(String(sessionId));
            return;
        }

        retryCount++;
        console.log(`[${sessionId}] محاولة إعادة الاتصال (${retryCount}/${maxRetries})...`);

        try {
        const { Client, LocalAuth } = require('whatsapp-web.js');
        const path = require('path');
        
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
            
            // إعداد معالجات الأحداث
            setupClientEventHandlers(sessionId, client);
            
            await client.initialize();
            
            console.log(`[${sessionId}] تم إعادة الاتصال بنجاح`);
            reconnectionTimers.delete(String(sessionId));
        } catch (error) {
            console.error(`[${sessionId}] فشل إعادة الاتصال:`, error.message);
            
            if (retryCount < maxRetries) {
                const timer = setTimeout(reconnect, delay);
                reconnectionTimers.set(String(sessionId), timer);
            } else {
                console.log(`[${sessionId}] تم استنفاد محاولات إعادة الاتصال`);
                reconnectionTimers.delete(String(sessionId));
            
            // تحديث الحالة في قاعدة البيانات
            const statusStmt = db.prepare('UPDATE sessions SET status = ? WHERE id = ?');
                statusStmt.run('disconnected', sessionId);
            }
        }
    };

    const timer = setTimeout(reconnect, delay);
    reconnectionTimers.set(String(sessionId), timer);
}

// دالة لإعداد معالجات الأحداث للعميل
function setupClientEventHandlers(sessionId, client) {
    client.on('authenticated', () => {
        console.log(`[${sessionId}] تم التحقق من الهوية`);
        const statusStmt = db.prepare('UPDATE sessions SET status = ? WHERE id = ?');
        statusStmt.run('authenticated', sessionId);
        io.emit('session_authenticated', { sessionId });
    });

    client.on('ready', async () => {
        console.log(`[${sessionId}] الجلسة جاهزة`);
        const statusStmt = db.prepare('UPDATE sessions SET status = ? WHERE id = ?');
        statusStmt.run('connected', sessionId);
        io.emit('session_connected', { sessionId });
        
        // إلغاء أي محاولات إعادة اتصال
        if (reconnectionTimers.has(String(sessionId))) {
            clearTimeout(reconnectionTimers.get(String(sessionId)));
            reconnectionTimers.delete(String(sessionId));
        }
        });
        
        client.on('disconnected', async (reason) => {
        console.log(`[${sessionId}] انقطاع الاتصال - السبب: ${reason}`);
            
        // إغلاق العميل بشكل كامل
        await destroyClientCompletely(sessionId, client);
            
            // تحديث الحالة في قاعدة البيانات
            const statusStmt = db.prepare('UPDATE sessions SET status = ? WHERE id = ?');
            statusStmt.run('disconnected', sessionId);
            
        io.emit('session_disconnected', { sessionId, reason });
        
        // محاولة إعادة الاتصال تلقائياً (فقط إذا لم يكن السبب LOGGED_OUT)
        if (reason !== 'LOGGED_OUT' && reason !== 'NAVIGATION') {
            console.log(`[${sessionId}] محاولة إعادة الاتصال تلقائياً...`);
            await attemptReconnection(sessionId, 3, 5000);
        } else {
            console.log(`[${sessionId}] لا يمكن إعادة الاتصال - السبب: ${reason}`);
        }
        });
        
        client.on('auth_failure', (msg) => {
        console.log(`[${sessionId}] فشل التحقق من الهوية: ${msg}`);
            const statusStmt = db.prepare('UPDATE sessions SET status = ? WHERE id = ?');
            statusStmt.run('auth_failure', sessionId);
        io.emit('session_auth_failure', { sessionId, error: msg });
    });

    client.on('qr', async (qr) => {
        try {
            const qrCodeDataURL = await QRCode.toDataURL(qr);
            const qrTimestamp = new Date().toISOString();
            
            console.log(`[${sessionId}] QR Code جديد`);
            
            // تحديث QR Code في قاعدة البيانات
            const qrStmt = db.prepare('UPDATE sessions SET qr_code = ?, qr_timestamp = ? WHERE id = ?');
            qrStmt.run(qrCodeDataURL, qrTimestamp, sessionId);
            
            // إرسال QR Code للواجهة
            io.emit('session_qr', { 
                sessionId: sessionId,
                qrCode: qrCodeDataURL,
                timestamp: qrTimestamp
            });
    } catch (error) {
            console.error(`[${sessionId}] خطأ في توليد QR Code:`, error);
        }
    });

    client.on('loading_screen', (percent, message) => {
        console.log(`[${sessionId}] تحميل: ${percent}% - ${message}`);
        
        // تحديث الحالة
        const statusStmt = db.prepare('UPDATE sessions SET status = ? WHERE id = ?');
        statusStmt.run('loading', sessionId);
        
        // إرسال تحديث التحميل للواجهة
        io.emit('session_loading', { 
            sessionId: sessionId,
            percent: percent,
            message: message 
        });
    });
}

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
                
                // استخدام دالة إعداد معالجات الأحداث
                setupClientEventHandlers(session.id, client);
                
                // إضافة معالجات إضافية للجلسات المعاد تشغيلها
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
            WHERE s.user_id = ? AND m.timestamp >= datetime(CURRENT_TIMESTAMP,'-1 day')
        `).get(userId).c;
        const api24h = db.prepare("SELECT COUNT(1) as c FROM api_logs WHERE user_id = ? AND created_at >= datetime(CURRENT_TIMESTAMP,'-1 day')").get(userId).c;
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

// تمديد الجلسة (للمدير)
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
        db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('disconnected', sessionId);
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
                    await destroyClientCompletely(sessionId, client, activeClients, false);
                }
            }
            // تحديث حالة الجلسات إلى disconnected
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
                await destroyClientCompletely(sessionId, client, activeClients, false);
            }
        }
        
        // إلغاء تفعيل مفاتيح/توكنات API
        try { db.prepare('UPDATE api_keys SET is_active = 0 WHERE user_id = ?').run(userId); } catch (_) {}
        try { db.prepare('UPDATE session_tokens SET is_active = 0 WHERE user_id = ?').run(userId); } catch (_) {}
        
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
            const { sessionId, forceNewQR = false } = data;
            
            // Check if session exists and belongs to user
            const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
            const session = stmt.get(sessionId);
            
            if (!session) {
                socket.emit('session_error', { error: 'Session not found' });
                return;
            }
            
            // منع بدء جلسة منتهية الصلاحية
            if (session.expires_at) {
                const row = db.prepare('SELECT datetime(?) <= CURRENT_TIMESTAMP as expired').get(session.expires_at);
                if (row.expired) {
                    socket.emit('session_error', { error: 'انتهت صلاحية الجلسة. يرجى التجديد.' });
                    return;
                }
            }

            // إذا كانت الجلسة نشطة، قم بإيقافها أولاً
            if (activeClients.has(String(sessionId))) {
                console.log(`Stopping existing session ${sessionId} before restart...`);
                const existingClient = activeClients.get(String(sessionId));
                await destroyClientCompletely(sessionId, existingClient);
            }

            // إذا طُلب QR جديد أو كانت الجلسة غير متصلة، احذف بيانات الجلسة القديمة
            if (forceNewQR || session.status === 'disconnected' || session.status === 'auth_failure') {
                try {
                    const sessionPath = path.join(__dirname, 'sessions', `session_${sessionId}`);
                    const sessionExists = await fs.access(sessionPath).then(() => true).catch(() => false);
                    
                    if (sessionExists) {
                        console.log(`Deleting old session data for ${sessionId} to force new QR code...`);
                        await fs.rm(sessionPath, { recursive: true, force: true });
                    }
                } catch (error) {
                    console.error(`Error deleting session data: ${error.message}`);
                    // لا نوقف العملية إذا فشل الحذف
                }
            }

            // مسح QR code القديم من قاعدة البيانات
            const clearQRStmt = db.prepare('UPDATE sessions SET qr_code = NULL WHERE id = ?');
            clearQRStmt.run(sessionId);

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
            
            // استخدام دالة إعداد معالجات الأحداث الأساسية
            setupClientEventHandlers(sessionId, client);
            
            // إضافة معالجات إضافية للـ socket
            client.on('qr', async (qr) => {
                try {
                    const qrCode = await QRCode.toDataURL(qr);
                    const qrTimestamp = new Date().toISOString();
                    
                    console.log(`New QR code generated for session ${sessionId} at ${qrTimestamp}`);
                    
                    socket.emit('qr_code', { 
                        sessionId, 
                        qrCode,
                        timestamp: qrTimestamp 
                    });
                } catch (error) {
                    console.error('QR generation error:', error);
                }
            });
            
            client.on('ready', async () => {
                socket.emit('session_ready', { sessionId });
                
                // Get contacts and chats
                try {
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
                    console.error(`Error getting session data for ${sessionId}:`, error);
                }
            });
            
            // Add a fallback: if authenticated event is fired, also emit session_ready
            client.on('authenticated', async () => {
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
            
            client.on('disconnected', async (reason) => {
                socket.emit('session_disconnected', { sessionId, reason });
            });
            
            // الاستماع للرسائل الواردة: تعطيل التخزين نهائياً وعدم تنزيل الميديا عند تفعيل DISABLE_MESSAGE_STORAGE
            if (DISABLE_MESSAGE_STORAGE) {
                client.on('message', (msg) => {
                    // تم التعطيل بناءً على الإعداد؛ عدم تخزين الرسائل أو تنزيل الميديا
                });
            } else {
                client.on('message', async (msg) => {
                    try {
                        const insert = db.prepare(`
                            INSERT OR IGNORE INTO messages (
                                session_id, chat_id, message_id, from_me, type, body, has_media, media_mime_type, media_base64, sender, receiver, timestamp
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
                        const chatId = (typeof msg.from === 'object' && msg.from !== null) ? msg.from._serialized : (msg.from || '');
                        const messageId = (typeof msg.id === 'object' && msg.id !== null) ? msg.id._serialized : (msg.id || `${Date.now()}-${Math.random()}`);
                        const sender = (typeof msg.from === 'object' && msg.from !== null) ? msg.from._serialized : (msg.from || '');
                        const receiver = (typeof msg.to === 'object' && msg.to !== null) ? msg.to._serialized : (msg.to || '');
                        const safeValues = [
                            String(sessionId),
                            String(chatId),
                            String(messageId),
                            msg.fromMe ? 1 : 0,
                            String(msg.type || 'chat'),
                            String(msg.body || ''),
                            hasMedia ? 1 : 0,
                            mediaMime ? String(mediaMime) : null,
                            mediaBase64 ? String(mediaBase64) : null,
                            String(sender),
                            String(receiver)
                        ];
                        console.log('Saving message with values:', safeValues.map((v, i) => `${i}: ${typeof v} = ${v}`).join(', '));
                        insert.run(...safeValues);
                    } catch (e) {
                        console.error('فشل في حفظ الرسالة الواردة:', e.message);
                    }
                });
            }

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
                await destroyClientCompletely(sessionId, client);
                
                // مسح QR code عند إيقاف الجلسة
                const clearQRStmt = db.prepare('UPDATE sessions SET qr_code = NULL, qr_timestamp = NULL WHERE id = ?');
                clearQRStmt.run(sessionId);
                
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
                
                client.on('disconnected', async () => {
                    console.log(`Restarted session ${sessionId} disconnected`);
                    await destroyClientCompletely(sessionId, client);
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
            console.error('خطأ في إرسال الرسالة:', error);
            socket.emit('message_error', { error: 'فشل في إرسال الرسالة: ' + error.message });
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
            console.error('خطأ في إرسال الرسائل الجماعية:', error);
            socket.emit('message_error', { error: 'فشل في إرسال الرسائل الجماعية: ' + error.message });
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
            console.error('خطأ في إرسال الملف:', error);
            socket.emit('file_error', { error: 'فشل في إرسال الملف: ' + error.message });
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
            console.error('خطأ في إرسال الموقع:', error);
            socket.emit('message_error', { error: 'فشل في إرسال الموقع: ' + error.message });
        }
    });
    
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// تنظيف الجلسات المنتهية الصلاحية
function cleanupExpiredSessions() {
    try {
        const result = db.prepare(`
            UPDATE sessions 
            SET status = 'expired' 
            WHERE expires_at IS NOT NULL 
            AND expires_at < CURRENT_TIMESTAMP 
            AND status != 'expired'
        `).run();
        
        if (result.changes > 0) {
            console.log(`🧹 تم تنظيف ${result.changes} جلسة منتهية الصلاحية`);
        }
    } catch (error) {
        console.error('خطأ في تنظيف الجلسات المنتهية:', error);
    }
}

// تنظيف العمليات المتبقية من Chrome
async function cleanupOrphanedChromeProcesses() {
    try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        console.log('🔍 فحص العمليات المتبقية من Chrome...');
        
        // الحصول على جميع الجلسات النشطة
        const activeSessionIds = Array.from(activeClients.keys());
        
        // تنظيف الجلسات التي لا تحتوي على عميل نشط ولكن حالتها "connected"
        const orphanedSessions = db.prepare(`
            SELECT id FROM sessions 
            WHERE status IN ('connected', 'authenticated', 'loading')
            AND id NOT IN (${activeSessionIds.length > 0 ? activeSessionIds.map(() => '?').join(',') : '0'})
        `).all(...activeSessionIds);
        
        if (orphanedSessions.length > 0) {
            console.log(`🧹 تم العثور على ${orphanedSessions.length} جلسة متبقية بدون عميل نشط`);
            for (const session of orphanedSessions) {
                const statusStmt = db.prepare('UPDATE sessions SET status = ? WHERE id = ?');
                statusStmt.run('disconnected', session.id);
                console.log(`✅ تم تحديث حالة الجلسة ${session.id} إلى disconnected`);
            }
        }
        
        // إغلاق عمليات Chrome المتبقية (التي لا تنتمي لجلسات نشطة)
        if (process.platform === 'win32') {
            // في Windows: البحث عن عمليات chrome.exe وإغلاقها
            try {
                const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq chrome.exe" /FO CSV');
                const lines = stdout.split('\n').filter(line => 
                    line.includes('chrome.exe') && 
                    !line.includes('PID') &&
                    line.trim()
                );
                
                if (lines.length > 0) {
                    console.log(`📊 تم العثور على ${lines.length} عملية Chrome`);
                    
                    // استخراج PIDs
                    const pids = [];
                    for (const line of lines) {
                        const parts = line.split('","');
                        if (parts.length > 1) {
                            const pid = parts[1].replace(/"/g, '').trim();
                            if (pid && !isNaN(pid)) {
                                pids.push(pid);
                            }
                        }
                    }
                    
                    // إغلاق العمليات المتبقية (فقط إذا لم تكن هناك جلسات نشطة)
                    if (activeSessionIds.length === 0 && pids.length > 0) {
                        console.log(`🔧 إغلاق ${pids.length} عملية Chrome متبقية...`);
                        for (const pid of pids) {
                            try {
                                await execAsync(`taskkill /F /T /PID ${pid}`);
                                console.log(`   ✅ تم إغلاق العملية ${pid}`);
                            } catch (error) {
                                // تجاهل الأخطاء (قد تكون العملية انتهت بالفعل)
                            }
                        }
                    }
                }
            } catch (error) {
                // تجاهل الأخطاء في فحص العمليات
            }
        } else {
            // في Linux/Mac: البحث عن عمليات chrome/chromium وإغلاقها
            try {
                const { stdout } = await execAsync('ps aux | grep -i chrome | grep -v grep | grep -v "cleanup"');
                const lines = stdout.split('\n').filter(line => line.trim());
                
                if (lines.length > 0) {
                    console.log(`📊 تم العثور على ${lines.length} عملية Chrome`);
                    
                    // استخراج PIDs
                    const pids = [];
                    for (const line of lines) {
                        const parts = line.trim().split(/\s+/);
                        if (parts.length > 1) {
                            const pid = parts[1];
                            if (pid && !isNaN(pid)) {
                                pids.push(pid);
                            }
                        }
                    }
                    
                    // إغلاق العمليات المتبقية (فقط إذا لم تكن هناك جلسات نشطة)
                    if (activeSessionIds.length === 0 && pids.length > 0) {
                        console.log(`🔧 إغلاق ${pids.length} عملية Chrome متبقية...`);
                        for (const pid of pids) {
                            try {
                                await execAsync(`kill -9 ${pid}`);
                                console.log(`   ✅ تم إغلاق العملية ${pid}`);
                            } catch (error) {
                                // تجاهل الأخطاء (قد تكون العملية انتهت بالفعل)
                            }
                        }
                    }
                }
            } catch (error) {
                // تجاهل الأخطاء في فحص العمليات
            }
        }
        
    } catch (error) {
        console.error('خطأ في تنظيف العمليات المتبقية:', error.message);
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
    console.log(`🚀 WhatsApp Dashboard Server running on port ${PORT}`);
    console.log(`📱 Open http://localhost:${PORT} in your browser`);
    
    // تنظيف الجلسات المنتهية الصلاحية
    cleanupExpiredSessions();
    
    // إعادة تشغيل الجلسات المتصلة
    await restartConnectedSessions();
    
    // تنظيف الجلسات المنتهية كل ساعة
    setInterval(cleanupExpiredSessions, 60 * 60 * 1000);
    
    // تنظيف العمليات المتبقية من Chrome كل 30 دقيقة
    setInterval(cleanupOrphanedChromeProcesses, 30 * 60 * 1000);
    
    // تنظيف العمليات المتبقية عند بدء الخادم
    setTimeout(cleanupOrphanedChromeProcesses, 60000); // بعد دقيقة واحدة
    
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
