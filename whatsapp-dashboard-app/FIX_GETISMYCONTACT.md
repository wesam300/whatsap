# إصلاح خطأ getIsMyContact

## المشكلة
```
TypeError: window.Store.ContactMethods.getIsMyContact is not a function
```

هذا الخطأ يحدث لأن WhatsApp Web غير واجهة برمجة التطبيقات (API) الخاصة به، والدالة `getIsMyContact` لم تعد موجودة في بعض الإصدارات.

## الحل

### الطريقة 1: استخدام Script Node.js (موصى به)

على الخادم، قم بتنفيذ:

```bash
cd /var/www/whatsap/whatsapp-dashboard-app
node fix-getIsMyContact.js
pm2 restart whatsapp-dashboard
```

### الطريقة 2: استخدام Script Bash

```bash
cd /var/www/whatsap/whatsapp-dashboard-app
chmod +x fix-getIsMyContact.sh
./fix-getIsMyContact.sh
pm2 restart whatsapp-dashboard
```

### الطريقة 3: التعديل اليدوي

1. افتح الملف:
```bash
nano /var/www/whatsap/whatsapp-dashboard-app/node_modules/whatsapp-web.js/src/util/Injected/Utils.js
```

2. ابحث عن السطر:
```javascript
res.isMyContact = window.Store.ContactMethods.getIsMyContact(contact);
```

3. استبدله بـ:
```javascript
// Helper function to safely get ContactMethods values with fallback
const safeGet = (methodName, fallback) => {
    try {
        if (window.Store.ContactMethods && typeof window.Store.ContactMethods[methodName] === 'function') {
            return window.Store.ContactMethods[methodName](contact);
        }
    } catch (e) {
        // Method doesn't exist, use fallback
    }
    return fallback !== undefined ? fallback : false;
};

res.isMe = safeGet('getIsMe', contact.isMe);
res.isUser = safeGet('getIsUser', contact.isUser);
res.isGroup = safeGet('getIsGroup', contact.isGroup);
res.isWAContact = safeGet('getIsWAContact', contact.isWAContact);
res.isMyContact = safeGet('getIsMyContact', contact.isMyContact);
res.isBlocked = contact.isContactBlocked;
res.userid = safeGet('getUserid', contact.userid);
res.isEnterprise = safeGet('getIsEnterprise', contact.isEnterprise);
res.verifiedName = safeGet('getVerifiedName', contact.verifiedName);
res.verifiedLevel = safeGet('getVerifiedLevel', contact.verifiedLevel);
res.statusMute = safeGet('getStatusMute', contact.statusMute);
res.name = safeGet('getName', contact.name);
res.shortName = safeGet('getShortName', contact.shortName);
res.pushname = safeGet('getPushname', contact.pushname);
```

4. احفظ الملف وأعد تشغيل التطبيق:
```bash
pm2 restart whatsapp-dashboard
```

## ملاحظات مهمة

⚠️ **تحذير**: هذا الإصلاح في `node_modules` سيضيع عند تشغيل `npm install` مرة أخرى.

### للحفاظ على الإصلاح بشكل دائم:

1. استخدم `patch-package`:
```bash
npm install patch-package --save-dev
# بعد تطبيق الإصلاح
npx patch-package whatsapp-web.js
```

2. أضف في `package.json`:
```json
"scripts": {
  "postinstall": "patch-package"
}
```

## التحقق من الإصلاح

بعد تطبيق الإصلاح وإعادة التشغيل، تحقق من السجلات:
```bash
pm2 logs whatsapp-dashboard --lines 50
```

يجب ألا يظهر خطأ `getIsMyContact` بعد الآن.

