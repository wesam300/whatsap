#!/usr/bin/env node

/**
 * Script لتحديث الخادم المرفوع
 * يضمن تطبيق جميع التحديثات الجديدة
 */

const fs = require('fs');
const path = require('path');

console.log('🚀 بدء تحديث الخادم...');

// التحقق من وجود الملفات المطلوبة
const requiredFiles = [
    'server.js',
    'db.js',
    'public/admin.html',
    'public/dashboard.html',
    'public/translations.js'
];

console.log('📋 التحقق من الملفات المطلوبة...');
requiredFiles.forEach(file => {
    if (fs.existsSync(file)) {
        console.log(`✅ ${file} موجود`);
    } else {
        console.log(`❌ ${file} غير موجود`);
    }
});

// التحقق من قاعدة البيانات
console.log('\n🔍 التحقق من قاعدة البيانات...');
try {
    const Database = require('better-sqlite3');
    const db = new Database('database.db');
    
    // التحقق من وجود الأعمدة الجديدة
    const usersColumns = db.prepare("PRAGMA table_info(users)").all();
    const sessionsColumns = db.prepare("PRAGMA table_info(sessions)").all();
    
    const requiredUserColumns = ['is_admin', 'is_active', 'max_sessions', 'session_ttl_days'];
    const requiredSessionColumns = ['max_days', 'days_remaining', 'is_paused', 'pause_reason'];
    
    console.log('📊 أعمدة جدول المستخدمين:');
    usersColumns.forEach(col => {
        const status = requiredUserColumns.includes(col.name) ? '✅' : '📝';
        console.log(`  ${status} ${col.name} (${col.type})`);
    });
    
    console.log('\n📊 أعمدة جدول الجلسات:');
    sessionsColumns.forEach(col => {
        const status = requiredSessionColumns.includes(col.name) ? '✅' : '📝';
        console.log(`  ${status} ${col.name} (${col.type})`);
    });
    
    // إضافة الأعمدة المفقودة
    console.log('\n🔧 إضافة الأعمدة المفقودة...');
    
    // أعمدة المستخدمين
    requiredUserColumns.forEach(col => {
        if (!usersColumns.find(c => c.name === col)) {
            try {
                let alterQuery = '';
                switch(col) {
                    case 'is_admin':
                        alterQuery = 'ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE';
                        break;
                    case 'is_active':
                        alterQuery = 'ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE';
                        break;
                    case 'max_sessions':
                        alterQuery = 'ALTER TABLE users ADD COLUMN max_sessions INTEGER DEFAULT 5';
                        break;
                    case 'session_ttl_days':
                        alterQuery = 'ALTER TABLE users ADD COLUMN session_ttl_days INTEGER DEFAULT 30';
                        break;
                }
                if (alterQuery) {
                    db.prepare(alterQuery).run();
                    console.log(`✅ تم إضافة ${col}`);
                }
            } catch (e) {
                console.log(`⚠️ ${col} موجود بالفعل أو خطأ: ${e.message}`);
            }
        }
    });
    
    // أعمدة الجلسات
    requiredSessionColumns.forEach(col => {
        if (!sessionsColumns.find(c => c.name === col)) {
            try {
                let alterQuery = '';
                switch(col) {
                    case 'max_days':
                        alterQuery = 'ALTER TABLE sessions ADD COLUMN max_days INTEGER DEFAULT 30';
                        break;
                    case 'days_remaining':
                        alterQuery = 'ALTER TABLE sessions ADD COLUMN days_remaining INTEGER DEFAULT 30';
                        break;
                    case 'is_paused':
                        alterQuery = 'ALTER TABLE sessions ADD COLUMN is_paused BOOLEAN DEFAULT FALSE';
                        break;
                    case 'pause_reason':
                        alterQuery = 'ALTER TABLE sessions ADD COLUMN pause_reason TEXT';
                        break;
                }
                if (alterQuery) {
                    db.prepare(alterQuery).run();
                    console.log(`✅ تم إضافة ${col}`);
                }
            } catch (e) {
                console.log(`⚠️ ${col} موجود بالفعل أو خطأ: ${e.message}`);
            }
        }
    });
    
    // التحقق من جدول الإعدادات
    try {
        const settingsColumns = db.prepare("PRAGMA table_info(settings)").all();
        const requiredSettingsColumns = ['default_max_sessions', 'default_session_days'];
        
        console.log('\n📊 أعمدة جدول الإعدادات:');
        settingsColumns.forEach(col => {
            const status = requiredSettingsColumns.includes(col.name) ? '✅' : '📝';
            console.log(`  ${status} ${col.name} (${col.type})`);
        });
        
        // إضافة أعمدة الإعدادات المفقودة
        requiredSettingsColumns.forEach(col => {
            if (!settingsColumns.find(c => c.name === col)) {
                try {
                    let alterQuery = '';
                    switch(col) {
                        case 'default_max_sessions':
                            alterQuery = 'ALTER TABLE settings ADD COLUMN default_max_sessions INTEGER DEFAULT 5';
                            break;
                        case 'default_session_days':
                            alterQuery = 'ALTER TABLE settings ADD COLUMN default_session_days INTEGER DEFAULT 30';
                            break;
                    }
                    if (alterQuery) {
                        db.prepare(alterQuery).run();
                        console.log(`✅ تم إضافة ${col}`);
                    }
                } catch (e) {
                    console.log(`⚠️ ${col} موجود بالفعل أو خطأ: ${e.message}`);
                }
            }
        });
    } catch (e) {
        console.log('⚠️ جدول الإعدادات غير موجود، سيتم إنشاؤه عند تشغيل الخادم');
    }
    
    // تحديث الأيام المتبقية للجلسات الموجودة
    console.log('\n🔄 تحديث الأيام المتبقية للجلسات الموجودة...');
    try {
        const sessions = db.prepare('SELECT id, expires_at, max_days, days_remaining FROM sessions WHERE expires_at IS NOT NULL').all();
        const now = new Date();
        
        sessions.forEach(session => {
            const expiryDate = new Date(session.expires_at);
            const timeDiff = expiryDate.getTime() - now.getTime();
            const daysRemaining = Math.ceil(timeDiff / (1000 * 3600 * 24));
            
            // تحديث الأيام المتبقية إذا تغيرت
            if (daysRemaining !== session.days_remaining) {
                db.prepare(`
                    UPDATE sessions 
                    SET days_remaining = ?, updated_at = CURRENT_TIMESTAMP 
                    WHERE id = ?
                `).run(Math.max(0, daysRemaining), session.id);
                console.log(`✅ تم تحديث الجلسة ${session.id}: ${daysRemaining} يوم متبقي`);
            }
        });
        
        console.log(`✅ تم تحديث ${sessions.length} جلسة`);
    } catch (e) {
        console.log('⚠️ خطأ في تحديث الأيام المتبقية:', e.message);
    }
    
    db.close();
    console.log('\n✅ تم تحديث قاعدة البيانات بنجاح!');
    
} catch (error) {
    console.error('❌ خطأ في تحديث قاعدة البيانات:', error.message);
}

console.log('\n🎉 تم الانتهاء من التحديث!');
console.log('📝 تعليمات التشغيل:');
console.log('1. تأكد من رفع جميع الملفات المحدثة');
console.log('2. قم بتشغيل: pm2 restart whatsapp');
console.log('3. تحقق من السجلات: pm2 logs whatsapp');
