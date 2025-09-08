# دليل اختبار API محدث - المشاكل والحلول

## 🎯 المشاكل التي تم حلها

### 1. **مشكلة في middleware**
- تم إصلاح `validateApiKey` و `validateSessionToken` لإرجاع `id`
- تم إصلاح middleware لإضافة `apiKeyId` و `id` للمعلومات

### 2. **مشكلة في المسارات**
- تم إضافة مسارات اختبار بسيطة
- تم إصلاح جميع المسارات المكررة

### 3. **صفحة اختبار في الموقع**
- تم إنشاء صفحة اختبار API مباشرة في الموقع
- يمكنك اختبار API بدون Postman

## 🔧 كيفية الاختبار

### الطريقة 1: من الموقع (الأسهل)
1. افتح `http://localhost:3000`
2. سجل دخول واذهب للداش بورد
3. اضغط على "🧪 اختبار API"
4. ستجد جميع الاختبارات جاهزة

### الطريقة 2: من Postman

#### اختبار الاتصال:
```
GET http://localhost:3000/api/test
```

#### اختبار API Key:
```
GET http://localhost:3000/api/wa_feb5926b862827399cd5ff96bdf489e2074194cd2a65b5d328df7b19b6af904e/test
```

#### اختبار حالة الجلسة:
```
GET http://localhost:3000/api/wa_feb5926b862827399cd5ff96bdf489e2074194cd2a65b5d328df7b19b6af904e/session-status
Headers:
  X-Session-Token: st_0771f6beedfe5a7048734a8cecb7ec57c2ed0fe082458a12
```

#### إرسال رسالة:
```
POST http://localhost:3000/api/wa_feb5926b862827399cd5ff96bdf489e2074194cd2a65b5d328df7b19b6af904e/send-message
Headers:
  X-Session-Token: st_0771f6beedfe5a7048734a8cecb7ec57c2ed0fe082458a12
  Content-Type: application/json
Body:
{
  "to": "967772000992",
  "message": "ihkhkhk"
}
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

### خطأ 400 (بيانات مفقودة):
```json
{
  "success": false,
  "error": "رقم الهاتف والرسالة مطلوبان",
  "code": "MISSING_PARAMETERS"
}
```

### خطأ 401 (مفتاح غير صحيح):
```json
{
  "success": false,
  "error": "مفتاح API غير صحيح",
  "code": "INVALID_API_KEY"
}
```

### خطأ 404 (جلسة غير موجودة):
```json
{
  "success": false,
  "error": "الجلسة غير موجودة أو غير متصلة",
  "code": "SESSION_NOT_FOUND"
}
```

## 🔍 نصائح مهمة

1. **تأكد من اتصال الجلسة** قبل الاختبار
2. **استخدم البيانات في Body** وليس في query parameters
3. **Content-Type يجب أن يكون application/json**
4. **Body يجب أن يكون JSON** وليس form-data
5. **اختبر الاتصال أولاً** للتأكد من أن API يعمل

## 📱 المفاتيح المطلوبة

```
API Key: wa_feb5926b862827399cd5ff96bdf489e2074194cd2a65b5d328df7b19b6af904e
Session Token: st_0771f6beedfe5a7048734a8cecb7ec57c2ed0fe082458a12
```

## 🎉 ملاحظة مهمة

الآن يمكنك اختبار API بسهولة من الموقع مباشرة! فقط اذهب للداش بورد واضغط على "🧪 اختبار API".

---

**إذا استمرت المشكلة:**
1. تأكد من أن الخادم يعمل
2. تأكد من أن الجلسة متصلة
3. استخدم صفحة الاختبار في الموقع
4. تحقق من الأخطاء في console المتصفح













