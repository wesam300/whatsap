class NotificationSystem {
    constructor() {
        this.notifications = [];
        this.notificationId = 0;
        this.init();
    }

    init() {
        // إنشاء عنصر حاوية التنبيهات إذا لم يكن موجوداً
        if (!document.getElementById('notification-container')) {
            const container = document.createElement('div');
            container.id = 'notification-container';
            container.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 9999;
                max-width: 400px;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            `;
            document.body.appendChild(container);
        }
    }

    // إظهار تنبيه نجاح
    success(message, title = 'نجح', duration = 5000) {
        this.show({
            type: 'success',
            title: title,
            message: message,
            duration: duration,
            icon: '✓'
        });
    }

    // إظهار تنبيه خطأ
    error(message, title = 'خطأ', duration = 7000) {
        this.show({
            type: 'error',
            title: title,
            message: message,
            duration: duration,
            icon: '✗'
        });
    }

    // إظهار تنبيه تحذير
    warning(message, title = 'تحذير', duration = 6000) {
        this.show({
            type: 'warning',
            title: title,
            message: message,
            duration: duration,
            icon: '⚠'
        });
    }

    // إظهار تنبيه معلومات
    info(message, title = 'معلومات', duration = 5000) {
        this.show({
            type: 'info',
            title: title,
            message: message,
            duration: duration,
            icon: 'ℹ'
        });
    }

    // إظهار تنبيه تأكيد
    confirm(message, title = 'تأكيد', onConfirm, onCancel) {
        this.show({
            type: 'confirm',
            title: title,
            message: message,
            duration: 0, // لا يختفي تلقائياً
            icon: '?',
            onConfirm: onConfirm,
            onCancel: onCancel
        });
    }

    // إظهار تنبيه تقدم
    progress(message, title = 'جاري التحميل...') {
        const id = this.show({
            type: 'progress',
            title: title,
            message: message,
            duration: 0,
            icon: '⏳'
        });
        return id;
    }

    // إخفاء تنبيه التقدم
    hideProgress(id) {
        this.hide(id);
    }

    // إظهار التنبيه
    show(options) {
        const id = ++this.notificationId;
        const notification = this.createNotificationElement(id, options);
        
        const container = document.getElementById('notification-container');
        container.appendChild(notification);

        // إضافة التنبيه إلى المصفوفة
        this.notifications.push({ id, element: notification, options });

        // إخفاء تلقائي إذا كان duration > 0
        if (options.duration > 0) {
            setTimeout(() => {
                this.hide(id);
            }, options.duration);
        }

        return id;
    }

    // إخفاء التنبيه
    hide(id) {
        const notification = this.notifications.find(n => n.id === id);
        if (notification) {
            notification.element.style.transform = 'translateX(100%)';
            notification.element.style.opacity = '0';
            
            setTimeout(() => {
                if (notification.element.parentNode) {
                    notification.element.parentNode.removeChild(notification.element);
                }
                this.notifications = this.notifications.filter(n => n.id !== id);
            }, 300);
        }
    }

    // إخفاء جميع التنبيهات
    hideAll() {
        this.notifications.forEach(notification => {
            this.hide(notification.id);
        });
    }

    // إنشاء عنصر التنبيه
    createNotificationElement(id, options) {
        const notification = document.createElement('div');
        notification.className = `notification notification-${options.type}`;
        notification.style.cssText = `
            background: ${this.getBackgroundColor(options.type)};
            color: ${this.getTextColor(options.type)};
            border: 1px solid ${this.getBorderColor(options.type)};
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 10px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            transform: translateX(100%);
            opacity: 0;
            transition: all 0.3s ease;
            direction: rtl;
            text-align: right;
            min-width: 300px;
            max-width: 400px;
        `;

        // إضافة المحتوى
        notification.innerHTML = `
            <div style="display: flex; align-items: flex-start; gap: 12px;">
                <div style="
                    font-size: 20px;
                    font-weight: bold;
                    color: ${this.getIconColor(options.type)};
                    min-width: 24px;
                    text-align: center;
                ">${options.icon}</div>
                <div style="flex: 1;">
                    <div style="
                        font-weight: bold;
                        font-size: 16px;
                        margin-bottom: 4px;
                        color: ${this.getTitleColor(options.type)};
                    ">${options.title}</div>
                    <div style="
                        font-size: 14px;
                        line-height: 1.4;
                        color: ${this.getTextColor(options.type)};
                    ">${options.message}</div>
                    ${options.type === 'confirm' ? this.createConfirmButtons(id, options) : ''}
                </div>
                <button onclick="notificationSystem.hide(${id})" style="
                    background: none;
                    border: none;
                    color: ${this.getTextColor(options.type)};
                    font-size: 18px;
                    cursor: pointer;
                    padding: 0;
                    margin: 0;
                    opacity: 0.7;
                    transition: opacity 0.2s;
                " onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'">×</button>
            </div>
        `;

        // إظهار التنبيه مع انيميشن
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
            notification.style.opacity = '1';
        }, 10);

        return notification;
    }

    // إنشاء أزرار التأكيد
    createConfirmButtons(id, options) {
        return `
            <div style="
                display: flex;
                gap: 8px;
                margin-top: 12px;
                justify-content: flex-end;
            ">
                <button onclick="notificationSystem.hide(${id}); ${options.onCancel ? options.onCancel() : ''}" style="
                    background: #6c757d;
                    color: white;
                    border: none;
                    padding: 6px 12px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                    transition: background 0.2s;
                " onmouseover="this.style.background='#5a6268'" onmouseout="this.style.background='#6c757d'">
                    إلغاء
                </button>
                <button onclick="notificationSystem.hide(${id}); ${options.onConfirm ? options.onConfirm() : ''}" style="
                    background: #dc3545;
                    color: white;
                    border: none;
                    padding: 6px 12px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 12px;
                    transition: background 0.2s;
                " onmouseover="this.style.background='#c82333'" onmouseout="this.style.background='#dc3545'">
                    تأكيد
                </button>
            </div>
        `;
    }

    // ألوان الخلفية
    getBackgroundColor(type) {
        const colors = {
            success: '#d4edda',
            error: '#f8d7da',
            warning: '#fff3cd',
            info: '#d1ecf1',
            confirm: '#f8d7da',
            progress: '#e2e3e5'
        };
        return colors[type] || colors.info;
    }

    // ألوان النص
    getTextColor(type) {
        const colors = {
            success: '#155724',
            error: '#721c24',
            warning: '#856404',
            info: '#0c5460',
            confirm: '#721c24',
            progress: '#383d41'
        };
        return colors[type] || colors.info;
    }

    // ألوان العنوان
    getTitleColor(type) {
        const colors = {
            success: '#0f5132',
            error: '#58151c',
            warning: '#664d03',
            info: '#055160',
            confirm: '#58151c',
            progress: '#1b1e21'
        };
        return colors[type] || colors.info;
    }

    // ألوان الحدود
    getBorderColor(type) {
        const colors = {
            success: '#c3e6cb',
            error: '#f5c6cb',
            warning: '#ffeaa7',
            info: '#bee5eb',
            confirm: '#f5c6cb',
            progress: '#d6d8db'
        };
        return colors[type] || colors.info;
    }

    // ألوان الأيقونة
    getIconColor(type) {
        const colors = {
            success: '#28a745',
            error: '#dc3545',
            warning: '#ffc107',
            info: '#17a2b8',
            confirm: '#dc3545',
            progress: '#6c757d'
        };
        return colors[type] || colors.info;
    }
}

// إنشاء نسخة عامة من نظام التنبيهات
const notificationSystem = new NotificationSystem();

// إضافة إلى النطاق العام للاستخدام في الملفات الأخرى
if (typeof window !== 'undefined') {
    window.notificationSystem = notificationSystem;
}

module.exports = NotificationSystem;
