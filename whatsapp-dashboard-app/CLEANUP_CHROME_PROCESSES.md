# تنظيف عمليات Chrome المتبقية

## المشكلة
بعد رفع التحديث، قد تبقى عمليات Chrome/Chromium تعمل في الخلفية للجلسات التي انتهت أو توقفت أو حُذفت، مما يسبب استهلاك RAM.

## الحلول المتاحة

### 1. السكريبت التلقائي (مدمج في الخادم)
الخادم يقوم بتنظيف تلقائي كل 30 دقيقة. لا حاجة لتدخل يدوي.

### 2. السكريبت اليدوي (Node.js)

#### Windows:
```bash
cd whatsapp-dashboard-app
node cleanup-chrome-processes.js
```

#### Linux/Mac:
```bash
cd whatsapp-dashboard-app
node cleanup-chrome-processes.js
```

### 3. السكريبت السريع (Shell/Batch)

#### Windows:
```bash
cleanup-chrome-processes.bat
```

#### Linux/Mac:
```bash
chmod +x cleanup-chrome-processes.sh
./cleanup-chrome-processes.sh
```

## ما يقوم به السكريبت

1. ✅ يفحص قاعدة البيانات للجلسات النشطة
2. ✅ يحدّث الجلسات المنتهية أو المنفصلة
3. ✅ يبحث عن عمليات Chrome/Chromium النشطة
4. ✅ يغلق العمليات المتبقية (التي لا تنتمي لجلسات نشطة)

## ملاحظات مهمة

⚠️ **تحذير**: السكريبت يغلق فقط العمليات التي لا تنتمي لجلسات نشطة. الجلسات النشطة لن تتأثر.

✅ **آمن**: السكريبت آمن ولا يحذف أي بيانات من قاعدة البيانات.

## إضافة إلى Cron Job (Linux/Mac)

لتنظيف تلقائي كل ساعة:

```bash
# فتح crontab
crontab -e

# إضافة السطر التالي (يستبدل المسار بالمسار الصحيح)
0 * * * * cd /var/www/whatsap/whatsapp-dashboard-app && node cleanup-chrome-processes.js >> /var/log/chrome-cleanup.log 2>&1
```

## إضافة إلى Task Scheduler (Windows)

1. افتح Task Scheduler
2. أنشئ مهمة جديدة
3. اضبطها لتشغيل `cleanup-chrome-processes.bat` كل ساعة

## التحقق من النتيجة

بعد تشغيل السكريبت، يمكنك التحقق من:

```bash
# Windows
tasklist | findstr chrome.exe

# Linux/Mac
ps aux | grep chrome
```

إذا لم تظهر أي عمليات Chrome (باستثناء الجلسات النشطة)، فالسكريبت نجح.

## استكشاف الأخطاء

### المشكلة: السكريبت لا يغلق العمليات
- تأكد من تشغيل السكريبت كمسؤول (Administrator/Root)
- تحقق من أن المسار صحيح

### المشكلة: عمليات Chrome تعود بعد إغلاقها
- هذا طبيعي إذا كانت هناك جلسات نشطة
- الجلسات النشطة تفتح عمليات Chrome تلقائياً

## نصائح إضافية

1. **بعد حذف جلسة**: السكريبت التلقائي سينظف العمليات خلال 30 دقيقة
2. **بعد إيقاف جلسة**: استخدم `destroyClientCompletely` في الكود (تم إضافته)
3. **للتنظيف الفوري**: شغّل السكريبت اليدوي

