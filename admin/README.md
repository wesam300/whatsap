# WhatsApp Admin Dashboard

نظام إدارة مستخدمين كامل لـ WhatsApp Web.js

## المميزات

- ✅ إضافة مستخدمين جدد
- ✅ تعديل بيانات المستخدمين
- ✅ حذف المستخدمين
- ✅ إدارة جلسات WhatsApp
- ✅ عرض QR Code للاتصال
- ✅ تحديث الحالة تلقائياً
- ✅ واجهة عربية حديثة

## التثبيت

```bash
cd admin
npm install
```

## التشغيل

```bash
npm start
```

أو للتطوير:

```bash
npm run dev
```

## الاستخدام

1. افتح المتصفح على `http://localhost:3000`
2. اضغط "إضافة مستخدم" لإضافة مستخدم جديد
3. املأ البيانات واضغط "حفظ"
4. اضغط "تشغيل" لبدء جلسة WhatsApp
5. اضغط "QR" لعرض رمز الاتصال
6. امسح الرمز بتطبيق WhatsApp

## API Endpoints

### Users
- `GET /api/users` - قائمة المستخدمين
- `POST /api/users` - إضافة مستخدم
- `PUT /api/users/:id` - تحديث مستخدم
- `DELETE /api/users/:id` - حذف مستخدم

### Sessions
- `POST /api/users/:id/start` - بدء الجلسة
- `POST /api/users/:id/stop` - إيقاف الجلسة
- `POST /api/users/:id/restart` - إعادة تشغيل الجلسة
- `GET /api/users/:id/status` - حالة الجلسة
- `GET /api/users/:id/qr` - رمز QR

## الملفات

- `server.js` - خادم Express
- `UserManager.js` - إدارة المستخدمين والجلسات
- `users.json` - تخزين بيانات المستخدمين
- `public/` - الواجهة الأمامية

## الإعدادات

انسخ `.env.example` إلى `.env` وعدل المنفذ إذا لزم الأمر:

```bash
cp .env.example .env
```
