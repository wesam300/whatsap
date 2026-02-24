const db = require('./db');
const bcrypt = require('bcrypt');

const ADMIN_USERNAME = 'admin';
const ADMIN_EMAIL = 'admin@localhost';
const ADMIN_PASSWORD = 'admin123';

const tables = [
    'api_logs',
    'session_tokens',
    'api_keys',
    'user_sessions',
    'sessions',
    'email_verification_tokens',
    'user_subscriptions',
    'report_templates',
    'messages',
    'users'
];
tables.forEach(table => {
    try {
        db.prepare(`DELETE FROM ${table}`).run();
    } catch (_) { }
});

const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
db.prepare(`
    INSERT INTO users (username, email, password_hash, email_verified, is_admin, is_active, max_sessions, session_ttl_days)
    VALUES (?, ?, ?, 1, 1, 1, 100, 365)
`).run(ADMIN_USERNAME, ADMIN_EMAIL, hash);

console.log('تم تفريغ قاعدة البيانات وإنشاء مستخدم الأدمن فقط.');
console.log('اسم المستخدم:', ADMIN_USERNAME);
console.log('كلمة المرور:', ADMIN_PASSWORD);
console.log('البريد:', ADMIN_EMAIL);
