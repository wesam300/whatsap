// نظام الترجمة المشترك لجميع الصفحات
let currentLanguage = 'ar'; // اللغة الافتراضية

const translations = {
    ar: {
        // الصفحة الرئيسية
        title: 'واتساب داشبورد',
        subtitle: 'منصة إدارة واتساب المتقدمة',
        description: 'أداة قوية لإدارة جلسات واتساب المتعددة مع واجهة سهلة الاستخدام',
        getStarted: 'ابدأ الآن',
        features: 'المميزات',
        feature1: 'إدارة جلسات متعددة',
        feature2: 'واجهة سهلة الاستخدام',
        feature3: 'أمان عالي',
        feature4: 'دعم كامل للعربية',
        
        // تسجيل الدخول
        loginTitle: 'تسجيل الدخول',
        email: 'البريد الإلكتروني',
        password: 'كلمة المرور',
        login: 'تسجيل الدخول',
        forgotPassword: 'نسيت كلمة المرور؟',
        noAccount: 'ليس لديك حساب؟',
        register: 'إنشاء حساب جديد',
        loginError: 'خطأ في تسجيل الدخول',
        invalidCredentials: 'بيانات الدخول غير صحيحة',
        
        // التسجيل
        registerTitle: 'إنشاء حساب جديد',
        fullName: 'الاسم الكامل',
        confirmPassword: 'تأكيد كلمة المرور',
        register: 'إنشاء الحساب',
        haveAccount: 'لديك حساب بالفعل؟',
        loginLink: 'تسجيل الدخول',
        registerError: 'خطأ في إنشاء الحساب',
        passwordMismatch: 'كلمات المرور غير متطابقة',
        emailExists: 'البريد الإلكتروني مستخدم بالفعل',
        
        // لوحة التحكم
        dashboardTitle: 'لوحة تحكم واتساب',
        user: 'المستخدم',
        admin: 'مدير',
        adminPanel: 'الإدارة',
        logout: 'تسجيل الخروج',
        menu: 'القائمة',
        home: 'الرئيسية',
        apiTest: 'اختبار API',
        apiDocs: 'وثائق API',
        adminPanelSidebar: 'لوحة الأدمن',
        createNewSession: 'إنشاء جلسة جديدة',
        sessionName: 'اسم الجلسة',
        sessionNamePlaceholder: 'مثال: واتساب شخصي، حساب العمل',
        createSession: 'إنشاء جلسة',
        systemTools: 'أدوات النظام',
        loadingSessions: 'جاري تحميل الجلسات...',
        noSessions: 'لا توجد جلسات بعد',
        noSessionsDesc: 'أنشئ جلسة واتساب الأولى للبدء.',
        errorLoading: 'خطأ في تحميل الجلسات',
        errorLoadingDesc: 'فشل في تحميل جلسات واتساب. يرجى إعادة تحميل الصفحة.',
        start: 'بدء',
        stop: 'إيقاف',
        openSession: 'فتح الجلسة',
        renew: 'تمديد',
        delete: 'حذف',
        created: 'تاريخ الإنشاء:',
        lastUpdated: 'آخر تحديث:',
        expires: 'انتهاء الصلاحية:',
        expired: 'منتهية',
        daysRemaining: 'يوم متبقي',
        confirmDelete: 'هل أنت متأكد من حذف هذه الجلسة؟ لا يمكن التراجع عن هذا الإجراء.',
        confirmRenew: 'هل أنت متأكد من تمديد هذه الجلسة؟',
        
        // لوحة الإدارة
        adminTitle: 'لوحة الإدارة',
        backToHome: '← العودة للرئيسية',
        adminPanelDesc: 'إدارة المستخدمين والجلسات والنظام',
        users: 'المستخدمين',
        sessions: 'الجلسات',
        packages: 'الباقات',
        settings: 'الإعدادات',
        addUser: 'إضافة مستخدم',
        bulkActions: 'إجراءات جماعية',
        addPackage: 'إضافة باقة',
        cleanupExpired: 'تنظيف الجلسات المنتهية',
        editLimits: 'حدود الجلسات',
        edit: 'تعديل',
        pause: 'إيقاف',
        resume: 'تفعيل',
        view: 'عرض',
        restart: 'إعادة تشغيل',
        confirmCleanup: 'هل أنت متأكد من تنظيف الجلسات المنتهية الصلاحية؟',
        
        // رسائل عامة
        success: 'نجح',
        error: 'خطأ',
        warning: 'تحذير',
        info: 'معلومات',
        loading: 'جاري التحميل...',
        save: 'حفظ',
        cancel: 'إلغاء',
        confirm: 'تأكيد',
        close: 'إغلاق',
        back: 'رجوع',
        next: 'التالي',
        previous: 'السابق',
        search: 'بحث',
        filter: 'تصفية',
        sort: 'ترتيب',
        refresh: 'تحديث',
        english: 'English'
    },
    en: {
        // Main page
        title: 'WhatsApp Dashboard',
        subtitle: 'Advanced WhatsApp Management Platform',
        description: 'Powerful tool for managing multiple WhatsApp sessions with an easy-to-use interface',
        getStarted: 'Get Started',
        features: 'Features',
        feature1: 'Multiple Session Management',
        feature2: 'Easy-to-use Interface',
        feature3: 'High Security',
        feature4: 'Full Arabic Support',
        
        // Login
        loginTitle: 'Login',
        email: 'Email',
        password: 'Password',
        login: 'Login',
        forgotPassword: 'Forgot Password?',
        noAccount: "Don't have an account?",
        register: 'Create New Account',
        loginError: 'Login Error',
        invalidCredentials: 'Invalid credentials',
        
        // Register
        registerTitle: 'Create New Account',
        fullName: 'Full Name',
        confirmPassword: 'Confirm Password',
        register: 'Create Account',
        haveAccount: 'Already have an account?',
        loginLink: 'Login',
        registerError: 'Registration Error',
        passwordMismatch: 'Passwords do not match',
        emailExists: 'Email already exists',
        
        // Dashboard
        dashboardTitle: 'WhatsApp Dashboard',
        user: 'User',
        admin: 'ADMIN',
        adminPanel: 'Admin',
        logout: 'Logout',
        menu: 'Menu',
        home: 'Home',
        apiTest: 'API Test',
        apiDocs: 'API Docs',
        adminPanelSidebar: 'Admin Panel',
        createNewSession: 'Create New Session',
        sessionName: 'Session Name',
        sessionNamePlaceholder: 'e.g., Personal WhatsApp, Work Account',
        createSession: 'Create Session',
        systemTools: 'System Tools',
        loadingSessions: 'Loading sessions...',
        noSessions: 'No Sessions Yet',
        noSessionsDesc: 'Create your first WhatsApp session to get started.',
        errorLoading: 'Error Loading Sessions',
        errorLoadingDesc: 'Failed to load your WhatsApp sessions. Please try refreshing the page.',
        start: 'Start',
        stop: 'Stop',
        openSession: 'Open Session',
        renew: 'Renew',
        delete: 'Delete',
        created: 'Created:',
        lastUpdated: 'Last Updated:',
        expires: 'Expires:',
        expired: 'Expired',
        daysRemaining: 'days remaining',
        confirmDelete: 'Are you sure you want to delete this session? This action cannot be undone.',
        confirmRenew: 'Are you sure you want to renew this session?',
        
        // Admin Panel
        adminTitle: 'Admin Panel',
        backToHome: '← Back to Home',
        adminPanelDesc: 'Manage users, sessions and system',
        users: 'Users',
        sessions: 'Sessions',
        packages: 'Packages',
        settings: 'Settings',
        addUser: 'Add User',
        bulkActions: 'Bulk Actions',
        addPackage: 'Add Package',
        cleanupExpired: 'Cleanup Expired Sessions',
        editLimits: 'Session Limits',
        edit: 'Edit',
        pause: 'Pause',
        resume: 'Resume',
        view: 'View',
        restart: 'Restart',
        confirmCleanup: 'Are you sure you want to cleanup expired sessions?',
        
        // General messages
        success: 'Success',
        error: 'Error',
        warning: 'Warning',
        info: 'Info',
        loading: 'Loading...',
        save: 'Save',
        cancel: 'Cancel',
        confirm: 'Confirm',
        close: 'Close',
        back: 'Back',
        next: 'Next',
        previous: 'Previous',
        search: 'Search',
        filter: 'Filter',
        sort: 'Sort',
        refresh: 'Refresh',
        english: 'العربية'
    }
};

// وظيفة تبديل اللغة
function toggleLanguage() {
    currentLanguage = currentLanguage === 'ar' ? 'en' : 'ar';
    document.documentElement.lang = currentLanguage;
    document.documentElement.dir = currentLanguage === 'ar' ? 'rtl' : 'ltr';
    
    // حفظ التفضيل في localStorage
    localStorage.setItem('language', currentLanguage);
    
    // تحديث الصفحة الحالية
    updateCurrentPage();
}

// تحديث الصفحة الحالية
function updateCurrentPage() {
    const t = translations[currentLanguage];
    
    // تحديث العنوان
    if (document.querySelector('h1')) {
        document.querySelector('h1').textContent = t[getPageTitleKey()] || t.title;
    }
    
    // تحديث زر اللغة
    const languageToggle = document.getElementById('languageToggle');
    if (languageToggle) {
        languageToggle.textContent = t.english;
    }
    
    // تحديث النصوص حسب الصفحة
    updatePageSpecificTexts(t);
}

// الحصول على مفتاح عنوان الصفحة
function getPageTitleKey() {
    const path = window.location.pathname;
    if (path.includes('login')) return 'loginTitle';
    if (path.includes('register')) return 'registerTitle';
    if (path.includes('dashboard')) return 'dashboardTitle';
    if (path.includes('admin')) return 'adminTitle';
    return 'title';
}

// تحديث النصوص الخاصة بكل صفحة
function updatePageSpecificTexts(t) {
    // تحديث جميع العناصر التي تحتوي على data-translate
    document.querySelectorAll('[data-translate]').forEach(element => {
        const key = element.getAttribute('data-translate');
        if (t[key]) {
            element.textContent = t[key];
        }
    });
    
    // تحديث placeholders
    document.querySelectorAll('[data-placeholder]').forEach(element => {
        const key = element.getAttribute('data-placeholder');
        if (t[key]) {
            element.placeholder = t[key];
        }
    });
    
    // تحديث values
    document.querySelectorAll('[data-value]').forEach(element => {
        const key = element.getAttribute('data-value');
        if (t[key]) {
            element.value = t[key];
        }
    });
}

// تحميل اللغة المحفوظة
function loadSavedLanguage() {
    const savedLanguage = localStorage.getItem('language');
    if (savedLanguage && translations[savedLanguage]) {
        currentLanguage = savedLanguage;
        document.documentElement.lang = currentLanguage;
        document.documentElement.dir = currentLanguage === 'ar' ? 'rtl' : 'ltr';
    }
}

// تهيئة الترجمة عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', function() {
    loadSavedLanguage();
    updateCurrentPage();
});

// تصدير المتغيرات للاستخدام في الصفحات الأخرى
window.currentLanguage = currentLanguage;
window.translations = translations;
window.toggleLanguage = toggleLanguage;
window.updateCurrentPage = updateCurrentPage;
