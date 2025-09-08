# اختبار سريع - API Key في الرابط

## 🎯 الطريقة الجديدة (الأسهل)

الآن يمكنك استخدام API Key مباشرة في الرابط!

## 🔑 المفاتيح المطلوبة

```
API Key: wa_feb5926b862827399cd5ff96bdf489e2074194cd2a65b5d328df7b19b6af904e
Session Token: [انسخ من صفحة الجلسة]
```

## 📤 أمثلة سريعة

### 1. فحص حالة الجلسة
```
GET http://localhost:3000/api/wa_feb5926b862827399cd5ff96bdf489e2074194cd2a65b5d328df7b19b6af904e/session-status
Headers: X-Session-Token: [التوكن من صفحة الجلسة]
```

### 2. إرسال رسالة
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
Headers: X-Session-Token: [التوكن من صفحة الجلسة]
Body (form-data):
  to: 966501234567
  media: [اختر ملف]
  caption: صورة جميلة! 📸
```

## 📱 كيفية الحصول على التوكن

1. افتح `http://localhost:3000`
2. سجل دخول واذهب للداش بورد
3. اضغط على أي جلسة متصلة
4. ستجد قسم "🔑 معلومات API" في أعلى الصفحة
5. انسخ التوكن من هناك

## 🧪 اختبار في Postman

1. استورد ملف `WhatsApp_API_Simple_Collection.json`
2. عدّل المتغيرات:
   - `api_key`: wa_feb5926b862827399cd5ff96bdf489e2074194cd2a65b5d328df7b19b6af904e
   - `session_token`: [التوكن من صفحة الجلسة]
3. اختبر أي endpoint

## ✅ الاستجابة المتوقعة

```json
{
  "success": true,
  "message": "تم إرسال الرسالة بنجاح",
  "messageId": "3EB0C767D123456789",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## 🎉 ملاحظة مهمة

الآن API أصبح أسهل بكثير! فقط ضع API Key في الرابط وSession Token في الهيدر.

---

**مثال سريع:**
```
http://localhost:3000/api/YOUR_API_KEY/send-message
```













