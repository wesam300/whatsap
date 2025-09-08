# دليل اختبار API في Postman

## 📋 المتطلبات المسبقة

1. **Postman مثبت** على جهازك
2. **الخادم يعمل** على `http://localhost:3000`
3. **حساب مسجل** في التطبيق
4. **جلسة WhatsApp متصلة**

## 🔑 الحصول على المفاتيح

### الخطوة 1: تسجيل الدخول
1. افتح المتصفح على `http://localhost:3000`
2. سجل دخول بحسابك
3. اضغط على "🔑 إدارة API"

### الخطوة 2: نسخ المفاتيح
1. انسخ **مفتاح API** من الصفحة
2. انسخ **توكن الجلسة** من الجلسة المتصلة

## 🧪 إنشاء Collection في Postman

### 1. إنشاء Collection جديد
- اسم: `WhatsApp API`
- وصف: `API لاختبار إرسال الرسائل عبر WhatsApp`

### 2. إعداد Environment Variables
أنشئ Environment جديد وأضف المتغيرات التالية:

| Variable | Initial Value | Current Value |
|----------|---------------|---------------|
| `base_url` | `http://localhost:3000` | `http://localhost:3000` |
| `api_key` | `YOUR_API_KEY_HERE` | `YOUR_API_KEY_HERE` |
| `session_token` | `YOUR_SESSION_TOKEN_HERE` | `YOUR_SESSION_TOKEN_HERE` |

## 📤 إنشاء الطلبات

### 1. إرسال رسالة نصية

**Request Details:**
- Method: `POST`
- URL: `{{base_url}}/api/send-message`
- Headers:
  ```
  X-API-Key: {{api_key}}
  X-Session-Token: {{session_token}}
  Content-Type: application/json
  ```
- Body (raw JSON):
  ```json
  {
    "to": "966501234567",
    "message": "مرحباً! هذه رسالة تجريبية من Postman 🚀"
  }
  ```

### 2. إرسال ملف

**Request Details:**
- Method: `POST`
- URL: `{{base_url}}/api/send-media`
- Headers:
  ```
  X-API-Key: {{api_key}}
  X-Session-Token: {{session_token}}
  ```
- Body (form-data):
  ```
  to: 966501234567
  media: [اختر ملف من جهازك]
  caption: صورة جميلة! 📸
  ```

### 3. إرسال رسالة للمجموعة

**Request Details:**
- Method: `POST`
- URL: `{{base_url}}/api/send-group-message`
- Headers:
  ```
  X-API-Key: {{api_key}}
  X-Session-Token: {{session_token}}
  Content-Type: application/json
  ```
- Body (raw JSON):
  ```json
  {
    "groupId": "123456789@c.us",
    "message": "مرحباً بالجميع! 👋"
  }
  ```

### 4. فحص حالة الجلسة

**Request Details:**
- Method: `GET`
- URL: `{{base_url}}/api/session-status`
- Headers:
  ```
  X-API-Key: {{api_key}}
  X-Session-Token: {{session_token}}
  ```

## 🎯 أمثلة عملية

### مثال 1: إرسال رسالة ترحيب
```json
{
  "to": "966501234567",
  "message": "مرحباً! 👋\n\nهذا اختبار للـ API من Postman\n\nشكراً لك! 🙏"
}
```

### مثال 2: إرسال رسالة مع إيموجي
```json
{
  "to": "966501234567",
  "message": "🚀 تم اختبار API بنجاح!\n\n✅ الرسائل تعمل\n✅ الملفات تعمل\n✅ المجموعات تعمل\n\n🎉 كل شيء يعمل بشكل مثالي!"
}
```

### مثال 3: إرسال رسالة للمجموعة
```json
{
  "groupId": "123456789@c.us",
  "message": "🔔 إشعار مهم!\n\nتم اختبار API بنجاح من Postman\n\n📱 يمكنكم الآن إرسال رسائل عبر API\n\nشكراً لكم! 🙏"
}
```

## 🔍 اختبار الاستجابات

### الاستجابة المتوقعة للرسائل:
```json
{
  "success": true,
  "message": "تم إرسال الرسالة بنجاح",
  "messageId": "3EB0C767D123456789",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### الاستجابة المتوقعة لحالة الجلسة:
```json
{
  "success": true,
  "sessionId": "session_1",
  "status": "connected",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### الاستجابة في حالة الخطأ:
```json
{
  "success": false,
  "error": "الجلسة غير متصلة",
  "code": "SESSION_NOT_CONNECTED"
}
```

## ⚠️ الأخطاء الشائعة وحلولها

### 1. خطأ 401 - Unauthorized
**السبب:** مفتاح API أو توكن الجلسة غير صحيح
**الحل:** تحقق من صحة المفاتيح في Environment Variables

### 2. خطأ 404 - Session Not Found
**السبب:** الجلسة غير متصلة أو غير موجودة
**الحل:** تأكد من أن جلسة WhatsApp متصلة في التطبيق

### 3. خطأ 400 - Bad Request
**السبب:** بيانات الطلب غير صحيحة
**الحل:** تحقق من تنسيق JSON ووجود الحقول المطلوبة

### 4. خطأ 500 - Internal Server Error
**السبب:** خطأ في الخادم
**الحل:** تحقق من سجلات الخادم في التيرمنال

## 🧪 اختبارات إضافية

### اختبار 1: إرسال رسائل متعددة
1. أنشئ عدة طلبات لنفس النقطة النهائية
2. غيّر أرقام الهواتف والرسائل
3. أرسل الطلبات بالتتابع

### اختبار 2: اختبار الملفات المختلفة
1. جرب إرسال صور (JPG, PNG)
2. جرب إرسال مستندات (PDF, DOC)
3. جرب إرسال فيديوهات (MP4)

### اختبار 3: اختبار الأخطاء
1. أرسل طلب بدون مفتاح API
2. أرسل طلب بدون توكن الجلسة
3. أرسل طلب برقم هاتف غير صحيح

## 📊 مراقبة النتائج

### في Postman:
- تحقق من **Response Status**
- راجع **Response Body**
- تحقق من **Response Time**

### في التطبيق:
- تحقق من وصول الرسائل
- راجع سجلات API في صفحة الإدارة

### في التيرمنال:
- راقب سجلات الخادم
- تحقق من أي أخطاء

## 🎉 نصائح للاختبار

1. **ابدأ باختبار حالة الجلسة** أولاً
2. **اختبر الرسائل النصية** قبل الملفات
3. **استخدم أرقام هواتف صحيحة** للاختبار
4. **احتفظ بنسخة احتياطية** من المفاتيح
5. **اختبر في بيئة آمنة** أولاً

## 📝 سجل الاختبارات

أنشئ ملف Excel أو Google Sheets لتسجيل:

| التاريخ | النوع | النتيجة | الملاحظات |
|---------|-------|---------|-----------|
| 2024-01-15 | رسالة نصية | ✅ نجح | رسالة بسيطة |
| 2024-01-15 | ملف صورة | ✅ نجح | JPG 2MB |
| 2024-01-15 | رسالة مجموعة | ❌ فشل | الجلسة غير متصلة |

---

**ملاحظة:** تأكد من أن جلسة WhatsApp متصلة قبل اختبار API!
