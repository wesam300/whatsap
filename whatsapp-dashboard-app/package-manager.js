const db = require('./db');

class PackageManager {
    // إدارة الباقات
    static getAllPackages() {
        return db.prepare('SELECT * FROM packages WHERE is_active = TRUE ORDER BY price ASC').all();
    }

    static getPackageById(id) {
        return db.prepare('SELECT * FROM packages WHERE id = ? AND is_active = TRUE').get(id);
    }

    static createPackage(packageData) {
        const { name, description, price, currency, duration_days, max_sessions, features } = packageData;
        const stmt = db.prepare(`
            INSERT INTO packages (name, description, price, currency, duration_days, max_sessions, features)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        return stmt.run(name, description, price, currency, duration_days, max_sessions, JSON.stringify(features));
    }

    static updatePackage(id, packageData) {
        const { name, description, price, currency, duration_days, max_sessions, features } = packageData;
        const stmt = db.prepare(`
            UPDATE packages 
            SET name = ?, description = ?, price = ?, currency = ?, duration_days = ?, max_sessions = ?, features = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        return stmt.run(name, description, price, currency, duration_days, max_sessions, JSON.stringify(features), id);
    }

    static deletePackage(id) {
        // بدلاً من الحذف، نقوم بتعطيل الباقة
        return db.prepare('UPDATE packages SET is_active = FALSE WHERE id = ?').run(id);
    }

    // إدارة اشتراكات المستخدمين
    static getUserActiveSubscription(userId) {
        return db.prepare(`
            SELECT us.*, p.name as package_name, p.max_sessions, p.features
            FROM user_subscriptions us
            JOIN packages p ON us.package_id = p.id
            WHERE us.user_id = ? AND us.status = 'active' AND us.end_date > datetime('now')
            ORDER BY us.end_date DESC
            LIMIT 1
        `).get(userId);
    }

    static getUserSubscriptions(userId) {
        return db.prepare(`
            SELECT us.*, p.name as package_name, p.price, p.currency
            FROM user_subscriptions us
            JOIN packages p ON us.package_id = p.id
            WHERE us.user_id = ?
            ORDER BY us.created_at DESC
        `).all(userId);
    }

    static createSubscription(userId, packageId, paymentStatus = 'pending') {
        const packageData = this.getPackageById(packageId);
        if (!packageData) {
            throw new Error('الباقة غير موجودة');
        }

        // حساب تاريخ انتهاء الاشتراك
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + packageData.duration_days);

        const stmt = db.prepare(`
            INSERT INTO user_subscriptions (user_id, package_id, end_date, payment_status)
            VALUES (?, ?, ?, ?)
        `);
        
        const result = stmt.run(userId, packageId, endDate.toISOString(), paymentStatus);
        
        // تحديث عدد الجلسات المسموحة للمستخدم
        db.prepare('UPDATE users SET max_sessions = ? WHERE id = ?').run(packageData.max_sessions, userId);
        
        return result;
    }

    static updateSubscriptionStatus(subscriptionId, status, paymentStatus = null) {
        let stmt;
        if (paymentStatus) {
            stmt = db.prepare('UPDATE user_subscriptions SET status = ?, payment_status = ? WHERE id = ?');
            return stmt.run(status, paymentStatus, subscriptionId);
        } else {
            stmt = db.prepare('UPDATE user_subscriptions SET status = ? WHERE id = ?');
            return stmt.run(status, subscriptionId);
        }
    }

    // التحقق من صلاحية الاشتراك
    static isUserSubscriptionValid(userId) {
        const subscription = this.getUserActiveSubscription(userId);
        if (!subscription) {
            return false;
        }
        return subscription.status === 'active' && new Date(subscription.end_date) > new Date();
    }

    static getUserMaxSessions(userId) {
        const subscription = this.getUserActiveSubscription(userId);
        if (subscription) {
            return subscription.max_sessions;
        }
        // إرجاع القيمة الافتراضية من جدول المستخدمين
        const user = db.prepare('SELECT max_sessions FROM users WHERE id = ?').get(userId);
        return user ? user.max_sessions : 1;
    }

    // إدارة إعدادات النظام
    static getSystemSettings() {
        return db.prepare('SELECT * FROM system_settings WHERE id = 1').get();
    }

    static updateSystemSettings(settings) {
        const { admin_phone, admin_email, support_whatsapp, company_name, company_address, terms_conditions, privacy_policy } = settings;
        const stmt = db.prepare(`
            UPDATE system_settings 
            SET admin_phone = ?, admin_email = ?, support_whatsapp = ?, company_name = ?, 
                company_address = ?, terms_conditions = ?, privacy_policy = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = 1
        `);
        return stmt.run(admin_phone, admin_email, support_whatsapp, company_name, company_address, terms_conditions, privacy_policy);
    }

    // تنظيف الاشتراكات المنتهية
    static cleanupExpiredSubscriptions() {
        return db.prepare(`
            UPDATE user_subscriptions 
            SET status = 'expired' 
            WHERE status = 'active' AND end_date < datetime('now')
        `).run();
    }

    // إحصائيات
    static getSubscriptionStats() {
        const stats = db.prepare(`
            SELECT 
                COUNT(*) as total_subscriptions,
                SUM(CASE WHEN status = 'active' AND end_date > datetime('now') THEN 1 ELSE 0 END) as active_subscriptions,
                SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired_subscriptions
            FROM user_subscriptions
        `).get();
        
        return stats;
    }

    static getPackageStats() {
        return db.prepare(`
            SELECT 
                p.name,
                p.price,
                COUNT(us.id) as total_subscriptions,
                SUM(CASE WHEN us.status = 'active' AND us.end_date > datetime('now') THEN 1 ELSE 0 END) as active_subscriptions
            FROM packages p
            LEFT JOIN user_subscriptions us ON p.id = us.package_id
            WHERE p.is_active = TRUE
            GROUP BY p.id
            ORDER BY p.price ASC
        `).all();
    }
}

module.exports = PackageManager;
