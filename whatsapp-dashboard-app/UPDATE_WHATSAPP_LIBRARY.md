# تحديث مكتبة whatsapp-web.js

## المشكلة

إذا واجهت خطأ مثل:
```
TypeError: Cannot read properties of undefined (reading 'markedUnread')
```

هذا يعني أن مكتبة `whatsapp-web.js` قديمة وغير متوافقة مع إصدار WhatsApp Web الحالي.

## الحل

### الطريقة 1: استخدام السكربت التلقائي (موصى به)

#### على Windows:
```bash
# باستخدام PowerShell
.\update-package.ps1

# أو باستخدام Command Prompt
update-package.bat

# أو باستخدام Node.js
node update-whatsapp-library.js
```

#### على Linux/Mac:
```bash
node update-whatsapp-library.js
```

### الطريقة 2: التحديث اليدوي

```bash
# الانتقال إلى مجلد المشروع
cd whatsapp-dashboard-app

# تحديث المكتبة
npm install whatsapp-web.js@latest --save

# أو تحديث جميع الحزم
npm update
```

### الطريقة 3: استخدام update-server.js الشامل

```bash
node update-server.js
```

هذا السكربت يقوم بـ:
- تحديث قاعدة البيانات
- تنظيف الجلسات المحذوفة
- تحديث حزم npm (بما في ذلك whatsapp-web.js)

## بعد التحديث

1. **إعادة تشغيل الخادم:**
   ```bash
   pm2 restart whatsapp
   # أو
   npm start
   ```

2. **إذا استمرت المشاكل، احذف الكاش:**
   ```bash
   # احذف مجلد .wwebjs_cache
   rm -rf .wwebjs_cache
   # أو على Windows
   rmdir /s /q .wwebjs_cache
   ```

3. **تحقق من السجلات:**
   ```bash
   pm2 logs whatsapp
   ```

## الإصدارات

- **الإصدار الحالي المثبت:** يمكنك التحقق منه باستخدام:
  ```bash
  npm list whatsapp-web.js
  ```

- **أحدث إصدار متاح:** يمكنك التحقق منه باستخدام:
  ```bash
  npm view whatsapp-web.js version
  ```

## ملاحظات مهمة

1. **احتفظ بنسخة احتياطية** من قاعدة البيانات قبل التحديث
2. **أوقف الخادم** قبل التحديث لتجنب مشاكل في الملفات
3. **اختبر الجلسات** بعد التحديث للتأكد من عملها بشكل صحيح
4. **راقب السجلات** بعد التحديث للتحقق من عدم وجود أخطاء

## استكشاف الأخطاء

### إذا فشل التحديث:

1. احذف `node_modules` و `package-lock.json`:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

2. تحقق من إصدار Node.js (يجب أن يكون 16 أو أحدث):
   ```bash
   node --version
   ```

3. تحقق من اتصال الإنترنت و npm registry:
   ```bash
   npm ping
   ```

### إذا استمر الخطأ بعد التحديث:

1. احذف مجلد `.wwebjs_cache`
2. أعد إنشاء الجلسات
3. تحقق من إصدار WhatsApp Web في المتصفح
4. راجع [مشاكل GitHub](https://github.com/pedroslopez/whatsapp-web.js/issues) لمكتبة whatsapp-web.js

## الدعم

إذا استمرت المشاكل بعد التحديث، يرجى:
1. التحقق من إصدار المكتبة المثبت
2. مراجعة سجلات الأخطاء
3. فتح issue على GitHub مع تفاصيل الخطأ

