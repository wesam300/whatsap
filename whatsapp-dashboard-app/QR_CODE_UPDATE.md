# تحديث نظام QR Code

## المشكلة
عندما يقوم المستخدم بتسجيل الخروج أو فصل الجلسة ثم يعيد بدء الجلسة مرة أخرى، كان يتم عرض QR code القديم بدلاً من إنشاء QR code جديد.

## الحل المطبق

### 1. حذف الجلسة القديمة عند إعادة البدء
- عند إعادة بدء الجلسة (`start_session`)، يتم حذف بيانات الجلسة القديمة من LocalAuth
- هذا يضمن إنشاء QR code جديد دائماً عند إعادة البدء

### 2. إضافة Timestamp للQR Code
- تم إضافة عمود `qr_timestamp` في قاعدة البيانات لتتبع وقت إنشاء QR code
- يمكن استخدام هذا لتحديد ما إذا كان QR code قد انتهت صلاحيته

### 3. مسح QR Code عند إيقاف الجلسة
- عند إيقاف الجلسة (`stop_session`)، يتم مسح QR code من قاعدة البيانات
- هذا يضمن عدم عرض QR code قديم عند إعادة البدء

## التغييرات التقنية

### في `server.js`:

1. **إضافة استيراد `fs`**:
```javascript
const fs = require('fs').promises;
```

2. **تعديل `start_session`**:
   - التحقق من وجود جلسة نشطة وإيقافها أولاً
   - حذف بيانات الجلسة القديمة إذا كانت منفصلة أو فشل التحقق
   - مسح QR code القديم من قاعدة البيانات

3. **تعديل `qr` event handler**:
   - إضافة timestamp عند إنشاء QR code
   - حفظ timestamp في قاعدة البيانات

4. **تعديل `stop_session`**:
   - مسح QR code و timestamp عند إيقاف الجلسة

### في `db.js`:

1. **إضافة عمود `qr_timestamp`**:
```sql
ALTER TABLE sessions ADD COLUMN qr_timestamp DATETIME
```

## كيفية الاستخدام

### إعادة بدء الجلسة مع QR جديد:
```javascript
socket.emit('start_session', { 
    sessionId: 'your-session-id',
    forceNewQR: true  // اختياري - لإجبار إنشاء QR جديد
});
```

### التحقق من timestamp QR code:
```javascript
const session = db.prepare('SELECT qr_code, qr_timestamp FROM sessions WHERE id = ?').get(sessionId);
if (session.qr_timestamp) {
    const qrAge = Date.now() - new Date(session.qr_timestamp).getTime();
    const qrAgeSeconds = Math.floor(qrAge / 1000);
    console.log(`QR code age: ${qrAgeSeconds} seconds`);
    
    // QR code في WhatsApp Web ينتهي صلاحيته بعد حوالي 20 ثانية
    if (qrAgeSeconds > 20) {
        console.log('QR code expired, need to refresh');
    }
}
```

## ملاحظات مهمة

1. **QR Code Expiry**: QR code في WhatsApp Web ينتهي صلاحيته بعد حوالي 20 ثانية
2. **Session Data**: عند حذف بيانات الجلسة، سيحتاج المستخدم للمسح مرة أخرى
3. **Performance**: حذف الجلسة القديمة قد يستغرق بضع ثوانٍ

## التحقق من الإصلاح

بعد تطبيق التغييرات:

1. ابدأ جلسة جديدة
2. توقف عن الجلسة
3. أعد بدء الجلسة
4. يجب أن يظهر QR code جديد (ليس القديم)

## استكشاف الأخطاء

إذا ظهر QR code قديم:

1. تحقق من أن الجلسة القديمة تم حذفها:
```bash
ls -la sessions/session_<sessionId>/
```

2. تحقق من قاعدة البيانات:
```sql
SELECT qr_code, qr_timestamp FROM sessions WHERE id = <sessionId>;
```

3. تحقق من السجلات:
```bash
pm2 logs whatsapp-dashboard --lines 50
```

