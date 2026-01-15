#!/usr/bin/env node

/**
 * سكربت لتحديث مكتبة whatsapp-web.js إلى أحدث إصدار
 * يحل مشاكل التوافق مع WhatsApp Web
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 بدء تحديث مكتبة whatsapp-web.js...\n');

const packageJsonPath = path.join(__dirname, 'package.json');

// التحقق من وجود package.json
if (!fs.existsSync(packageJsonPath)) {
    console.error('❌ ملف package.json غير موجود!');
    process.exit(1);
}

// قراءة package.json
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const currentVersion = packageJson.dependencies['whatsapp-web.js'] || packageJson.devDependencies['whatsapp-web.js'];

console.log(`📋 الإصدار الحالي في package.json: ${currentVersion || 'غير محدد'}`);

// الحصول على أحدث إصدار
console.log('\n🔍 التحقق من أحدث إصدار متاح...');
try {
    const latestVersion = execSync('npm view whatsapp-web.js version', { 
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    
    console.log(`📦 أحدث إصدار متاح: ${latestVersion}`);
    
    // استخراج رقم الإصدار الحالي
    const currentVersionNum = currentVersion ? currentVersion.replace(/[\^~]/, '') : '0.0.0';
    
    if (currentVersionNum === latestVersion) {
        console.log('\n✅ أنت تستخدم بالفعل أحدث إصدار!');
    } else {
        console.log(`\n🔄 تحديث من ${currentVersionNum} إلى ${latestVersion}...`);
        
        // تحديث package.json
        if (packageJson.dependencies['whatsapp-web.js']) {
            packageJson.dependencies['whatsapp-web.js'] = `^${latestVersion}`;
        } else if (packageJson.devDependencies['whatsapp-web.js']) {
            packageJson.devDependencies['whatsapp-web.js'] = `^${latestVersion}`;
        } else {
            packageJson.dependencies['whatsapp-web.js'] = `^${latestVersion}`;
        }
        
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
        console.log('✅ تم تحديث package.json');
        
        // تثبيت الإصدار الجديد
        console.log('\n📥 تثبيت الإصدار الجديد...');
        try {
            execSync(`npm install whatsapp-web.js@${latestVersion} --save`, {
                encoding: 'utf8',
                cwd: __dirname,
                stdio: 'inherit'
            });
            console.log('\n✅ تم تحديث whatsapp-web.js بنجاح!');
        } catch (error) {
            console.error('\n❌ فشل في تثبيت الإصدار الجديد:', error.message);
            console.log('\n💡 حاول تشغيل الأمر التالي يدوياً:');
            console.log(`   npm install whatsapp-web.js@${latestVersion} --save`);
            process.exit(1);
        }
    }
    
    // التحقق من الإصدار المثبت
    console.log('\n🔍 التحقق من الإصدار المثبت...');
    try {
        const installedVersion = execSync('npm list whatsapp-web.js --depth=0', {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        });
        const versionLine = installedVersion.split('\n').find(line => line.includes('whatsapp-web.js'));
        if (versionLine) {
            console.log('📦 ' + versionLine.trim());
        }
    } catch (e) {
        // تجاهل الخطأ
    }
    
    console.log('\n🎉 تم الانتهاء من التحديث!');
    console.log('\n📝 ملاحظات مهمة:');
    console.log('1. قد تحتاج لإعادة تشغيل الخادم بعد التحديث');
    console.log('2. قد تحتاج لحذف مجلد .wwebjs_cache إذا استمرت المشاكل');
    console.log('3. تأكد من أن جميع الجلسات متصلة بشكل صحيح بعد التحديث');
    
} catch (error) {
    console.error('\n❌ خطأ في التحقق من الإصدارات:', error.message);
    console.log('\n💡 حاول تحديث المكتبة يدوياً:');
    console.log('   npm install whatsapp-web.js@latest --save');
    process.exit(1);
}

