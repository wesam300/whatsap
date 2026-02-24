# إعداد البريد الإلكتروني للتحقق

## إعداد Gmail

### 1. تفعيل المصادقة الثنائية
1. اذهب إلى [إعدادات Google Account](https://myaccount.google.com/)
2. اختر "الأمان" (Security)
3. فعّل "التحقق بخطوتين" (2-Step Verification)

### 2. إنشاء كلمة مرور التطبيق
1. في نفس صفحة الأمان، ابحث عن "كلمات مرور التطبيقات" (App passwords)
2. انقر على "كلمات مرور التطبيقات"
3. اختر "تطبيق آخر" (Other app)
4. اكتب اسم التطبيق: "WhatsApp Dashboard"
5. انقر "إنشاء" (Generate)
6. انسخ كلمة المرور المكونة من 16 حرف

### 3. إعداد ملف .env
1. انسخ ملف `env.example` إلى `.env`
2. عدّل الملف كالتالي:
```
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-16-character-app-password
BASE_URL=http://localhost:3000
SESSION_SECRET=your-secret-key-change-this-in-production
```

## إعداد Outlook/Hotmail

### 1. تفعيل المصادقة الثنائية
1. اذهب إلى [إعدادات Microsoft Account](https://account.microsoft.com/security)
2. فعّل "التحقق بخطوتين"

### 2. إنشاء كلمة مرور التطبيق
1. اذهب إلى "كلمات مرور التطبيقات"
2. انقر "إنشاء كلمة مرور تطبيق جديدة"
3. انسخ كلمة المرور

### 3. إعداد ملف .env
```
EMAIL_USER=your-email@outlook.com
EMAIL_PASS=your-app-password
BASE_URL=http://localhost:3000
SESSION_SECRET=your-secret-key-change-this-in-production
```

## إعداد Yahoo Mail

### 1. تفعيل المصادقة الثنائية
1. اذهب إلى [إعدادات Yahoo Account](https://login.yahoo.com/account/security)
2. فعّل "التحقق بخطوتين"

### 2. إنشاء كلمة مرور التطبيق
1. اذهب إلى "كلمات مرور التطبيقات"
2. انقر "إنشاء كلمة مرور تطبيق"
3. انسخ كلمة المرور

### 3. إعداد ملف .env
```
EMAIL_USER=your-email@yahoo.com
EMAIL_PASS=your-app-password
BASE_URL=http://localhost:3000
SESSION_SECRET=your-secret-key-change-this-in-production
```

## إعداد SMTP مخصص

إذا كنت تريد استخدام مزود بريد إلكتروني آخر، يمكنك تعديل `emailService.js`:

```javascript
const transporter = nodemailer.createTransporter({
    host: 'smtp.your-provider.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});
```

## اختبار الإعداد

1. تأكد من إنشاء ملف `.env` مع الإعدادات الصحيحة
2. شغل التطبيق: `npm start`
3. اذهب إلى `http://localhost:3000`
4. سجل حساب جديد
5. تحقق من بريدك الإلكتروني لرمز التحقق

## استكشاف الأخطاء

### خطأ: "فشل في إرسال البريد الإلكتروني"
- تأكد من صحة كلمة مرور التطبيق
- تأكد من تفعيل المصادقة الثنائية
- تحقق من إعدادات الحماية في مزود البريد الإلكتروني

### خطأ: "Authentication failed"
- تأكد من صحة اسم المستخدم وكلمة المرور
- تحقق من إعدادات SMTP

### لا تصل رسائل التحقق
- تحقق من مجلد الرسائل غير المرغوب فيها
- تأكد من صحة عنوان البريد الإلكتروني
- تحقق من إعدادات الحماية في مزود البريد الإلكتروني
