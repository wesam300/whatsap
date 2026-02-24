// Utility Functions
const Utils = {
    // Format Date
    formatDate(date) {
        if (!date) return '-';
        const d = new Date(date);
        return d.toLocaleDateString('ar-SA', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    // Format Time Ago
    timeAgo(date) {
        if (!date) return '-';
        const now = new Date();
        const past = new Date(date);
        const diff = now - past;
        
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `منذ ${days} يوم`;
        if (hours > 0) return `منذ ${hours} ساعة`;
        if (minutes > 0) return `منذ ${minutes} دقيقة`;
        return 'الآن';
    },

    // Debounce
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    // Copy to Clipboard
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            if (typeof toast !== 'undefined') {
                toast.success('تم النسخ بنجاح');
            }
            return true;
        } catch (err) {
            if (typeof toast !== 'undefined') {
                toast.error('فشل النسخ');
            }
            return false;
        }
    },

    // Format Number
    formatNumber(num) {
        return new Intl.NumberFormat('ar-SA').format(num);
    },

    // Validate Email
    validateEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    },

    // Show Loading
    showLoading(element) {
        if (typeof element === 'string') {
            element = document.querySelector(element);
        }
        if (element) {
            element.classList.add('loading');
        }
    },

    // Hide Loading
    hideLoading(element) {
        if (typeof element === 'string') {
            element = document.querySelector(element);
        }
        if (element) {
            element.classList.remove('loading');
        }
    },

    // Handle API Errors
    handleError(error, defaultMessage = 'حدث خطأ ما') {
        console.error('Error:', error);
        const message = error?.response?.data?.error || error?.message || defaultMessage;
        if (typeof toast !== 'undefined') {
            toast.error(message);
        }
        return message;
    }
};

