# اختبار سريع لـ API في Postman

## 🚀 خطوات سريعة للاختبار

### 1. الحصول على المفاتيح
1. افتح `http://localhost:3000`
2. سجل دخول واذهب لـ "🔑 إدارة API"
3. انسخ مفتاح API وتوكن الجلسة

### 2. إنشاء طلب في Postman

#### **اختبار 1: فحص حالة الجلسة**
```
Method: GET
URL: http://localhost:3000/api/session-status
Headers:
  X-API-Key: [مفتاح API الخاص بك]
  X-Session-Token: [توكن الجلسة الخاص بك]
```

#### **اختبار 2: إرسال رسالة نصية**
```
Method: POST
URL: http://localhost:3000/api/send-message
Headers:
  X-API-Key: [مفتاح API الخاص بك]
  X-Session-Token: [توكن الجلسة الخاص بك]
  Content-Type: application/json
Body (raw JSON):
{
  "to": "966501234567",
  "message": "مرحباً! هذا اختبار من Postman 🚀"
}
```

#### **اختبار 3: إرسال ملف**
```
Method: POST
URL: http://localhost:3000/api/send-media
Headers:
  X-API-Key: [مفتاح API الخاص بك]
  X-Session-Token: [توكن الجلسة الخاص بك]
Body (form-data):
  to: 966501234567
  media: [اختر ملف من جهازك]
  caption: صورة جميلة! 📸
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
  "error": "الجلسة غير متصلة",
  "code": "SESSION_NOT_CONNECTED"
}
```

## ⚠️ نصائح مهمة

1. **تأكد من اتصال جلسة WhatsApp** قبل الاختبار
2. **استخدم أرقام هواتف صحيحة** للاختبار
3. **ابدأ بفحص حالة الجلسة** أولاً
4. **راجع سجلات التيرمنال** إذا واجهت مشاكل

## 🔧 استيراد Collection جاهز

1. افتح Postman
2. اضغط "Import"
3. اختر ملف `WhatsApp_API_Collection.json`
4. عدّل المتغيرات في Environment

---

**ملاحظة:** تأكد من أن الخادم يعمل على `http://localhost:3000`















