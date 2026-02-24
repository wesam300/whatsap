# تعليمات النشر إلى السيرفر (Linux)

**مهم:** السيرفر يجب أن يعمل بنفس الكود الموجود في هذا المجلد. إذا ظهرت أخطاء مثل `trust proxy is false` أو `Bad control character` أو `authenticated fallback` أو `browser is already running` فغالباً السيرفر يعمل بنسخة قديمة.

## 1. نسخ الملفات المحدثة إلى السيرفر

من جهازك (Windows) انسخ هذه الملفات إلى `/var/www/whatsap/whatsapp-dashboard-app/` على السيرفر (استبدل المسار إذا كان مختلفاً):

- `server.js`
- `api-routes.js`
- `session-manager.js`

يمكنك استخدام SCP أو SFTP أو Git:

```bash
# مثال باستخدام scp من جهازك:
scp server.js api-routes.js session-manager.js root@srv998477:/var/www/whatsap/whatsapp-dashboard-app/
```

أو إذا المشروع من Git على السيرفر:

```bash
cd /var/www/whatsap/whatsapp-dashboard-app
git pull
# أو استبدال الملفات يدوياً من نسختك المحلية
```

## 2. إعداد متغيرات البيئة (إن لم تكن مضبوطة)

على السيرفر:

```bash
export SESSION_SECRET="سري-قوي-وفريد-للسيرفر"
# أو ضعها في ملف .env أو في systemd/pm2 ecosystem
```

لـ PM2 يمكن إنشاء ملف `ecosystem.config.cjs` أو تعيين المتغيرات عند التشغيل:

```bash
SESSION_SECRET=your-secret pm2 start server.js --name whatsapp-dashboard
```

## 3. قتل أي متصفحات قديمة عالقة (مهم قبل أول تشغيل بعد التحديث وعند ظهور "browser is already running")

```bash
pkill -f "session-session_" || true
sleep 3
```

إذا حذفت جلسة ثم أنشأت جلسة جديدة وظهر "browser is already running"، نفّذ الأمر أعلاه ثم أعد تشغيل PM2 ثم جرّب بدء الجلسة مرة أخرى.

## 4. إعادة تشغيل التطبيق

```bash
cd /var/www/whatsap/whatsapp-dashboard-app
pm2 restart whatsapp-dashboard
# أو
pm2 delete whatsapp-dashboard
pm2 start server.js --name whatsapp-dashboard
```

## 5. التحقق من السجلات

```bash
pm2 logs whatsapp-dashboard --lines 50
```

يجب أن ترى:
- **لا** `trust proxy is false`
- **لا** `authenticated fallback` (بعد الإصلاحات)
- عند بدء التشغيل قد يظهر تحذير `SESSION_SECRET` إذا لم يُضبط — ضبطه يزيل التحذير

## ملخص الإصلاحات المطبقة في الكود

| المشكلة | الحل في الكود |
|--------|----------------|
| X-Forwarded-For / trust proxy | `app.set('trust proxy', 1)` |
| Bad control character في JSON | محلول JSON يقرأ الجسم، ينظف أحرف التحكم، ثم يحلل قبل أي middleware آخر |
| مسار /api//wa_xxx | middleware يوحّد الشرطات في المسار |
| getChatModel / authenticated fallback | إلغاء getChats من حدث authenticated؛ جلب البيانات فقط عند ready مع تأخير آمن في get_session_data |
| browser is already running | cleanupSessionFolder + killChromeProcessesForSession قبل كل بدء جلسة؛ قفل sessionStartLocks |
| انتهت مهلة الإرسال | رفع المهلة إلى 45 ثانية في api-routes |
| autoRestartSession فشل | استخدام killChromeProcessesForSession وحذف ملفات القفل و authTimeoutMs في api-routes |
| SESSION_NOT_FOUND والجلسة ظاهرة authenticated | عند بدء التشغيل نستعيد أيضاً الجلسات ذات الحالة `authenticated` (لم تصل بعد لـ ready) حتى تصبح متصلة ويمكن الإرسال منها |

بعد النشر: `git pull` ثم إعادة تشغيل PM2 (ويفضل قتل عمليات Chrome العالقة قبلها كما في القسم 3).
