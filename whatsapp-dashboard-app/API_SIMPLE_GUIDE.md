# دليل API المبسط - API Key في الرابط

## 🎯 الطريقة الجديدة (الأسهل)

الآن يمكنك استخدام API Key مباشرة في الرابط بدلاً من الهيدر!

## 🔑 المفاتيح المطلوبة

```
API Key: wa_feb5926b862827399cd5ff96bdf489e2074194cd2a65b5d328df7b19b6af904e
Session Token: [انسخ من صفحة الجلسة]
```

## 📤 المسارات الجديدة (مع API Key في الرابط)

### 1. فحص حالة الجلسة
```
GET http://localhost:3000/api/wa_feb5926b862827399cd5ff96bdf489e2074194cd2a65b5d328df7b19b6af904e/session-status
Headers:
  X-Session-Token: [التوكن من صفحة الجلسة]
```

### 2. إرسال رسالة نصية
```
POST http://localhost:3000/api/wa_feb5926b862827399cd5ff96bdf489e2074194cd2a65b5d328df7b19b6af904e/send-message
Headers:
  X-Session-Token: [التوكن من صفحة الجلسة]
  Content-Type: application/json
Body:
{
  "to": "966501234567",
  "message": "مرحباً! هذا اختبار من Postman 🚀"
}
```

### 3. إرسال ملف
```
POST http://localhost:3000/api/wa_feb5926b862827399cd5ff96bdf489e2074194cd2a65b5d328df7b19b6af904e/send-media
Headers:
  X-Session-Token: [التوكن من صفحة الجلسة]
Body (form-data):
  to: 966501234567
  media: [اختر ملف من جهازك]
  caption: صورة جميلة! 📸
```

### 4. إرسال رسالة للمجموعة
```
POST http://localhost:3000/api/wa_feb5926b862827399cd5ff96bdf489e2074194cd2a65b5d328df7b19b6af904e/send-group-message
Headers:
  X-Session-Token: [التوكن من صفحة الجلسة]
  Content-Type: application/json
Body:
{
  "groupId": "123456789@c.us",
  "message": "مرحباً بالجميع! 👋"
}
```

### 5. الحصول على توكن جلسة محددة
```
GET http://localhost:3000/api/wa_feb5926b862827399cd5ff96bdf489e2074194cd2a65b5d328df7b19b6af904e/session/123/token
```

## 🧪 أمثلة في Postman

### مثال 1: إرسال رسالة بسيطة
```
URL: http://localhost:3000/api/wa_feb5926b862827399cd5ff96bdf489e2074194cd2a65b5d328df7b19b6af904e/send-message
Method: POST
Headers:
  X-Session-Token: st_ed55a2e0dae97d919c900e68eaeefb348c589d58eecbdebf
  Content-Type: application/json
Body:
{
  "to": "966501234567",
  "message": "مرحباً! هذا اختبار من Postman 🚀"
}
```

### مثال 2: فحص حالة الجلسة
```
URL: http://localhost:3000/api/wa_feb5926b862827399cd5ff96bdf489e2074194cd2a65b5d328df7b19b6af904e/session-status
Method: GET
Headers:
  X-Session-Token: st_ed55a2e0dae97d919c900e68eaeefb348c589d58eecbdebf
```

## ✅ الاستجابات المتوقعة

### نجح:
```json
{
  "success": true,
  "message": "تم إرسال الرسالة بنجاح",
  "messageId": "3EB0C767D123456789",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### خطأ:
```json
{
  "success": false,
  "error": "الجلسة غير موجودة أو غير متصلة",
  "code": "SESSION_NOT_FOUND"
}
```

## 🔧 مزايا الطريقة الجديدة

1. **أسهل في الاستخدام**: API Key في الرابط مباشرة
2. **أقل تعقيداً**: لا حاجة لإضافة API Key في الهيدر
3. **أكثر وضوحاً**: يمكن رؤية API Key في الرابط
4. **متوافق مع الطريقة القديمة**: الطريقة القديمة لا تزال تعمل

## 📱 كيفية الحصول على التوكن

1. افتح `http://localhost:3000`
2. سجل دخول واذهب للداش بورد
3. اضغط على أي جلسة متصلة
4. ستجد قسم "🔑 معلومات API" في أعلى الصفحة
5. انسخ التوكن من هناك

## 🎉 ملاحظة مهمة

الآن يمكنك استخدام API بسهولة أكبر! فقط ضع API Key في الرابط وSession Token في الهيدر.

---

**مثال سريع:**
```
http://localhost:3000/api/YOUR_API_KEY/send-message
```

بدلاً من:
```
http://localhost:3000/api/send-message
Headers: X-API-Key: YOUR_API_KEY
```













