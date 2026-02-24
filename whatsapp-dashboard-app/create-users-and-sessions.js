/**
 * سكربت لإنشاء 3 مستخدمين وجلسة واحدة لكل منهم من خلال الطرفية.
 * التشغيل: node create-users-and-sessions.js
 */
const bcrypt = require('bcrypt');
const db = require('./db');

const DEFAULT_PASSWORD = 'Password123!';

const USERS = [
  { username: 'user1', email: 'user1@example.com', sessionName: 'جلسة المستخدم 1' },
  { username: 'user2', email: 'user2@example.com', sessionName: 'جلسة المستخدم 2' },
  { username: 'user3', email: 'user3@example.com', sessionName: 'جلسة المستخدم 3' },
];

function run() {
  const passwordHash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
  const insertUser = db.prepare(
    'INSERT INTO users (username, email, password_hash, email_verified, is_active, max_sessions, session_ttl_days) VALUES (?, ?, ?, 1, 1, 5, 30)'
  );
  const insertSession = db.prepare(
    'INSERT INTO sessions (session_name, user_id, status) VALUES (?, ?, ?)'
  );
  const updateExpiry = db.prepare(`
    UPDATE sessions SET expires_at = datetime('now', '+30 days'), max_days = 30, days_remaining = 30, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `);

  for (const u of USERS) {
    const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(u.username, u.email);
    if (existing) {
      console.log(`⏭️  تخطي "${u.username}" (موجود مسبقاً)`);
      continue;
    }
    const userResult = insertUser.run(u.username, u.email, passwordHash);
    const userId = userResult.lastInsertRowid;
    const sessionResult = insertSession.run(u.sessionName, userId, 'disconnected');
    updateExpiry.run(sessionResult.lastInsertRowid);
    console.log(`✅ مستخدم: ${u.username} (البريد: ${u.email}) | جلسة: "${u.sessionName}" (id: ${sessionResult.lastInsertRowid})`);
  }

  console.log('\n📋 كلمة المرور الافتراضية لجميع المستخدمين:', DEFAULT_PASSWORD);
}

run();
