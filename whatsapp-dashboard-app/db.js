const Database = require('better-sqlite3');
const path = require('path');

// Create database file in the sessions directory
const dbPath = path.join(__dirname, 'sessions', 'whatsapp_dashboard.db');

// Ensure sessions directory exists
const fs = require('fs');
const sessionsDir = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
}

const db = new Database(dbPath);

// Create tables
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        email_verified BOOLEAN DEFAULT FALSE,
        is_admin BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        max_sessions INTEGER DEFAULT 5,
        session_ttl_days INTEGER DEFAULT 30,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS email_verification_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_name TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        status TEXT DEFAULT 'disconnected',
        qr_code TEXT,
        session_data TEXT,
        expires_at DATETIME,
        max_days INTEGER DEFAULT 30,
        days_remaining INTEGER DEFAULT 30,
        is_paused BOOLEAN DEFAULT FALSE,
        pause_reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        session_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_session_id ON user_sessions(session_id);
    CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id ON email_verification_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token ON email_verification_tokens(token);
`);

    // إنشاء جدول مفاتيح API للمستخدمين
    db.prepare(`
        CREATE TABLE IF NOT EXISTS api_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            key_name TEXT NOT NULL,
            api_key TEXT UNIQUE NOT NULL,
            is_active BOOLEAN DEFAULT TRUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used DATETIME,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
    `).run();

    // إنشاء جدول توكنات الجلسات
    db.prepare(`
        CREATE TABLE IF NOT EXISTS session_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            session_id TEXT NOT NULL,
            token TEXT UNIQUE NOT NULL,
            is_active BOOLEAN DEFAULT TRUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used DATETIME,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
    `).run();

    // إنشاء جدول سجلات API
    db.prepare(`
        CREATE TABLE IF NOT EXISTS api_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            api_key_id INTEGER,
            session_token_id INTEGER,
            endpoint TEXT NOT NULL,
            method TEXT NOT NULL,
            status_code INTEGER NOT NULL,
            response_time INTEGER,
            ip_address TEXT,
            user_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            FOREIGN KEY (api_key_id) REFERENCES api_keys (id) ON DELETE SET NULL,
            FOREIGN KEY (session_token_id) REFERENCES session_tokens (id) ON DELETE SET NULL
        )
    `).run();

    // إنشاء جدول الرسائل
    db.prepare(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            chat_id TEXT NOT NULL,
            message_id TEXT UNIQUE NOT NULL,
            from_me BOOLEAN DEFAULT FALSE,
            type TEXT,
            body TEXT,
            has_media BOOLEAN DEFAULT FALSE,
            media_mime_type TEXT,
            media_base64 TEXT,
            sender TEXT,
            receiver TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // إضافة الأعمدة المفقودة للقاعدة الموجودة (Migration)
    try {
        // إضافة أعمدة المستخدمين المفقودة
        db.prepare('ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE').run();
    } catch (e) { /* Column already exists */ }
    
    try {
        db.prepare('ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE').run();
    } catch (e) { /* Column already exists */ }
    
    try {
        db.prepare('ALTER TABLE users ADD COLUMN max_sessions INTEGER DEFAULT 5').run();
    } catch (e) { /* Column already exists */ }
    
    try {
        db.prepare('ALTER TABLE users ADD COLUMN session_ttl_days INTEGER DEFAULT 30').run();
    } catch (e) { /* Column already exists */ }
    
    try {
        // إضافة عمود انتهاء الصلاحية للجلسات
        db.prepare('ALTER TABLE sessions ADD COLUMN expires_at DATETIME').run();
    } catch (e) { /* Column already exists */ }
    
    try {
        // إضافة أعمدة الإعدادات العامة
        db.prepare('ALTER TABLE settings ADD COLUMN default_max_sessions INTEGER DEFAULT 5').run();
    } catch (e) { /* Column already exists */ }
    
    try {
        db.prepare('ALTER TABLE settings ADD COLUMN default_session_days INTEGER DEFAULT 30').run();
    } catch (e) { /* Column already exists */ }
    
    try {
        // إضافة أعمدة التحكم في الجلسات
        db.prepare('ALTER TABLE sessions ADD COLUMN max_days INTEGER DEFAULT 30').run();
    } catch (e) { /* Column already exists */ }
    
    try {
        db.prepare('ALTER TABLE sessions ADD COLUMN days_remaining INTEGER DEFAULT 30').run();
    } catch (e) { /* Column already exists */ }
    
    try {
        db.prepare('ALTER TABLE sessions ADD COLUMN is_paused BOOLEAN DEFAULT FALSE').run();
    } catch (e) { /* Column already exists */ }
    
    try {
        db.prepare('ALTER TABLE sessions ADD COLUMN pause_reason TEXT').run();
    } catch (e) { /* Column already exists */ }
    
    try {
        // إضافة عمود timestamp للQR code
        db.prepare('ALTER TABLE sessions ADD COLUMN qr_timestamp DATETIME').run();
    } catch (e) { /* Column already exists */ }

    // إنشاء فهارس للبحث السريع
    db.prepare('CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_api_keys_api_key ON api_keys(api_key)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_session_tokens_user_id ON session_tokens(user_id)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_session_tokens_token ON session_tokens(token)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_api_logs_user_id ON api_logs(user_id)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_api_logs_created_at ON api_logs(created_at)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)').run();

// إنشاء جدول الباقات
db.prepare(`
    CREATE TABLE IF NOT EXISTS packages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        currency TEXT DEFAULT 'USD',
        duration_days INTEGER NOT NULL,
        max_sessions INTEGER NOT NULL,
        features TEXT, -- JSON array of features
        is_active BOOLEAN DEFAULT TRUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`).run();

// إنشاء جدول اشتراكات المستخدمين
db.prepare(`
    CREATE TABLE IF NOT EXISTS user_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        package_id INTEGER NOT NULL,
        start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        end_date DATETIME NOT NULL,
        status TEXT DEFAULT 'active', -- active, expired, cancelled
        payment_status TEXT DEFAULT 'pending', -- pending, paid, failed
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE CASCADE
    )
`).run();

// إنشاء جدول إعدادات النظام
db.prepare(`
    CREATE TABLE IF NOT EXISTS system_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        admin_phone TEXT,
        admin_email TEXT,
        support_whatsapp TEXT,
        company_name TEXT,
        company_address TEXT,
        terms_conditions TEXT,
        privacy_policy TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`).run();

// إنشاء فهارس للجداول الجديدة
db.prepare('CREATE INDEX IF NOT EXISTS idx_packages_active ON packages(is_active)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON user_subscriptions(status)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_user_subscriptions_end_date ON user_subscriptions(end_date)').run();

// إدراج بيانات افتراضية للباقات
try {
    const packagesCount = db.prepare('SELECT COUNT(1) as c FROM packages').get();
    if (packagesCount.c === 0) {
        const defaultPackages = [
            {
                name: 'الباقة الأساسية',
                description: 'مناسبة للمستخدمين الجدد',
                price: 19.99,
                currency: 'USD',
                duration_days: 30,
                max_sessions: 1,
                features: JSON.stringify(['جلسة واحدة', 'دعم عبر واتساب', 'إرسال رسائل نصية'])
            },
            {
                name: 'الباقة الاحترافية',
                description: 'مناسبة للاستخدام المتوسط',
                price: 49.99,
                currency: 'USD',
                duration_days: 30,
                max_sessions: 3,
                features: JSON.stringify(['حتى 3 جلسات', 'دعم أولوية', 'إرسال ملفات', 'تقارير أساسية'])
            },
            {
                name: 'باقة الأعمال',
                description: 'مناسبة للشركات والمؤسسات',
                price: 99.99,
                currency: 'USD',
                duration_days: 30,
                max_sessions: 10,
                features: JSON.stringify(['حتى 10 جلسات', 'تقارير متقدمة', 'دعم على مدار الساعة', 'API متقدم'])
            }
        ];

        const insertPackage = db.prepare(`
            INSERT INTO packages (name, description, price, currency, duration_days, max_sessions, features)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        defaultPackages.forEach(pkg => {
            insertPackage.run(pkg.name, pkg.description, pkg.price, pkg.currency, pkg.duration_days, pkg.max_sessions, pkg.features);
        });
    }
} catch (e) {
    console.log('Error creating default packages:', e);
}

// إدراج إعدادات النظام الافتراضية
try {
    const settingsCount = db.prepare('SELECT COUNT(1) as c FROM system_settings WHERE id = 1').get();
    if (settingsCount.c === 0) {
        db.prepare(`
            INSERT INTO system_settings (id, admin_phone, admin_email, support_whatsapp, company_name, company_address)
            VALUES (1, '+966501234567', 'admin@example.com', '+966501234567', 'شركة التطوير', 'الرياض، المملكة العربية السعودية')
        `).run();
    }
} catch (e) {
    console.log('Error creating system settings:', e);
}

module.exports = db;
 
// =============================
// Admin/Policies migrations (best-effort)
// =============================
try { db.prepare("ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE").run(); } catch (e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE").run(); } catch (e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN max_sessions INTEGER DEFAULT 1").run(); } catch (e) {}
try { db.prepare("ALTER TABLE users ADD COLUMN session_ttl_hours INTEGER").run(); } catch (e) {}
try { db.prepare("ALTER TABLE sessions ADD COLUMN expires_at DATETIME").run(); } catch (e) {}
// إضافة عمود expires_at إذا لم يكن موجوداً
try {
    const columns = db.prepare("PRAGMA table_info(sessions)").all();
    const hasExpiresAt = columns.some(col => col.name === 'expires_at');
    if (!hasExpiresAt) {
        db.prepare("ALTER TABLE sessions ADD COLUMN expires_at DATETIME").run();
        console.log('تم إضافة عمود expires_at إلى جدول sessions');
    }
} catch (e) {
    console.log('خطأ في إضافة عمود expires_at:', e.message);
}

// Switch TTL to days instead of hours
try { db.prepare("ALTER TABLE users ADD COLUMN session_ttl_days INTEGER").run(); } catch (e) {}
try { db.prepare('UPDATE users SET session_ttl_days = 5 WHERE session_ttl_days IS NULL').run(); } catch (e) {}

// Settings table for commercial config
try {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            admin_phone TEXT,
            packages_json TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
    const s = db.prepare('SELECT COUNT(1) as c FROM settings WHERE id = 1').get();
    if (!s || s.c === 0) {
        const defaultPackages = [
            { id: 'basic', name: 'الباقة الأساسية', price: 19, currency: 'USD', durationDays: 5, features: ['جلسة واحدة', 'دعم عبر واتساب'] },
            { id: 'pro', name: 'الباقة الاحترافية', price: 49, currency: 'USD', durationDays: 30, features: ['حتى 3 جلسات', 'دعم أولوية', 'إرسال ملفات'] },
            { id: 'business', name: 'باقة الأعمال', price: 99, currency: 'USD', durationDays: 30, features: ['حتى 10 جلسات', 'تقارير متقدمة', 'دعم على مدار الساعة'] }
        ];
        db.prepare('INSERT INTO settings (id, admin_phone, packages_json) VALUES (1, ?, ?)')
          .run('+7 993 070-65-16', JSON.stringify(defaultPackages));
    }
} catch (e) {}

// Seed admin if not exists (dev convenience)
try {
    const row = db.prepare('SELECT COUNT(1) as c FROM users WHERE is_admin = TRUE').get();
    if (row && row.c === 0) {
        // Default admin: admin / admin123 (hash is not set here; create a disabled placeholder unless app handles it)
        // For safety, only create if NO users exist at all
        const usersCount = db.prepare('SELECT COUNT(1) as c FROM users').get();
        if (usersCount.c === 0) {
            const bcrypt = require('bcrypt');
            const hash = bcrypt.hashSync('reem123', 10);
            db.prepare('INSERT INTO users (username, email, password_hash, is_admin, is_active, max_sessions, session_ttl_hours) VALUES (?, ?, ?, TRUE, TRUE, 3, 720)')
              .run('reem', 'reem@example.com', hash);
            try { console.log('Admin user created: username=reem, password=reem123'); } catch (_) {}
        }
    }
} catch (e) {}
