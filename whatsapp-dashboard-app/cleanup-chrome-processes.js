// ========================================
// سكريبت تنظيف عمليات Chrome المتبقية (أوبونتو/لينكس فقط)
// ========================================
// هذا السكريبت يغلق جميع عمليات Chrome/Chromium المتبقية للجلسات المنتهية

const { exec } = require('child_process');
const { promisify } = require('util');
const db = require('./db');
const path = require('path');

const execAsync = promisify(exec);

if (process.platform !== 'linux' && process.platform !== 'darwin') {
    console.error('هذا السكريبت مخصّص لأوبونتو/لينكس فقط.');
    process.exit(1);
}

console.log('🧹 بدء تنظيف عمليات Chrome المتبقية...\n');

// الحصول على جميع الجلسات النشطة من قاعدة البيانات
async function getActiveSessions() {
    try {
        const activeSessions = db.prepare(`
            SELECT id FROM sessions 
            WHERE status = 'connected' OR status = 'authenticated' OR status = 'loading'
        `).all();
        
        return activeSessions.map(s => String(s.id));
    } catch (error) {
        console.error('خطأ في جلب الجلسات النشطة:', error);
        return [];
    }
}

// إغلاق عمليات Chrome في أوبونتو/لينكس/ماك
async function killChromeProcessesUnix() {
    try {
        console.log('🔍 البحث عن عمليات Chrome في Linux/Mac...');
        
        // البحث عن عمليات chrome/chromium
        const { stdout } = await execAsync('ps aux | grep -i chrome | grep -v grep');
        const lines = stdout.split('\n').filter(line => line.trim());
        
        if (lines.length === 0) {
            console.log('✅ لا توجد عمليات Chrome نشطة');
            return;
        }
        
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
        
        if (pids.length === 0) {
            console.log('⚠️ لم يتم العثور على PIDs صحيحة');
            return;
        }
        
        console.log(`🔧 إغلاق ${pids.length} عملية Chrome...`);
        
        // إغلاق كل عملية
        for (const pid of pids) {
            try {
                await execAsync(`kill -9 ${pid}`);
                console.log(`   ✅ تم إغلاق العملية ${pid}`);
            } catch (error) {
                // تجاهل الأخطاء (قد تكون العملية انتهت بالفعل)
                console.log(`   ⚠️ لم يتم إغلاق العملية ${pid} (قد تكون انتهت بالفعل)`);
            }
        }
        
        console.log('✅ تم إغلاق جميع عمليات Chrome');
        
    } catch (error) {
        if (error.message.includes('not found') || error.message.includes('لا توجد')) {
            console.log('✅ لا توجد عمليات Chrome نشطة');
        } else {
            console.error('❌ خطأ في إغلاق عمليات Chrome:', error.message);
        }
    }
}

// تنظيف الجلسات المنتهية في قاعدة البيانات
async function cleanupExpiredSessions() {
    try {
        console.log('\n🧹 تنظيف الجلسات المنتهية من قاعدة البيانات...');
        
        // تحديث الجلسات المنتهية
        const expiredResult = db.prepare(`
            UPDATE sessions 
            SET status = 'expired' 
            WHERE expires_at IS NOT NULL 
            AND expires_at < CURRENT_TIMESTAMP 
            AND status != 'expired'
        `).run();
        
        if (expiredResult.changes > 0) {
            console.log(`✅ تم تحديث ${expiredResult.changes} جلسة منتهية الصلاحية`);
        }
        
        // تحديث الجلسات المنفصلة القديمة
        const disconnectedResult = db.prepare(`
            UPDATE sessions 
            SET status = 'disconnected' 
            WHERE status IN ('connected', 'authenticated', 'loading')
            AND updated_at < datetime('now', '-1 hour')
            AND id NOT IN (
                SELECT id FROM sessions 
                WHERE status IN ('connected', 'authenticated', 'loading')
                AND updated_at >= datetime('now', '-1 hour')
            )
        `).run();
        
        if (disconnectedResult.changes > 0) {
            console.log(`✅ تم تحديث ${disconnectedResult.changes} جلسة منفصلة`);
        }
        
    } catch (error) {
        console.error('❌ خطأ في تنظيف الجلسات:', error.message);
    }
}

// الدالة الرئيسية
async function main() {
    try {
        // تنظيف قاعدة البيانات أولاً
        await cleanupExpiredSessions();
        
        // الحصول على الجلسات النشطة
        const activeSessions = await getActiveSessions();
        console.log(`\n📋 الجلسات النشطة في قاعدة البيانات: ${activeSessions.length}`);
        if (activeSessions.length > 0) {
            console.log(`   IDs: ${activeSessions.join(', ')}`);
        }
        
        await killChromeProcessesUnix();
        
        console.log('\n✅ اكتمل التنظيف بنجاح!');
        console.log('\n💡 نصيحة: يمكنك تشغيل هذا السكريبت بشكل دوري أو إضافته إلى cron job');
        
    } catch (error) {
        console.error('❌ خطأ عام:', error);
        process.exit(1);
    }
}

// تشغيل السكريبت
main().then(() => {
    process.exit(0);
}).catch(error => {
    console.error('❌ خطأ فادح:', error);
    process.exit(1);
});

