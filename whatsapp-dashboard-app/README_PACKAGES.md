# نظام الباقات والاشتراكات - WhatsApp Dashboard

## الميزات الجديدة

### 1. نظام الباقات الديناميكي
- **إدارة الباقات**: يمكن للأدمن إنشاء وتعديل وحذف الباقات
- **خصائص الباقات**: كل باقة تحتوي على:
  - اسم ووصف
  - سعر وعملة
  - مدة الباقة بالأيام
  - الحد الأقصى للجلسات
  - قائمة المميزات

### 2. نظام الاشتراكات
- **إدارة الاشتراكات**: المستخدمون يمكنهم الاشتراك في الباقات
- **حالة الاشتراك**: تتبع حالة الاشتراك (نشط، منتهي، في الانتظار)
- **تاريخ الاشتراك**: تتبع تاريخ البداية والانتهاء
- **سجل الاشتراكات**: عرض جميع اشتراكات المستخدم السابقة

### 3. نظام التنبيهات المخصصة
- **بديل عن alert المتصفح**: نظام تنبيهات جميل ومخصص
- **أنواع التنبيهات**:
  - نجاح (أخضر)
  - خطأ (أحمر)
  - تحذير (أصفر)
  - معلومات (أزرق)
  - تأكيد (مع أزرار)
  - تقدم (للعمليات الطويلة)

### 4. إعدادات النظام
- **معلومات التواصل**: رقم هاتف الأدمن، البريد الإلكتروني، واتساب الدعم
- **معلومات الشركة**: اسم الشركة والعنوان
- **الشروط والأحكام**: سياسة الخصوصية والشروط

## الصفحات الجديدة

### 1. صفحة إدارة الباقات (`/packages`)
- **للأدمن فقط**
- إضافة وتعديل وحذف الباقات
- عرض إحصائيات الاشتراكات
- إدارة إعدادات النظام

### 2. صفحة الباقات والاشتراكات (`/subscriptions`)
- **لجميع المستخدمين**
- عرض الباقات المتاحة
- الاشتراك في الباقات
- عرض حالة الاشتراك الحالي
- سجل الاشتراكات السابقة
- معلومات التواصل مع الدعم

## API الجديدة

### الباقات
- `GET /api/packages` - جلب جميع الباقات
- `GET /api/packages/:id` - جلب باقة محددة

### الاشتراكات
- `POST /api/subscriptions` - إنشاء اشتراك جديد
- `GET /api/subscriptions` - جلب اشتراكات المستخدم
- `GET /api/subscription/status` - حالة الاشتراك الحالي

### إعدادات النظام
- `GET /api/system/settings` - جلب إعدادات النظام

### APIs للأدمن
- `POST /api/admin/packages` - إنشاء باقة جديدة
- `PUT /api/admin/packages/:id` - تعديل باقة
- `DELETE /api/admin/packages/:id` - حذف باقة
- `PUT /api/admin/system/settings` - تحديث إعدادات النظام
- `GET /api/admin/stats` - إحصائيات النظام

## قاعدة البيانات الجديدة

### جدول الباقات (`packages`)
```sql
CREATE TABLE packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    currency TEXT DEFAULT 'USD',
    duration_days INTEGER NOT NULL,
    max_sessions INTEGER NOT NULL,
    features TEXT, -- JSON array
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### جدول الاشتراكات (`user_subscriptions`)
```sql
CREATE TABLE user_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    package_id INTEGER NOT NULL,
    start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_date DATETIME NOT NULL,
    status TEXT DEFAULT 'active',
    payment_status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (package_id) REFERENCES packages (id)
);
```

### جدول إعدادات النظام (`system_settings`)
```sql
CREATE TABLE system_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    admin_phone TEXT,
    admin_email TEXT,
    support_whatsapp TEXT,
    company_name TEXT,
    company_address TEXT,
    terms_conditions TEXT,
    privacy_policy TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## كيفية الاستخدام

### للأدمن
1. تسجيل الدخول بحساب الأدمن
2. الذهاب إلى "إدارة الباقات" من لوحة التحكم
3. إنشاء الباقات المطلوبة مع تحديد:
   - السعر والمدة
   - عدد الجلسات المسموحة
   - المميزات المقدمة
4. تحديث إعدادات النظام (معلومات التواصل)

### للمستخدمين
1. تسجيل الدخول
2. الذهاب إلى "الباقات والاشتراكات"
3. اختيار الباقة المناسبة
4. تأكيد الاشتراك
5. التواصل مع الدعم لإتمام الدفع

## الملفات الجديدة

- `package-manager.js` - إدارة الباقات والاشتراكات
- `notification-system.js` - نظام التنبيهات المخصصة
- `public/packages.html` - صفحة إدارة الباقات
- `public/subscriptions.html` - صفحة الباقات والاشتراكات

## التحديثات على الملفات الموجودة

- `db.js` - إضافة جداول قاعدة البيانات الجديدة
- `api-routes.js` - إضافة مسارات API الجديدة
- `server.js` - إضافة مسارات الصفحات الجديدة
- `dashboard.html` - إضافة روابط للصفحات الجديدة

## ملاحظات مهمة

1. **الأمان**: جميع APIs الجديدة محمية بالتحقق من الصلاحيات
2. **التوافق**: النظام متوافق مع النظام الحالي
3. **الأداء**: تم إضافة فهارس لقاعدة البيانات لتحسين الأداء
4. **التجربة**: نظام التنبيهات يحسن تجربة المستخدم بشكل كبير
5. **المرونة**: يمكن للأدمن تعديل الباقات والإعدادات بسهولة
