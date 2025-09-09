# 🔧 تعليمات تحديث الخادم

## المشاكل التي تم حلها:
- ✅ إصلاح خطأ SQLite binding
- ✅ إضافة أعمدة جديدة للتحكم في الجلسات
- ✅ إضافة API routes جديدة
- ✅ تحديث واجهات الإدارة والمستخدم

## خطوات التحديث:

### 1. رفع الملفات المحدثة:
```bash
# رفع جميع الملفات المحدثة إلى الخادم
git pull origin main
```

### 2. تشغيل script التحديث:
```bash
cd whatsapp-dashboard-app
node update-server.js
```

### 3. إعادة تشغيل الخادم:
```bash
# الطريقة الأولى: استخدام script
chmod +x restart-server.sh
./restart-server.sh

# الطريقة الثانية: يدوياً
pm2 stop whatsapp
pm2 start server.js --name whatsapp
```

### 4. التحقق من التحديث:
```bash
# عرض حالة الخادم
pm2 status

# عرض السجلات
pm2 logs whatsapp

# التحقق من عدم وجود أخطاء
pm2 logs whatsapp --lines 20
```

## الملفات المحدثة:
- `server.js` - إضافة API routes جديدة وإصلاح SQLite
- `db.js` - إضافة أعمدة جديدة للتحكم
- `public/admin.html` - واجهة إدارة متقدمة
- `public/dashboard.html` - واجهة مستخدم محسنة
- `public/translations.js` - نظام الترجمة

## الميزات الجديدة:
- 🎛️ تحكم كامل في الجلسات
- ⚙️ إدارة حدود المستخدمين
- 📊 عرض تفاصيل الجلسات
- 🔄 تمديد الجلسات
- ⏸️ إيقاف/تفعيل الجلسات
- 🌐 نظام ترجمة كامل

## استكشاف الأخطاء:
إذا واجهت مشاكل:

1. **خطأ SQLite binding:**
   ```bash
   pm2 logs whatsapp | grep "SQLite3 can only bind"
   ```
   - تأكد من رفع `server.js` المحدث

2. **خطأ في قاعدة البيانات:**
   ```bash
   node update-server.js
   ```

3. **خطأ في الواجهة:**
   - تأكد من رفع جميع ملفات `public/`
   - تأكد من وجود `translations.js`

4. **إعادة تعيين كاملة:**
   ```bash
   pm2 delete whatsapp
   pm2 start server.js --name whatsapp
   ```

## الدعم:
إذا استمرت المشاكل، تحقق من:
- إصدار Node.js (يجب أن يكون 14+)
- إصدار PM2
- مساحة القرص المتاحة
- صلاحيات الملفات
