// ========================================
// سكريبت لإصلاح صلاحيات الأدمن
// ========================================
// هذا السكريبت يضمن أن المستخدم reem لديه صلاحيات الأدمن

const db = require('./db');
const bcrypt = require('bcrypt');

console.log('🔧 بدء إصلاح صلاحيات الأدمن...\n');

// البحث عن المستخدم reem
const user = db.prepare('SELECT * FROM users WHERE username = ? OR email LIKE ?').get('reem', '%reem%');

if (!user) {
    console.log('❌ لم يتم العثور على المستخدم reem');
    console.log('📝 إنشاء مستخدم أدمن جديد باسم reem...');
    
    // إنشاء مستخدم أدمن جديد
    const passwordHash = bcrypt.hashSync('reem123', 10);
    const result = db.prepare(`
        INSERT INTO users (username, email, password_hash, is_admin, is_active, max_sessions, session_ttl_days)
        VALUES (?, ?, ?, 1, 1, 100, 365)
    `).run('reem', 'reem@admin.com', passwordHash);
    
    console.log('✅ تم إنشاء مستخدم الأدمن reem بنجاح');
    console.log('   - اسم المستخدم: reem');
    console.log('   - كلمة المرور: reem123');
    console.log('   - البريد الإلكتروني: reem@admin.com');
    console.log('   - صلاحيات الأدمن: ✅ مفعلة');
    console.log('   - الحالة: ✅ نشط');
    console.log('   - الحد الأقصى للجلسات: 100');
    console.log('   - مدة الجلسة: 365 يوم');
} else {
    console.log('✅ تم العثور على المستخدم reem');
    console.log(`   - ID: ${user.id}`);
    console.log(`   - اسم المستخدم: ${user.username}`);
    console.log(`   - البريد الإلكتروني: ${user.email}`);
    console.log(`   - صلاحيات الأدمن الحالية: ${user.is_admin ? '✅ مفعلة' : '❌ معطلة'}`);
    console.log(`   - الحالة: ${user.is_active ? '✅ نشط' : '❌ معطل'}`);
    
    // التحقق من صلاحيات الأدمن
    if (user.is_admin !== 1) {
        console.log('\n🔧 إصلاح صلاحيات الأدمن...');
        db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
        console.log('✅ تم تفعيل صلاحيات الأدمن');
    }
    
    // التأكد من أن المستخدم نشط
    if (user.is_active !== 1) {
        console.log('🔧 تفعيل المستخدم...');
        db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(user.id);
        console.log('✅ تم تفعيل المستخدم');
    }
    
    // تحديث الحدود للسماح بالتحكم الكامل
    console.log('🔧 تحديث حدود الجلسات...');
    db.prepare('UPDATE users SET max_sessions = 100, session_ttl_days = 365 WHERE id = ?').run(user.id);
    console.log('✅ تم تحديث الحدود');
    
    console.log('\n✅ تم إصلاح صلاحيات الأدمن بنجاح!');
}

// عرض جميع المستخدمين الأدمن
console.log('\n📋 قائمة جميع المستخدمين الأدمن:');
const admins = db.prepare('SELECT id, username, email, is_admin, is_active FROM users WHERE is_admin = 1').all();
if (admins.length === 0) {
    console.log('   ⚠️ لا يوجد مستخدمين أدمن');
} else {
    admins.forEach(admin => {
        console.log(`   - ${admin.username} (${admin.email}) - ${admin.is_active ? 'نشط' : 'معطل'}`);
    });
}

console.log('\n✅ اكتمل إصلاح صلاحيات الأدمن!');
console.log('💡 يمكنك الآن تسجيل الدخول باستخدام:');
console.log('   - اسم المستخدم: reem');
console.log('   - كلمة المرور: reem123');

