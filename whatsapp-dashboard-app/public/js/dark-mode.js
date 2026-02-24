// Dark Mode System
class DarkMode {
    constructor() {
        this.isDark = localStorage.getItem('darkMode') === 'true';
        this.init();
    }

    init() {
        // تطبيق الوضع الحالي
        this.applyTheme();
        
        // إضافة toggle button إذا لم يكن موجوداً
        this.addToggleButton();
    }

    applyTheme() {
        if (this.isDark) {
            document.documentElement.setAttribute('data-theme', 'dark');
            document.body.classList.add('dark-mode');
        } else {
            document.documentElement.setAttribute('data-theme', 'light');
            document.body.classList.remove('dark-mode');
        }
    }

    toggle() {
        this.isDark = !this.isDark;
        localStorage.setItem('darkMode', this.isDark);
        this.applyTheme();
        
        // إشعار
        if (typeof toast !== 'undefined') {
            toast.info(this.isDark ? 'تم تفعيل الوضع الداكن' : 'تم تفعيل الوضع الفاتح');
        }
    }

    addToggleButton() {
        // البحث عن navbar أو header
        const navbar = document.querySelector('.navbar') || document.querySelector('header');
        if (!navbar) return;

        // التحقق من وجود الزر
        if (document.getElementById('dark-mode-toggle')) return;

        const toggle = document.createElement('button');
        toggle.id = 'dark-mode-toggle';
        toggle.className = 'dark-mode-toggle';
        toggle.innerHTML = this.isDark ? '☀️' : '🌙';
        toggle.title = this.isDark ? 'الوضع الفاتح' : 'الوضع الداكن';
        toggle.onclick = () => this.toggle();

        // إضافة للـ navbar
        const userInfo = navbar.querySelector('.user-info') || navbar.querySelector('.nav-actions');
        if (userInfo) {
            userInfo.insertBefore(toggle, userInfo.firstChild);
        } else {
            navbar.appendChild(toggle);
        }
    }
}

// تهيئة Dark Mode
const darkMode = new DarkMode();

