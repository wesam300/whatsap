// ========================================
// مدير مفاتيح API
// ========================================
// يدير إنشاء وإدارة مفاتيح API وتوكنات الجلسات

const crypto = require('crypto');
const db = require('./db');

// ========================================
// دوال إنشاء المفاتيح
// ========================================

// إنشاء مفتاح API جديد
function generateApiKey() {
    return 'wa_' + crypto.randomBytes(32).toString('hex');
}

// إنشاء توكن جلسة جديد
function generateSessionToken() {
    return 'st_' + crypto.randomBytes(24).toString('hex');
}

// ========================================
// دوال إدارة مفاتيح API
// ========================================

// إنشاء مفتاح API جديد للمستخدم
function createApiKey(userId, keyName) {
    try {
        const apiKey = generateApiKey();
        const stmt = db.prepare(`
            INSERT INTO api_keys (user_id, key_name, api_key) 
            VALUES (?, ?, ?)
        `);
        const result = stmt.run(userId, keyName, apiKey);
        
        return {
            success: true,
            apiKey: apiKey,
            id: result.lastInsertRowid
        };
    } catch (error) {
        console.error('Error creating API key:', error);
        return {
            success: false,
            error: 'فشل في إنشاء مفتاح API'
        };
    }
}

// الحصول على مفاتيح API للمستخدم
function getUserApiKeys(userId) {
    try {
        const stmt = db.prepare(`
            SELECT id, key_name, api_key, is_active, created_at, last_used 
            FROM api_keys 
            WHERE user_id = ? 
            ORDER BY created_at DESC
        `);
        return stmt.all(userId);
    } catch (error) {
        console.error('Error getting user API keys:', error);
        return [];
    }
}

// حذف مفتاح API
function deleteApiKey(userId, apiKeyId) {
    try {
        const stmt = db.prepare(`
            DELETE FROM api_keys 
            WHERE id = ? AND user_id = ?
        `);
        const result = stmt.run(apiKeyId, userId);
        
        return {
            success: result.changes > 0,
            message: result.changes > 0 ? 'تم حذف مفتاح API' : 'مفتاح API غير موجود'
        };
    } catch (error) {
        console.error('Error deleting API key:', error);
        return {
            success: false,
            error: 'فشل في حذف مفتاح API'
        };
    }
}

// ========================================
// دوال إدارة توكنات الجلسات
// ========================================

// إنشاء توكن جلسة جديد
function createSessionToken(userId, sessionId) {
    try {
        const token = generateSessionToken();
        const stmt = db.prepare(`
            INSERT INTO session_tokens (user_id, session_id, token) 
            VALUES (?, ?, ?)
        `);
        const result = stmt.run(userId, sessionId, token);
        
        return {
            success: true,
            token: token,
            id: result.lastInsertRowid
        };
    } catch (error) {
        console.error('Error creating session token:', error);
        return {
            success: false,
            error: 'فشل في إنشاء توكن الجلسة'
        };
    }
}

// الحصول على توكنات الجلسات للمستخدم
function getUserSessionTokens(userId) {
    try {
        const stmt = db.prepare(`
            SELECT id, session_id, token, is_active, created_at, last_used 
            FROM session_tokens 
            WHERE user_id = ? 
            ORDER BY created_at DESC
        `);
        return stmt.all(userId);
    } catch (error) {
        console.error('Error getting user session tokens:', error);
        return [];
    }
}

// حذف توكن جلسة
function deleteSessionToken(userId, tokenId) {
    try {
        const stmt = db.prepare(`
            DELETE FROM session_tokens 
            WHERE id = ? AND user_id = ?
        `);
        const result = stmt.run(tokenId, userId);
        
        return {
            success: result.changes > 0,
            message: result.changes > 0 ? 'تم حذف توكن الجلسة' : 'توكن الجلسة غير موجود'
        };
    } catch (error) {
        console.error('Error deleting session token:', error);
        return {
            success: false,
            error: 'فشل في حذف توكن الجلسة'
        };
    }
}

// ========================================
// دوال التحقق من صحة المفاتيح
// ========================================

// التحقق من صحة مفتاح API
function validateApiKey(apiKey) {
    try {
        const stmt = db.prepare(`
            SELECT ak.id, ak.user_id, ak.key_name, u.username 
            FROM api_keys ak
            JOIN users u ON ak.user_id = u.id
            WHERE ak.api_key = ? AND ak.is_active = TRUE
        `);
        const result = stmt.get(apiKey);
        
        if (result) {
            // تحديث آخر استخدام
            db.prepare('UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE id = ?').run(result.id);
            return {
                valid: true,
                id: result.id,
                userId: result.user_id,
                username: result.username,
                keyName: result.key_name
            };
        }
        
        return { valid: false };
    } catch (error) {
        console.error('Error validating API key:', error);
        return { valid: false };
    }
}

// التحقق من صحة توكن الجلسة
function validateSessionToken(token) {
    try {
        const stmt = db.prepare(`
            SELECT st.id, st.user_id, st.session_id, u.username 
            FROM session_tokens st
            JOIN users u ON st.user_id = u.id
            WHERE st.token = ? AND st.is_active = TRUE
        `);
        const result = stmt.get(token);
        
        if (result) {
            // تحديث آخر استخدام
            db.prepare('UPDATE session_tokens SET last_used = CURRENT_TIMESTAMP WHERE id = ?').run(result.id);
            return {
                valid: true,
                id: result.id,
                userId: result.user_id,
                username: result.username,
                sessionId: result.session_id
            };
        }
        
        return { valid: false };
    } catch (error) {
        console.error('Error validating session token:', error);
        return { valid: false };
    }
}

// ========================================
// دوال تسجيل API
// ========================================

// تسجيل طلب API
function logApiRequest(userId, apiKeyId, sessionTokenId, endpoint, method, statusCode, responseTime, ipAddress, userAgent) {
    try {
        const stmt = db.prepare(`
            INSERT INTO api_logs (user_id, api_key_id, session_token_id, endpoint, method, status_code, response_time, ip_address, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(userId, apiKeyId, sessionTokenId, endpoint, method, statusCode, responseTime, ipAddress, userAgent);
    } catch (error) {
        console.error('Error logging API request:', error);
    }
}

// الحصول على سجلات API للمستخدم
function getUserApiLogs(userId, limit = 50) {
    try {
        const stmt = db.prepare(`
            SELECT al.*, ak.key_name, st.session_id
            FROM api_logs al
            LEFT JOIN api_keys ak ON al.api_key_id = ak.id
            LEFT JOIN session_tokens st ON al.session_token_id = st.id
            WHERE al.user_id = ?
            ORDER BY al.created_at DESC
            LIMIT ?
        `);
        return stmt.all(userId, limit);
    } catch (error) {
        console.error('Error getting user API logs:', error);
        return [];
    }
}

// ========================================
// دوال مساعدة مبسطة
// ========================================

// الحصول على مفتاح API للمستخدم
function getUserApiKey(userId) {
    try {
        const stmt = db.prepare(`
            SELECT api_key FROM api_keys 
            WHERE user_id = ? AND is_active = TRUE 
            LIMIT 1
        `);
        const result = stmt.get(userId);
        return result ? result.api_key : null;
    } catch (error) {
        console.error('Error getting user API key:', error);
        return null;
    }
}

// حذف مفتاح API للمستخدم
function deleteUserApiKey(userId) {
    try {
        const stmt = db.prepare(`
            DELETE FROM api_keys 
            WHERE user_id = ?
        `);
        stmt.run(userId);
        return true;
    } catch (error) {
        console.error('Error deleting user API key:', error);
        return false;
    }
}

// الحصول على توكن الجلسة بواسطة معرف الجلسة
function getSessionTokenBySessionId(userId, sessionId) {
    try {
        const stmt = db.prepare(`
            SELECT token FROM session_tokens 
            WHERE user_id = ? AND session_id = ? AND is_active = TRUE 
            LIMIT 1
        `);
        const result = stmt.get(userId, sessionId);
        return result ? result.token : null;
    } catch (error) {
        console.error('Error getting session token:', error);
        return null;
    }
}

// حذف توكن الجلسة بواسطة معرف الجلسة
function deleteSessionTokenBySessionId(userId, sessionId) {
    try {
        const stmt = db.prepare(`
            DELETE FROM session_tokens 
            WHERE user_id = ? AND session_id = ?
        `);
        stmt.run(userId, sessionId);
        return true;
    } catch (error) {
        console.error('Error deleting session token:', error);
        return false;
    }
}

// ========================================
// تصدير الدوال
// ========================================

module.exports = {
    // إنشاء المفاتيح
    generateApiKey,
    generateSessionToken,
    
    // إدارة مفاتيح API
    createApiKey,
    getUserApiKeys,
    deleteApiKey,
    
    // إدارة توكنات الجلسات
    createSessionToken,
    getUserSessionTokens,
    deleteSessionToken,
    
    // التحقق من صحة المفاتيح
    validateApiKey,
    validateSessionToken,
    
    // تسجيل API
    logApiRequest,
    getUserApiLogs,
    
    // دوال مساعدة مبسطة
    getUserApiKey,
    deleteUserApiKey,
    getSessionTokenBySessionId,
    deleteSessionTokenBySessionId
};
