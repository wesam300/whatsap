// ========================================
// مسارات API لإرسال الرسائل والملفات
// ========================================
// يحتوي على جميع endpoints الخاصة بـ WhatsApp API

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { MessageMedia } = require('whatsapp-web.js');
const fetch = require('node-fetch');
const mime = require('mime');
const { validateApiKey, validateSessionToken, logApiRequest } = require('./api-key-manager');
const db = require('./db');
const { destroyClientCompletely } = require('./session-manager');

const router = express.Router();

// Rate limiting for messages
const messageLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // limit each IP to 60 messages per minute
    message: { error: 'تم تجاوز الحد المسموح من الرسائل في الدقيقة (60 رسالة)، يرجى المحاولة لاحقاً' },
    standardHeaders: true,
    legacyHeaders: false,
});

const dailyMessageLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    max: 10000, // limit each IP to 10000 messages per day
    message: { error: 'تم تجاوز الحد المسموح من الرسائل اليومية (10,000 رسالة)، يرجى المحاولة غداً' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Ensure preflight CORS succeeds for all API endpoints (especially multipart ones)
router.options('*', (req, res) => {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS,PATCH');
    res.header('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type, X-Requested-With, x-api-key, x-session-token, Authorization, Accept');
    res.sendStatus(200);
});

// متغير لتخزين مرجع activeClients
let activeClientsRef = null;

// دالة لتعيين مرجع activeClients
function setActiveClientsRef(activeClients) {
    activeClientsRef = activeClients;
}

// إعداد multer للملفات
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 16 * 1024 * 1024, // 16MB max
    },
    fileFilter: (req, file, cb) => {
        // السماح بأنواع الملفات المدعومة
        const allowedTypes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'video/mp4', 'video/avi', 'video/mov', 'video/wmv',
            'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a',
            'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain', 'text/csv'
        ];
        
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('نوع الملف غير مدعوم'), false);
        }
    }
});

// تنزيل ملف من رابط إلى الذاكرة فقط (بدون حفظ على القرص)
async function downloadFileToMemory(url, maxBytes = 16 * 1024 * 1024) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > maxBytes) {
            throw new Error('FILE_TOO_LARGE');
        }

        const chunks = [];
        let downloaded = 0;
        return await new Promise((resolve, reject) => {
            response.body.on('data', (chunk) => {
                downloaded += chunk.length;
                if (downloaded > maxBytes) {
                    response.body.destroy();
                    reject(new Error('FILE_TOO_LARGE'));
                    return;
                }
                chunks.push(chunk);
            });
            response.body.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const contentType = response.headers.get('content-type') || 'application/octet-stream';
                let filename = 'file';
                const cd = response.headers.get('content-disposition');
                if (cd) {
                    const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd);
                    const rawName = (match && (match[1] || match[2])) || 'file';
                    try { filename = decodeURIComponent(rawName); } catch (_) { filename = rawName; }
                } else {
                    try {
                        const u = new URL(url);
                        const base = u.pathname.split('/').filter(Boolean).pop();
                        if (base) filename = base;
                    } catch (_) {}
                }
                // إلحاق امتداد مناسب إن لم يوجد
                if (!filename.includes('.') && contentType) {
                    const ext = mime.getExtension(contentType);
                    if (ext) filename = `${filename}.${ext}`;
                }
                resolve({ buffer, contentType, filename });
            });
            response.body.on('error', (err) => reject(err));
        });
    } finally {
        clearTimeout(timeout);
    }
}

// ========================================
// Middleware للتحقق من صحة المفاتيح
// ========================================

// التحقق من مفتاح API
function validateApiKeyMiddleware(req, res, next) {
    // البحث عن API Key في الرابط أولاً، ثم في الهيدر، ثم في query
    const apiKey = req.params.apiKey || req.headers['x-api-key'] || req.query.api_key;
    
    if (!apiKey) {
        return res.status(401).json({
            success: false,
            error: 'مفتاح API مطلوب',
            code: 'MISSING_API_KEY'
        });
    }
    
    const validation = validateApiKey(apiKey);
    if (!validation.valid) {
        return res.status(401).json({
            success: false,
            error: 'مفتاح API غير صحيح',
            code: 'INVALID_API_KEY'
        });
    }
    
    // تحقق من أن المستخدم نشط
    try {
        const row = db.prepare('SELECT is_active FROM users WHERE id = ?').get(validation.userId);
        if (!row || row.is_active !== 1) {
            return res.status(403).json({ success: false, error: 'تم إيقاف المستخدم من قبل الإدارة', code: 'USER_SUSPENDED' });
        }
    } catch (_) {}

    req.apiKeyInfo = {
        ...validation,
        apiKeyId: validation.id
    };
    next();
}

// التحقق من توكن الجلسة
function validateSessionTokenMiddleware(req, res, next) {
    const sessionToken = req.headers['x-session-token'] || req.query.session_token;
    
    if (!sessionToken) {
        return res.status(401).json({
            success: false,
            error: 'توكن الجلسة مطلوب',
            code: 'MISSING_SESSION_TOKEN'
        });
    }
    
    const validation = validateSessionToken(sessionToken);
    if (!validation.valid) {
        return res.status(401).json({
            success: false,
            error: 'توكن الجلسة غير صحيح',
            code: 'INVALID_SESSION_TOKEN'
        });
    }
    
    req.sessionTokenInfo = {
        ...validation,
        id: validation.id
    };
    next();
}

// ========================================
// دالة مساعدة لإرسال الرسائل مع معالجة خطأ markedUnread
// ========================================
/**
 * إرسال رسالة مع معالجة خاصة لخطأ markedUnread
 * @param {Client} client - عميل WhatsApp
 * @param {string} chatId - معرف المحادثة
 * @param {string|MessageMedia} content - محتوى الرسالة
 * @param {object} options - خيارات إضافية
 * @returns {Promise<Message>} - الرسالة المرسلة
 */
async function sendMessageSafe(client, chatId, content, options = {}) {
    // تعطيل sendSeen لتجنب مشكلة markedUnread
    const safeOptions = {
        ...options,
        sendSeen: false
    };
    
    // التحقق من حالة العميل قبل الإرسال
    if (!client || !client.info) {
        throw new Error('الجلسة غير جاهزة أو غير متصلة');
    }
    
    // التحقق من حالة الصفحة (إذا كانت متاحة)
    // لا نستخدم isClosed() لأنها قد تسبب detached frame error
    // بدلاً من ذلك، نعتمد على معالجة الأخطاء عند حدوثها
    
    // عدد المحاولات القصوى
    const maxRetries = 3;
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // التحقق من حالة العميل في كل محاولة
            if (!client || !client.info) {
                throw new Error('الجلسة غير جاهزة أو غير متصلة');
            }
            
            // محاولة الحصول على Chat أولاً
            let chat;
            try {
                chat = await client.getChatById(chatId);
            } catch (getChatError) {
                // إذا فشل الحصول على Chat، نستخدم client.sendMessage مباشرة
                if (attempt === 1) {
                    console.warn(`[sendMessageSafe] تحذير: فشل الحصول على Chat ${chatId}, استخدام client.sendMessage مباشرة`);
                }
            }
            
            // إذا حصلنا على Chat، استخدم chat.sendMessage مع تعطيل sendSeen
            if (chat) {
                try {
                    if (content instanceof MessageMedia) {
                        return await chat.sendMessage(content, safeOptions);
                    } else {
                        return await chat.sendMessage(content, safeOptions);
                    }
                } catch (chatError) {
                    // إذا كان الخطأ متعلق بـ detached frame، نحاول مرة أخرى
                    const chatErrorMsg = chatError.message || chatError.toString() || '';
                    const isDetachedFrame = chatErrorMsg.includes('detached') || 
                                          chatErrorMsg.includes('Frame') ||
                                          chatErrorMsg.includes('Attempted to use detached');
                    
                    if (isDetachedFrame) {
                        console.warn(`[sendMessageSafe] محاولة ${attempt}/${maxRetries}: خطأ detached frame في chat.sendMessage: ${chatErrorMsg}`);
                        lastError = chatError;
                        if (attempt < maxRetries) {
                            const waitTime = 2000 * attempt;
                            console.log(`[sendMessageSafe] انتظار ${waitTime}ms قبل المحاولة التالية...`);
                            await new Promise(resolve => setTimeout(resolve, waitTime));
                            
                            // التحقق من حالة الجلسة مرة أخرى
                            if (!client || !client.info || client.state !== 'READY') {
                                throw new Error('الجلسة لم تعد جاهزة بعد إعادة المحاولة');
                            }
                            continue;
                        }
                    } else if (chatErrorMsg.includes('No LID for user')) {
                        // معالجة خطأ No LID for user
                        throw chatError;
                    } else {
                        // إذا فشل chat.sendMessage لأي سبب آخر، جرب client.sendMessage
                        console.warn(`[sendMessageSafe] خطأ في chat.sendMessage: ${chatError.message}, جرب client.sendMessage`);
                        lastError = chatError;
                    }
                }
            }
            
            // استخدام client.sendMessage مع تعطيل sendSeen
            try {
                if (content instanceof MessageMedia) {
                    return await client.sendMessage(chatId, content, safeOptions);
                } else {
                    return await client.sendMessage(chatId, content, safeOptions);
                }
            } catch (error) {
                // التحقق من نوع الخطأ
                const errorMsg = error.message || error.toString() || '';
                const errorStack = error.stack || '';
                const isDetachedFrame = errorMsg.includes('detached') || 
                                       errorMsg.includes('Frame') ||
                                       errorMsg.includes('Attempted to use detached') ||
                                       errorStack.includes('detached');
                
                // تسجيل تفصيلي للخطأ
                console.error(`[sendMessageSafe] خطأ في إرسال الرسالة إلى ${chatId}: ${errorMsg}`);
                
                // إذا كان الخطأ "No LID for user"، نحاول الحصول على Chat أولاً
                if (errorMsg.includes('No LID for user')) {
                    console.warn(`[sendMessageSafe] تحذير: No LID for user ${chatId}، محاولة الحصول على Chat...`);
                    
                    try {
                        const lidChat = await client.getChatById(chatId);
                        if (lidChat) {
                            console.log(`[sendMessageSafe] تم الحصول على Chat، إرسال الرسالة...`);
                            if (content instanceof MessageMedia) {
                                return await lidChat.sendMessage(content, safeOptions);
                            } else {
                                return await lidChat.sendMessage(content, safeOptions);
                            }
                        } else {
                            // إذا لم يتم إنشاء Chat، نحاول مرة أخرى بعد انتظار قليل
                            console.log(`[sendMessageSafe] انتظار قليل ثم إعادة المحاولة...`);
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            if (content instanceof MessageMedia) {
                                return await client.sendMessage(chatId, content, safeOptions);
                            } else {
                                return await client.sendMessage(chatId, content, safeOptions);
                            }
                        }
                    } catch (lidError) {
                        throw new Error(`فشل في إرسال الرسالة: ${error.message}. تأكد من أن الرقم ${chatId.replace('@c.us', '')} مسجل على WhatsApp.`);
                    }
                }
                
                // إذا كان الخطأ متعلق بـ detached frame، نحاول مرة أخرى
                if (isDetachedFrame) {
                    console.warn(`[sendMessageSafe] محاولة ${attempt}/${maxRetries}: خطأ detached frame: ${errorMsg}`);
                    lastError = error;
                    if (attempt < maxRetries) {
                        // انتظار متزايد قبل إعادة المحاولة (2 ثانية، 4 ثوانٍ، 6 ثوانٍ)
                        const waitTime = 2000 * attempt;
                        console.log(`[sendMessageSafe] انتظار ${waitTime}ms قبل المحاولة التالية...`);
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                        
                        // التحقق من حالة الجلسة مرة أخرى قبل إعادة المحاولة
                        if (!client || !client.info || client.state !== 'READY') {
                            throw new Error('الجلسة لم تعد جاهزة بعد إعادة المحاولة');
                        }
                        continue; // إعادة المحاولة
                    }
                }
                
                // إذا لم يكن الخطأ detached frame، نرميه مباشرة
                throw error;
            }
        } catch (error) {
            // التحقق من نوع الخطأ
            const errorMsg = error.message || error.toString() || '';
            const isDetachedFrame = errorMsg.includes('detached') || 
                                   errorMsg.includes('Frame') ||
                                   errorMsg.includes('Attempted to use detached');
            
            // إذا كانت هذه المحاولة الأخيرة أو الخطأ ليس detached frame، نرميه
            if (attempt === maxRetries || !isDetachedFrame) {
                throw error;
            }
            lastError = error;
            
            // انتظار قبل المحاولة التالية
            if (attempt < maxRetries) {
                const waitTime = 2000 * attempt;
                console.log(`[sendMessageSafe] انتظار ${waitTime}ms قبل المحاولة التالية...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                
                // التحقق من حالة الجلسة مرة أخرى
                if (!client || !client.info || client.state !== 'READY') {
                    throw new Error('الجلسة لم تعد جاهزة بعد إعادة المحاولة');
                }
            }
        }
    }
    
    // إذا فشلت جميع المحاولات، نرمي آخر خطأ
    if (lastError) {
        console.error(`[sendMessageSafe] فشلت جميع المحاولات لإرسال الرسالة إلى ${chatId}`);
        throw new Error(`فشل في إرسال الرسالة بعد ${maxRetries} محاولات: ${lastError.message}`);
    }
    
    throw new Error('فشل في إرسال الرسالة: سبب غير معروف');
}

// ========================================
// مسارات إرسال الرسائل
// ========================================

// إرسال رسالة نصية (مع API Key في الهيدر)
router.post('/send-message', messageLimiter, dailyMessageLimiter, validateApiKeyMiddleware, validateSessionTokenMiddleware, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { to, message } = req.body;
        const { userId, apiKeyId } = req.apiKeyInfo;
        const { sessionId } = req.sessionTokenInfo;
        
        if (!to || !message) {
            return res.status(400).json({
                success: false,
                error: 'رقم الهاتف والرسالة مطلوبان',
                code: 'MISSING_PARAMETERS'
            });
        }
        
        // التحقق من وجود الجلسة
        const client = activeClientsRef ? activeClientsRef.get(String(sessionId)) : null;
        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'الجلسة غير موجودة أو غير متصلة',
                code: 'SESSION_NOT_FOUND'
            });
        }
        
        // التحقق من أن الجلسة جاهزة
        if (!client.info) {
            return res.status(400).json({
                success: false,
                error: 'الجلسة غير جاهزة بعد. يرجى المحاولة لاحقاً',
                code: 'SESSION_NOT_READY'
            });
        }
        
        // التحقق من حالة الجلسة (يجب أن تكون READY)
        if (client.state !== 'READY') {
            return res.status(400).json({
                success: false,
                error: `الجلسة غير جاهزة. الحالة الحالية: ${client.state}`,
                code: 'SESSION_NOT_READY'
            });
        }
        
        // إرسال الرسالة باستخدام الدالة الآمنة
        let chatId = to.includes('@c.us') ? to : `${to}@c.us`;
        const result = await sendMessageSafe(client, chatId, message);
        
        const responseTime = Date.now() - startTime;
        
        // تسجيل الطلب
        logApiRequest(
            userId, apiKeyId, req.sessionTokenInfo.id,
            '/api/send-message', 'POST', 200,
            responseTime, req.ip, req.get('User-Agent')
        );
        
        res.json({
            success: true,
            message: 'تم إرسال الرسالة بنجاح',
            messageId: result.id._serialized,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        const responseTime = Date.now() - startTime;
        
        // تسجيل الطلب
        logApiRequest(
            req.apiKeyInfo.userId, req.apiKeyInfo.id, req.sessionTokenInfo?.id,
            '/api/send-message', 'POST', 500,
            responseTime, req.ip, req.get('User-Agent')
        );
        
        console.error('Error sending message:', error);
        res.status(500).json({
            success: false,
            error: 'فشل في إرسال الرسالة',
            details: error.message,
            code: 'SEND_MESSAGE_FAILED'
        });
    }
});

// إرسال رسالة صوتية (base64) - صوت (PTT)
router.post('/send-voice', validateApiKeyMiddleware, validateSessionTokenMiddleware, async (req, res) => {
    const startTime = Date.now();
    try {
        const { to, audioBase64, mimeType } = req.body;
        const { userId, apiKeyId } = req.apiKeyInfo;
        const { sessionId } = req.sessionTokenInfo;

        if (!to || !audioBase64 || !mimeType) {
            return res.status(400).json({ success: false, error: 'المعاملات مطلوبة: to, audioBase64, mimeType', code: 'MISSING_PARAMETERS' });
        }

        const client = activeClientsRef ? activeClientsRef.get(String(sessionId)) : null;
        if (!client) {
            return res.status(404).json({ success: false, error: 'الجلسة غير موجودة أو غير متصلة', code: 'SESSION_NOT_FOUND' });
        }

        const chatId = to.includes('@c.us') ? to : `${to}@c.us`;
        const media = new MessageMedia(mimeType, audioBase64, 'voice.ogg');
        const result = await sendMessageSafe(client, chatId, media, { sendAudioAsVoice: true });

        const responseTime = Date.now() - startTime;
        logApiRequest(userId, apiKeyId, req.sessionTokenInfo.id, '/api/send-voice', 'POST', 200, responseTime, req.ip, req.get('User-Agent'));
        res.json({ success: true, message: 'تم إرسال الرسالة الصوتية', messageId: result.id._serialized });
    } catch (error) {
        const responseTime = Date.now() - startTime;
        logApiRequest(req.apiKeyInfo.userId, req.apiKeyInfo.id, req.sessionTokenInfo?.id, '/api/send-voice', 'POST', 500, responseTime, req.ip, req.get('User-Agent'));
        res.status(500).json({ success: false, error: 'فشل في إرسال الرسالة الصوتية', details: error.message, code: 'SEND_VOICE_FAILED' });
    }
});

// إرسال رسالة نصية (مع API Key في الرابط)
router.post('/:apiKey/send-message', messageLimiter, dailyMessageLimiter, validateApiKeyMiddleware, validateSessionTokenMiddleware, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { to, message } = req.body;
        const { userId, apiKeyId } = req.apiKeyInfo;
        const { sessionId } = req.sessionTokenInfo;
        
        if (!to || !message) {
            return res.status(400).json({
                success: false,
                error: 'رقم الهاتف والرسالة مطلوبان',
                code: 'MISSING_PARAMETERS'
            });
        }
        
        // التحقق من وجود الجلسة
        const client = activeClientsRef ? activeClientsRef.get(String(sessionId)) : null;
        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'الجلسة غير موجودة أو غير متصلة',
                code: 'SESSION_NOT_FOUND'
            });
        }
        
        // التحقق من أن الجلسة جاهزة
        if (!client.info) {
            return res.status(400).json({
                success: false,
                error: 'الجلسة غير جاهزة بعد. يرجى المحاولة لاحقاً',
                code: 'SESSION_NOT_READY'
            });
        }
        
        // التحقق من حالة الجلسة (يجب أن تكون READY)
        if (client.state !== 'READY') {
            return res.status(400).json({
                success: false,
                error: `الجلسة غير جاهزة. الحالة الحالية: ${client.state}`,
                code: 'SESSION_NOT_READY'
            });
        }
        
        // إرسال الرسالة باستخدام الدالة الآمنة
        let chatId = to.includes('@c.us') ? to : `${to}@c.us`;
        const result = await sendMessageSafe(client, chatId, message);
        
        const responseTime = Date.now() - startTime;
        
        // تسجيل الطلب
        logApiRequest(
            userId, apiKeyId, req.sessionTokenInfo.id,
            '/api/send-message', 'POST', 200,
            responseTime, req.ip, req.get('User-Agent')
        );
        
        res.json({
            success: true,
            message: 'تم إرسال الرسالة بنجاح',
            messageId: result.id._serialized,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        const responseTime = Date.now() - startTime;
        
        // تسجيل الطلب
        logApiRequest(
            req.apiKeyInfo.userId, req.apiKeyInfo.id, req.sessionTokenInfo?.id,
            '/api/send-message', 'POST', 500,
            responseTime, req.ip, req.get('User-Agent')
        );
        
        console.error('Error sending message:', error);
        res.status(500).json({
            success: false,
            error: 'فشل في إرسال الرسالة',
            details: error.message,
            code: 'SEND_MESSAGE_FAILED'
        });
    }
});

// إرسال رسالة مع ملف (مع API Key في الهيدر)
router.post('/send-media', messageLimiter, dailyMessageLimiter, validateApiKeyMiddleware, validateSessionTokenMiddleware, upload.single('media'), async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { to, caption, url } = req.body;
        const { userId, apiKeyId } = req.apiKeyInfo;
        const { sessionId } = req.sessionTokenInfo;
        
        if (!to || (!req.file && !url)) {
            return res.status(400).json({
                success: false,
                error: 'رقم الهاتف والملف أو الرابط مطلوب',
                code: 'MISSING_PARAMETERS'
            });
        }
        
        // التحقق من وجود الجلسة
        const client = activeClientsRef ? activeClientsRef.get(String(sessionId)) : null;
        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'الجلسة غير موجودة أو غير متصلة',
                code: 'SESSION_NOT_FOUND'
            });
        }
        
        // إنشاء Media Message (من ملف مرفوع أو من رابط)
        let media;
        if (req.file) {
            media = new MessageMedia(
                req.file.mimetype,
                req.file.buffer.toString('base64'),
                req.file.originalname
            );
        } else {
            try {
                const { buffer, contentType, filename } = await downloadFileToMemory(url);
                media = new MessageMedia(contentType, buffer.toString('base64'), filename);
            } catch (e) {
                if (e.message === 'FILE_TOO_LARGE') {
                    return res.status(400).json({ success: false, error: 'حجم الملف كبير جداً (الحد الأقصى 16MB)', code: 'FILE_TOO_LARGE' });
                }
                return res.status(400).json({ success: false, error: 'فشل تنزيل الملف من الرابط', details: e.message, code: 'DOWNLOAD_FAILED' });
            }
        }
        
        // إرسال الملف
        const chatId = to.includes('@c.us') ? to : `${to}@c.us`;
        const result = await sendMessageSafe(client, chatId, media, { caption: caption || '' });
        
        const responseTime = Date.now() - startTime;
        
        // تسجيل الطلب
        logApiRequest(
            userId, apiKeyId, req.sessionTokenInfo.id,
            '/api/send-media', 'POST', 200,
            responseTime, req.ip, req.get('User-Agent')
        );
        
        res.json({
            success: true,
            message: 'تم إرسال الملف بنجاح',
            messageId: result.id._serialized,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        const responseTime = Date.now() - startTime;
        
        // تسجيل الطلب
        logApiRequest(
            req.apiKeyInfo.userId, req.apiKeyInfo.id, req.sessionTokenInfo?.id,
            '/api/send-media', 'POST', 500,
            responseTime, req.ip, req.get('User-Agent')
        );
        
        console.error('Error sending media:', error);
        res.status(500).json({
            success: false,
            error: 'فشل في إرسال الملف',
            details: error.message,
            code: 'SEND_MEDIA_FAILED'
        });
    }
});

// إرسال رسالة مع ملف (مع API Key في الرابط)
router.post('/:apiKey/send-media', messageLimiter, dailyMessageLimiter, validateApiKeyMiddleware, validateSessionTokenMiddleware, upload.single('media'), async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { to, caption, url } = req.body;
        const { userId, apiKeyId } = req.apiKeyInfo;
        const { sessionId } = req.sessionTokenInfo;
        
        if (!to || (!req.file && !url)) {
            return res.status(400).json({
                success: false,
                error: 'رقم الهاتف والملف أو الرابط مطلوب',
                code: 'MISSING_PARAMETERS'
            });
        }
        
        // التحقق من وجود الجلسة
        const client = activeClientsRef ? activeClientsRef.get(String(sessionId)) : null;
        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'الجلسة غير موجودة أو غير متصلة',
                code: 'SESSION_NOT_FOUND'
            });
        }
        
        // إنشاء MessageMedia (من ملف مرفوع أو من رابط)
        let media;
        if (req.file) {
            media = new MessageMedia(
                req.file.mimetype,
                req.file.buffer.toString('base64'),
                req.file.originalname
            );
        } else {
            try {
                const { buffer, contentType, filename } = await downloadFileToMemory(url);
                media = new MessageMedia(contentType, buffer.toString('base64'), filename);
            } catch (e) {
                if (e.message === 'FILE_TOO_LARGE') {
                    return res.status(400).json({ success: false, error: 'حجم الملف كبير جداً (الحد الأقصى 16MB)', code: 'FILE_TOO_LARGE' });
                }
                return res.status(400).json({ success: false, error: 'فشل تنزيل الملف من الرابط', details: e.message, code: 'DOWNLOAD_FAILED' });
            }
        }
        
        // إرسال الملف
        const chatId = to.includes('@c.us') ? to : `${to}@c.us`;
        const result = await sendMessageSafe(client, chatId, media, { caption: caption || '' });
        
        const responseTime = Date.now() - startTime;
        
        // تسجيل الطلب
        logApiRequest(
            userId, apiKeyId, req.sessionTokenInfo.id,
            '/api/send-media', 'POST', 200,
            responseTime, req.ip, req.get('User-Agent')
        );
        
        res.json({
            success: true,
            message: 'تم إرسال الملف بنجاح',
            messageId: result.id._serialized,
            timestamp: new Date().toISOString(),
            fileInfo: req.file ? {
                name: req.file.originalname,
                size: req.file.size,
                type: req.file.mimetype
            } : undefined
        });
        
    } catch (error) {
        const responseTime = Date.now() - startTime;
        
        // تسجيل الطلب
        logApiRequest(
            req.apiKeyInfo.userId, req.apiKeyInfo.id, req.sessionTokenInfo?.id,
            '/api/send-media', 'POST', 500,
            responseTime, req.ip, req.get('User-Agent')
        );
        
        console.error('Error sending media:', error);
        res.status(500).json({
            success: false,
            error: 'فشل في إرسال الملف',
            details: error.message,
            code: 'SEND_MEDIA_FAILED'
        });
    }
});

// إرسال رسالة صوتية (مع API Key في الرابط)
router.post('/:apiKey/send-voice', validateApiKeyMiddleware, validateSessionTokenMiddleware, async (req, res) => {
    const startTime = Date.now();
    try {
        const { to, audioBase64, mimeType } = req.body;
        const { userId, apiKeyId } = req.apiKeyInfo;
        const { sessionId } = req.sessionTokenInfo;

        if (!to || !audioBase64 || !mimeType) {
            return res.status(400).json({ success: false, error: 'المعاملات مطلوبة: to, audioBase64, mimeType', code: 'MISSING_PARAMETERS' });
        }

        const client = activeClientsRef ? activeClientsRef.get(String(sessionId)) : null;
        if (!client) {
            return res.status(404).json({ success: false, error: 'الجلسة غير موجودة أو غير متصلة', code: 'SESSION_NOT_FOUND' });
        }

        const chatId = to.includes('@c.us') ? to : `${to}@c.us`;
        const media = new MessageMedia(mimeType, audioBase64, 'voice.ogg');
        const result = await sendMessageSafe(client, chatId, media, { sendAudioAsVoice: true });

        const responseTime = Date.now() - startTime;
        logApiRequest(userId, apiKeyId, req.sessionTokenInfo.id, '/api/send-voice', 'POST', 200, responseTime, req.ip, req.get('User-Agent'));
        res.json({ success: true, message: 'تم إرسال الرسالة الصوتية', messageId: result.id._serialized });
    } catch (error) {
        const responseTime = Date.now() - startTime;
        logApiRequest(req.apiKeyInfo.userId, req.apiKeyInfo.id, req.sessionTokenInfo?.id, '/api/send-voice', 'POST', 500, responseTime, req.ip, req.get('User-Agent'));
        res.status(500).json({ success: false, error: 'فشل في إرسال الرسالة الصوتية', details: error.message, code: 'SEND_VOICE_FAILED' });
    }
});

// إرسال رسالة إلى مجموعة (مع API Key في الهيدر)
router.post('/send-group-message', validateApiKeyMiddleware, validateSessionTokenMiddleware, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { groupId, message } = req.body;
        const { userId, apiKeyId } = req.apiKeyInfo;
        const { sessionId } = req.sessionTokenInfo;
        
        if (!groupId || !message) {
            return res.status(400).json({
                success: false,
                error: 'معرف المجموعة والرسالة مطلوبان',
                code: 'MISSING_PARAMETERS'
            });
        }
        
        // التحقق من وجود الجلسة
        const client = activeClientsRef ? activeClientsRef.get(String(sessionId)) : null;
        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'الجلسة غير موجودة أو غير متصلة',
                code: 'SESSION_NOT_FOUND'
            });
        }
        
        // إرسال الرسالة للمجموعة
        const result = await sendMessageSafe(client, groupId, message);
        
        const responseTime = Date.now() - startTime;
        
        // تسجيل الطلب
        logApiRequest(
            userId, apiKeyId, req.sessionTokenInfo.id,
            '/api/send-group-message', 'POST', 200,
            responseTime, req.ip, req.get('User-Agent')
        );
        
        res.json({
            success: true,
            message: 'تم إرسال الرسالة للمجموعة بنجاح',
            messageId: result.id._serialized,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        const responseTime = Date.now() - startTime;
        
        // تسجيل الطلب
        logApiRequest(
            req.apiKeyInfo.userId, req.apiKeyInfo.id, req.sessionTokenInfo?.id,
            '/api/send-group-message', 'POST', 500,
            responseTime, req.ip, req.get('User-Agent')
        );
        
        console.error('Error sending group message:', error);
        res.status(500).json({
            success: false,
            error: 'فشل في إرسال الرسالة للمجموعة',
            details: error.message,
            code: 'SEND_GROUP_MESSAGE_FAILED'
        });
    }
});

// إرسال رسالة إلى مجموعة (مع API Key في الرابط)
router.post('/:apiKey/send-group-message', validateApiKeyMiddleware, validateSessionTokenMiddleware, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { groupId, message } = req.body;
        const { userId, apiKeyId } = req.apiKeyInfo;
        const { sessionId } = req.sessionTokenInfo;
        
        if (!groupId || !message) {
            return res.status(400).json({
                success: false,
                error: 'معرف المجموعة والرسالة مطلوبان',
                code: 'MISSING_PARAMETERS'
            });
        }
        
        // التحقق من وجود الجلسة
        const client = activeClientsRef ? activeClientsRef.get(sessionId) : null;
        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'الجلسة غير موجودة أو غير متصلة',
                code: 'SESSION_NOT_FOUND'
            });
        }
        
        // إرسال الرسالة للمجموعة
        const chatId = groupId.includes('@g.us') ? groupId : `${groupId}@g.us`;
        const result = await sendMessageSafe(client, chatId, message);
        
        const responseTime = Date.now() - startTime;
        
        // تسجيل الطلب
        logApiRequest(
            userId, apiKeyId, req.sessionTokenInfo.id,
            '/api/send-group-message', 'POST', 200,
            responseTime, req.ip, req.get('User-Agent')
        );
        
        res.json({
            success: true,
            message: 'تم إرسال الرسالة للمجموعة بنجاح',
            messageId: result.id._serialized,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        const responseTime = Date.now() - startTime;
        
        // تسجيل الطلب
        logApiRequest(
            req.apiKeyInfo.userId, req.apiKeyInfo.id, req.sessionTokenInfo?.id,
            '/api/send-group-message', 'POST', 500,
            responseTime, req.ip, req.get('User-Agent')
        );
        
        console.error('Error sending group message:', error);
        res.status(500).json({
            success: false,
            error: 'فشل في إرسال الرسالة للمجموعة',
            details: error.message,
            code: 'SEND_GROUP_MESSAGE_FAILED'
        });
    }
});

// ========================================
// مسارات الحصول على المعلومات
// ========================================

// الحصول على حالة الجلسة (مع API Key في الهيدر)
router.get('/session-status', validateApiKeyMiddleware, validateSessionTokenMiddleware, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { userId, apiKeyId } = req.apiKeyInfo;
        const { sessionId } = req.sessionTokenInfo;
        
        // التحقق من وجود الجلسة
        const client = activeClientsRef ? activeClientsRef.get(sessionId) : null;
        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'الجلسة غير موجودة أو غير متصلة',
                code: 'SESSION_NOT_FOUND'
            });
        }
        
        const responseTime = Date.now() - startTime;
        
        // تسجيل الطلب
        logApiRequest(
            userId, apiKeyId, req.sessionTokenInfo.id,
            '/api/session-status', 'GET', 200,
            responseTime, req.ip, req.get('User-Agent')
        );
        
        res.json({
            success: true,
            sessionId: sessionId,
            status: client.state,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        const responseTime = Date.now() - startTime;
        
        // تسجيل الطلب
        logApiRequest(
            req.apiKeyInfo.userId, req.apiKeyInfo.id, req.sessionTokenInfo?.id,
            '/api/session-status', 'GET', 500,
            responseTime, req.ip, req.get('User-Agent')
        );
        
        console.error('Error getting session status:', error);
        res.status(500).json({
            success: false,
            error: 'فشل في الحصول على حالة الجلسة',
            details: error.message,
            code: 'GET_SESSION_STATUS_FAILED'
        });
    }
});

// الحصول على آخر الرسائل (inbox) للجلسة
router.get('/messages', validateApiKeyMiddleware, validateSessionTokenMiddleware, async (req, res) => {
    try {
        const { sessionId } = req.sessionTokenInfo;
        const { chatId, limit = 50, fromMe } = req.query;
        const lim = Math.min(parseInt(limit) || 50, 200);

        let query = 'SELECT id, session_id, chat_id, message_id, from_me, type, body, has_media, media_mime_type, sender, receiver, timestamp FROM messages WHERE session_id = ?';
        const params = [String(sessionId)];
        if (chatId) {
            query += ' AND chat_id = ?';
            params.push(chatId);
        }
        if (fromMe === 'true' || fromMe === 'false') {
            query += ' AND from_me = ?';
            params.push(fromMe === 'true' ? 1 : 0);
        }
        query += ' ORDER BY id DESC LIMIT ?';
        params.push(lim);

        const rows = db.prepare(query).all(...params);
        res.json({ success: true, messages: rows });
    } catch (error) {
        res.status(500).json({ success: false, error: 'فشل في جلب الرسائل', details: error.message });
    }
});

// الحصول على رسالة محددة بالتفاصيل (مع الميديا إن لزم)
router.get('/messages/:messageId', validateApiKeyMiddleware, validateSessionTokenMiddleware, async (req, res) => {
    try {
        const { sessionId } = req.sessionTokenInfo;
        const { messageId } = req.params;
        const row = db.prepare('SELECT * FROM messages WHERE session_id = ? AND message_id = ?').get(String(sessionId), messageId);
        if (!row) return res.status(404).json({ success: false, error: 'الرسالة غير موجودة' });
        res.json({ success: true, message: row });
    } catch (error) {
        res.status(500).json({ success: false, error: 'فشل في جلب الرسالة', details: error.message });
    }
});

// الحصول على حالة الجلسة (مع API Key في الرابط)
router.get('/:apiKey/session-status', validateApiKeyMiddleware, validateSessionTokenMiddleware, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { userId, apiKeyId } = req.apiKeyInfo;
        const { sessionId } = req.sessionTokenInfo;
        
        // التحقق من وجود الجلسة
        const client = activeClientsRef ? activeClientsRef.get(sessionId) : null;
        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'الجلسة غير موجودة أو غير متصلة',
                code: 'SESSION_NOT_FOUND'
            });
        }
        
        const responseTime = Date.now() - startTime;
        
        // تسجيل الطلب
        logApiRequest(
            userId, apiKeyId, req.sessionTokenInfo.id,
            '/api/session-status', 'GET', 200,
            responseTime, req.ip, req.get('User-Agent')
        );
        
        res.json({
            success: true,
            sessionId: sessionId,
            status: 'connected',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        const responseTime = Date.now() - startTime;
        
        // تسجيل الطلب
        logApiRequest(
            req.apiKeyInfo.userId, req.apiKeyInfo.id, req.sessionTokenInfo?.id,
            '/api/session-status', 'GET', 500,
            responseTime, req.ip, req.get('User-Agent')
        );
        
        console.error('Error getting session status:', error);
        res.status(500).json({
            success: false,
            error: 'فشل في الحصول على حالة الجلسة',
            details: error.message,
            code: 'GET_SESSION_STATUS_FAILED'
        });
    }
});

// الحصول على الرسائل (مع API Key في الرابط)
router.get('/:apiKey/messages', validateApiKeyMiddleware, validateSessionTokenMiddleware, async (req, res) => {
    try {
        const { sessionId } = req.sessionTokenInfo;
        const { chatId, limit = 50, fromMe } = req.query;
        const lim = Math.min(parseInt(limit) || 50, 200);
        let query = 'SELECT id, session_id, chat_id, message_id, from_me, type, body, has_media, media_mime_type, sender, receiver, timestamp FROM messages WHERE session_id = ?';
        const params = [String(sessionId)];
        if (chatId) { query += ' AND chat_id = ?'; params.push(chatId); }
        if (fromMe === 'true' || fromMe === 'false') { query += ' AND from_me = ?'; params.push(fromMe === 'true' ? 1 : 0); }
        query += ' ORDER BY id DESC LIMIT ?'; params.push(lim);
        const rows = db.prepare(query).all(...params);
        res.json({ success: true, messages: rows });
    } catch (error) {
        res.status(500).json({ success: false, error: 'فشل في جلب الرسائل', details: error.message });
    }
});

router.get('/:apiKey/messages/:messageId', validateApiKeyMiddleware, validateSessionTokenMiddleware, async (req, res) => {
    try {
        const { sessionId } = req.sessionTokenInfo;
        const { messageId } = req.params;
        const row = db.prepare('SELECT * FROM messages WHERE session_id = ? AND message_id = ?').get(String(sessionId), messageId);
        if (!row) return res.status(404).json({ success: false, error: 'الرسالة غير موجودة' });
        res.json({ success: true, message: row });
    } catch (error) {
        res.status(500).json({ success: false, error: 'فشل في جلب الرسالة', details: error.message });
    }
});

// ========================================
// 🆕 مسارات جديدة: الرسائل الجماعية، الرسائل المستقبلة، جهات الاتصال
// ========================================

// إرسال رسائل جماعية (مع API Key في الرابط)
router.post('/:apiKey/send-bulk-message', messageLimiter, dailyMessageLimiter, validateApiKeyMiddleware, validateSessionTokenMiddleware, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { to, message } = req.body;
        const { userId, apiKeyId } = req.apiKeyInfo;
        const { sessionId } = req.sessionTokenInfo;
        
        if (!to || !Array.isArray(to) || to.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'قائمة الأرقام مطلوبة ويجب أن تحتوي على رقم واحد على الأقل',
                code: 'MISSING_PARAMETERS'
            });
        }
        
        if (!message) {
            return res.status(400).json({
                success: false,
                error: 'نص الرسالة مطلوب',
                code: 'MISSING_PARAMETERS'
            });
        }
        
        // التحقق من وجود الجلسة
        const client = activeClientsRef ? activeClientsRef.get(String(sessionId)) : null;
        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'الجلسة غير موجودة أو غير متصلة',
                code: 'SESSION_NOT_FOUND'
            });
        }
        
        // التحقق من أن الجلسة جاهزة
        if (!client.info) {
            return res.status(400).json({
                success: false,
                error: 'الجلسة غير جاهزة بعد. يرجى المحاولة لاحقاً',
                code: 'SESSION_NOT_READY'
            });
        }
        
        // إرسال الرسائل
        const results = [];
        for (const phoneNumber of to) {
            try {
                const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
                const result = await sendMessageSafe(client, chatId, message);
                results.push({
                    to: phoneNumber,
                    success: true,
                    messageId: result.id._serialized,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                results.push({
                    to: phoneNumber,
                    success: false,
                    error: error.message
                });
            }
        }
        
        const responseTime = Date.now() - startTime;
        
        // تسجيل الطلب
        logApiRequest(
            userId, apiKeyId, req.sessionTokenInfo.id,
            '/api/send-bulk-message', 'POST', 200,
            responseTime, req.ip, req.get('User-Agent')
        );
        
        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        
        res.json({
            success: true,
            message: `تم إرسال ${successCount} رسالة بنجاح${failCount > 0 ? ` وفشل ${failCount} رسالة` : ''}`,
            total: to.length,
            successCount,
            failCount,
            results,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        const responseTime = Date.now() - startTime;
        console.error('Bulk message send error:', error);
        res.status(500).json({
            success: false,
            error: 'فشل في إرسال الرسائل الجماعية',
            details: error.message,
            code: 'SEND_BULK_MESSAGE_FAILED'
        });
    }
});

// إرسال رسائل جماعية (مع API Key في الهيدر)
router.post('/send-bulk-message', messageLimiter, dailyMessageLimiter, validateApiKeyMiddleware, validateSessionTokenMiddleware, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { to, message } = req.body;
        const { userId, apiKeyId } = req.apiKeyInfo;
        const { sessionId } = req.sessionTokenInfo;
        
        if (!to || !Array.isArray(to) || to.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'قائمة الأرقام مطلوبة ويجب أن تحتوي على رقم واحد على الأقل',
                code: 'MISSING_PARAMETERS'
            });
        }
        
        if (!message) {
            return res.status(400).json({
                success: false,
                error: 'نص الرسالة مطلوب',
                code: 'MISSING_PARAMETERS'
            });
        }
        
        // التحقق من وجود الجلسة
        const client = activeClientsRef ? activeClientsRef.get(String(sessionId)) : null;
        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'الجلسة غير موجودة أو غير متصلة',
                code: 'SESSION_NOT_FOUND'
            });
        }
        
        // التحقق من أن الجلسة جاهزة
        if (!client.info) {
            return res.status(400).json({
                success: false,
                error: 'الجلسة غير جاهزة بعد. يرجى المحاولة لاحقاً',
                code: 'SESSION_NOT_READY'
            });
        }
        
        // إرسال الرسائل
        const results = [];
        for (const phoneNumber of to) {
            try {
                const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
                const result = await sendMessageSafe(client, chatId, message);
                results.push({
                    to: phoneNumber,
                    success: true,
                    messageId: result.id._serialized,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                results.push({
                    to: phoneNumber,
                    success: false,
                    error: error.message
                });
            }
        }
        
        const responseTime = Date.now() - startTime;
        
        // تسجيل الطلب
        logApiRequest(
            userId, apiKeyId, req.sessionTokenInfo.id,
            '/api/send-bulk-message', 'POST', 200,
            responseTime, req.ip, req.get('User-Agent')
        );
        
        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        
        res.json({
            success: true,
            message: `تم إرسال ${successCount} رسالة بنجاح${failCount > 0 ? ` وفشل ${failCount} رسالة` : ''}`,
            total: to.length,
            successCount,
            failCount,
            results,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        const responseTime = Date.now() - startTime;
        console.error('Bulk message send error:', error);
        res.status(500).json({
            success: false,
            error: 'فشل في إرسال الرسائل الجماعية',
            details: error.message,
            code: 'SEND_BULK_MESSAGE_FAILED'
        });
    }
});

// جلب الرسائل المستقبلة من رقم معين (مع API Key في الرابط)
router.get('/:apiKey/messages-from/:phoneNumber', validateApiKeyMiddleware, validateSessionTokenMiddleware, async (req, res) => {
    try {
        const { sessionId } = req.sessionTokenInfo;
        const { phoneNumber } = req.params;
        const { limit = 50 } = req.query;
        const lim = Math.min(parseInt(limit) || 50, 200);
        
        // تنظيف رقم الهاتف
        const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
        const chatId = `${cleanPhone}@c.us`;
        
        // جلب الرسائل المستقبلة فقط (from_me = 0) من هذا الرقم
        const rows = db.prepare(`
            SELECT id, session_id, chat_id, message_id, from_me, type, body, has_media, media_mime_type, sender, receiver, timestamp 
            FROM messages 
            WHERE session_id = ? AND chat_id = ? AND from_me = 0 
            ORDER BY id DESC 
            LIMIT ?
        `).all(String(sessionId), chatId, lim);
        
        res.json({
            success: true,
            phoneNumber: cleanPhone,
            count: rows.length,
            messages: rows
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'فشل في جلب الرسائل',
            details: error.message
        });
    }
});

// جلب الرسائل المستقبلة من رقم معين (مع API Key في الهيدر)
router.get('/messages-from/:phoneNumber', validateApiKeyMiddleware, validateSessionTokenMiddleware, async (req, res) => {
    try {
        const { sessionId } = req.sessionTokenInfo;
        const { phoneNumber } = req.params;
        const { limit = 50 } = req.query;
        const lim = Math.min(parseInt(limit) || 50, 200);
        
        // تنظيف رقم الهاتف
        const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
        const chatId = `${cleanPhone}@c.us`;
        
        // جلب الرسائل المستقبلة فقط (from_me = 0) من هذا الرقم
        const rows = db.prepare(`
            SELECT id, session_id, chat_id, message_id, from_me, type, body, has_media, media_mime_type, sender, receiver, timestamp 
            FROM messages 
            WHERE session_id = ? AND chat_id = ? AND from_me = 0 
            ORDER BY id DESC 
            LIMIT ?
        `).all(String(sessionId), chatId, lim);
        
        res.json({
            success: true,
            phoneNumber: cleanPhone,
            count: rows.length,
            messages: rows
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'فشل في جلب الرسائل',
            details: error.message
        });
    }
});

// جلب جهات الاتصال (مع API Key في الرابط)
router.get('/:apiKey/contacts', validateApiKeyMiddleware, validateSessionTokenMiddleware, async (req, res) => {
    try {
        const { sessionId } = req.sessionTokenInfo;
        
        // التحقق من وجود الجلسة
        const client = activeClientsRef ? activeClientsRef.get(String(sessionId)) : null;
        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'الجلسة غير موجودة أو غير متصلة',
                code: 'SESSION_NOT_FOUND'
            });
        }
        
        // التحقق من أن الجلسة جاهزة
        if (!client.info) {
            return res.status(400).json({
                success: false,
                error: 'الجلسة غير جاهزة بعد. يرجى المحاولة لاحقاً',
                code: 'SESSION_NOT_READY'
            });
        }
        
        // جلب جهات الاتصال
        const contacts = await client.getContacts();
        
        // تنسيق البيانات
        const formattedContacts = contacts.map(contact => ({
            id: contact.id._serialized,
            number: contact.id.user,
            name: contact.pushname || contact.name || contact.id.user,
            isUser: contact.isUser || false,
            isMyContact: contact.isMyContact || false,
            isGroup: contact.isGroup || false,
            isBusiness: contact.isBusiness || false
        }));
        
        res.json({
            success: true,
            count: formattedContacts.length,
            contacts: formattedContacts
        });
        
    } catch (error) {
        console.error('Get contacts error:', error);
        res.status(500).json({
            success: false,
            error: 'فشل في جلب جهات الاتصال',
            details: error.message,
            code: 'GET_CONTACTS_FAILED'
        });
    }
});

// جلب جهات الاتصال (مع API Key في الهيدر)
router.get('/contacts', validateApiKeyMiddleware, validateSessionTokenMiddleware, async (req, res) => {
    try {
        const { sessionId } = req.sessionTokenInfo;
        
        // التحقق من وجود الجلسة
        const client = activeClientsRef ? activeClientsRef.get(String(sessionId)) : null;
        if (!client) {
            return res.status(404).json({
                success: false,
                error: 'الجلسة غير موجودة أو غير متصلة',
                code: 'SESSION_NOT_FOUND'
            });
        }
        
        // التحقق من أن الجلسة جاهزة
        if (!client.info) {
            return res.status(400).json({
                success: false,
                error: 'الجلسة غير جاهزة بعد. يرجى المحاولة لاحقاً',
                code: 'SESSION_NOT_READY'
            });
        }
        
        // جلب جهات الاتصال
        const contacts = await client.getContacts();
        
        // تنسيق البيانات
        const formattedContacts = contacts.map(contact => ({
            id: contact.id._serialized,
            number: contact.id.user,
            name: contact.pushname || contact.name || contact.id.user,
            isUser: contact.isUser || false,
            isMyContact: contact.isMyContact || false,
            isGroup: contact.isGroup || false,
            isBusiness: contact.isBusiness || false
        }));
        
        res.json({
            success: true,
            count: formattedContacts.length,
            contacts: formattedContacts
        });
        
    } catch (error) {
        console.error('Get contacts error:', error);
        res.status(500).json({
            success: false,
            error: 'فشل في جلب جهات الاتصال',
            details: error.message,
            code: 'GET_CONTACTS_FAILED'
        });
    }
});

// ========================================
// مسار اختبار بسيط
// ========================================

// مسار اختبار للتأكد من أن API يعمل
router.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'API يعمل بشكل صحيح',
        timestamp: new Date().toISOString()
    });
});

// مسار اختبار مع API Key
router.get('/:apiKey/test', validateApiKeyMiddleware, (req, res) => {
    res.json({
        success: true,
        message: 'API Key صحيح',
        userId: req.apiKeyInfo.userId,
        username: req.apiKeyInfo.username,
        timestamp: new Date().toISOString()
    });
});

// مسار debug لمعرفة حالة الجلسات
router.get('/:apiKey/debug-sessions', validateApiKeyMiddleware, (req, res) => {
    try {
        const { userId } = req.apiKeyInfo;
        
        // الحصول على جميع الجلسات للمستخدم
        const sessionsStmt = db.prepare('SELECT * FROM sessions WHERE user_id = ?');
        const sessions = sessionsStmt.all(userId);
        
        // الحصول على جميع التوكنات للمستخدم
        const tokensStmt = db.prepare('SELECT * FROM session_tokens WHERE user_id = ?');
        const tokens = tokensStmt.all(userId);
        
        // الحصول على الجلسات النشطة في الذاكرة
        const activeSessions = [];
        if (activeClientsRef) {
            for (const [sessionId, client] of activeClientsRef.entries()) {
                activeSessions.push({
                    sessionId: sessionId,
                    state: client.state
                });
            }
        }
        
        res.json({
            success: true,
            sessions: sessions,
            tokens: tokens,
            activeSessions: activeSessions,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'فشل في الحصول على معلومات التصحيح',
            details: error.message
        });
    }
});

// مسار إعادة تشغيل جلسة محددة
router.post('/:apiKey/restart-session', validateApiKeyMiddleware, validateSessionTokenMiddleware, async (req, res) => {
    try {
        const { userId } = req.apiKeyInfo;
        const { sessionId } = req.sessionTokenInfo;
        
        // التحقق من أن الجلسة تخص المستخدم
        const sessionStmt = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?');
        const session = sessionStmt.get(sessionId, userId);
        
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'الجلسة غير موجودة',
                code: 'SESSION_NOT_FOUND'
            });
        }
        
        // إيقاف الجلسة الحالية إذا كانت موجودة
        if (activeClientsRef && activeClientsRef.has(sessionId)) {
            const currentClient = activeClientsRef.get(sessionId);
            await destroyClientCompletely(sessionId, currentClient, null);
            activeClientsRef.delete(sessionId);
        }
        
        // إنشاء جلسة جديدة
        const { Client, LocalAuth } = require('whatsapp-web.js');
        const path = require('path');
        
        const client = new Client({
            authStrategy: new LocalAuth({
                clientId: `session_${sessionId}`,
                dataPath: path.join(__dirname, 'sessions')
            }),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        });
        
        activeClientsRef.set(sessionId, client);
        
        // انتظار الجلسة لتكون جاهزة
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                activeClientsRef.delete(sessionId);
                reject(new Error('Timeout waiting for session'));
            }, 30000);
            
            client.on('ready', () => {
                clearTimeout(timeout);
                resolve();
            });
            
            client.on('disconnected', (reason) => {
                clearTimeout(timeout);
                activeClientsRef.delete(sessionId);
                reject(new Error(`Session disconnected: ${reason}`));
            });
            
            client.on('auth_failure', (msg) => {
                clearTimeout(timeout);
                activeClientsRef.delete(sessionId);
                reject(new Error(`Authentication failed: ${msg}`));
            });
            
            try {
                client.initialize();
            } catch (initError) {
                clearTimeout(timeout);
                activeClientsRef.delete(sessionId);
                reject(new Error(`Failed to initialize client: ${initError.message}`));
            }
        });
        
        res.json({
            success: true,
            message: 'تم إعادة تشغيل الجلسة بنجاح',
            sessionId: sessionId,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error restarting session:', error);
        res.status(500).json({
            success: false,
            error: 'فشل في إعادة تشغيل الجلسة',
            details: error.message,
            code: 'SESSION_RESTART_FAILED'
        });
    }
});

// ========================================
// مسارات إضافية مع API Key في الرابط
// ========================================

// الحصول على معلومات التوكن لجلسة محددة (مع API Key في الرابط)
router.get('/:apiKey/session/:sessionId/token', validateApiKeyMiddleware, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { sessionId } = req.params;
        const { userId } = req.apiKeyInfo;
        
        // التحقق من أن الجلسة تنتمي للمستخدم
        const sessionStmt = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?');
        const session = sessionStmt.get(sessionId, userId);
        
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'الجلسة غير موجودة',
                code: 'SESSION_NOT_FOUND'
            });
        }
        
        // البحث عن توكن الجلسة أو إنشاؤه
        const { getSessionTokenBySessionId, createSessionToken } = require('./api-key-manager');
        let token = getSessionTokenBySessionId(userId, String(session.id));
        if (!token) {
            const result = createSessionToken(userId, String(session.id));
            token = result.token;
        }
        
        const responseTime = Date.now() - startTime;
        
        res.json({
            success: true,
            sessionId: session.id,
            sessionName: session.session_name,
            token: token,
            status: session.status,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        const responseTime = Date.now() - startTime;
        
        console.error('Error getting session token:', error);
        res.status(500).json({
            success: false,
            error: 'فشل في الحصول على توكن الجلسة',
            details: error.message,
            code: 'GET_SESSION_TOKEN_FAILED'
        });
    }
});

// ========================================
// مسارات الباقات والاشتراكات
// ========================================

const PackageManager = require('./package-manager');

// الحصول على جميع الباقات المتاحة
router.get('/packages', (req, res) => {
    try {
        const packages = PackageManager.getAllPackages();
        res.json({
            success: true,
            data: packages.map(pkg => ({
                ...pkg,
                features: JSON.parse(pkg.features || '[]')
            }))
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'خطأ في جلب الباقات',
            details: error.message
        });
    }
});

// الحصول على باقة محددة
router.get('/packages/:id', (req, res) => {
    try {
        const package = PackageManager.getPackageById(req.params.id);
        if (!package) {
            return res.status(404).json({
                success: false,
                error: 'الباقة غير موجودة'
            });
        }
        
        res.json({
            success: true,
            data: {
                ...package,
                features: JSON.parse(package.features || '[]')
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'خطأ في جلب الباقة',
            details: error.message
        });
    }
});

// إنشاء اشتراك جديد (يتطلب تسجيل دخول)
router.post('/subscriptions', (req, res) => {
    try {
        const { packageId, paymentMethod } = req.body;
        
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                error: 'يجب تسجيل الدخول أولاً'
            });
        }

        if (!packageId) {
            return res.status(400).json({
                success: false,
                error: 'معرف الباقة مطلوب'
            });
        }

        // التحقق من وجود باقة نشطة للمستخدم
        const activeSubscription = PackageManager.getUserActiveSubscription(req.session.userId);
        if (activeSubscription) {
            return res.status(400).json({
                success: false,
                error: 'لديك اشتراك نشط بالفعل'
            });
        }

        // إنشاء الاشتراك
        const result = PackageManager.createSubscription(req.session.userId, packageId, 'pending');
        
        res.json({
            success: true,
            message: 'تم إنشاء الاشتراك بنجاح',
            data: {
                subscriptionId: result.lastInsertRowid,
                status: 'pending'
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'خطأ في إنشاء الاشتراك',
            details: error.message
        });
    }
});

// الحصول على اشتراكات المستخدم
router.get('/subscriptions', (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                error: 'يجب تسجيل الدخول أولاً'
            });
        }

        const subscriptions = PackageManager.getUserSubscriptions(req.session.userId);
        const activeSubscription = PackageManager.getUserActiveSubscription(req.session.userId);
        
        res.json({
            success: true,
            data: {
                subscriptions,
                activeSubscription
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'خطأ في جلب الاشتراكات',
            details: error.message
        });
    }
});

// الحصول على حالة اشتراك المستخدم
router.get('/subscription/status', (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({
                success: false,
                error: 'يجب تسجيل الدخول أولاً'
            });
        }

        const subscription = PackageManager.getUserActiveSubscription(req.session.userId);
        const maxSessions = PackageManager.getUserMaxSessions(req.session.userId);
        const isValid = PackageManager.isUserSubscriptionValid(req.session.userId);
        
        res.json({
            success: true,
            data: {
                hasActiveSubscription: !!subscription,
                subscription,
                maxSessions,
                isValid
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'خطأ في جلب حالة الاشتراك',
            details: error.message
        });
    }
});

// الحصول على إعدادات النظام
router.get('/system/settings', (req, res) => {
    try {
        const settings = PackageManager.getSystemSettings();
        res.json({
            success: true,
            data: settings
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'خطأ في جلب إعدادات النظام',
            details: error.message
        });
    }
});

// ========================================
// مسارات الإدارة (للأدمن فقط)
// ========================================

// التحقق من صلاحيات الأدمن
function requireAdmin(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            error: 'يجب تسجيل الدخول أولاً'
        });
    }

    const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
    if (!user || !user.is_admin) {
        return res.status(403).json({
            success: false,
            error: 'صلاحيات غير كافية'
        });
    }

    next();
}

// إدارة الباقات (للأدمن)
router.post('/admin/packages', requireAdmin, (req, res) => {
    try {
        const { name, description, price, currency, duration_days, max_sessions, features } = req.body;
        
        if (!name || !price || !duration_days || !max_sessions) {
            return res.status(400).json({
                success: false,
                error: 'جميع الحقول المطلوبة يجب أن تكون موجودة'
            });
        }

        const result = PackageManager.createPackage({
            name,
            description,
            price: parseFloat(price),
            currency: currency || 'USD',
            duration_days: parseInt(duration_days),
            max_sessions: parseInt(max_sessions),
            features: Array.isArray(features) ? features : []
        });

        res.json({
            success: true,
            message: 'تم إنشاء الباقة بنجاح',
            data: { id: result.lastInsertRowid }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'خطأ في إنشاء الباقة',
            details: error.message
        });
    }
});

router.put('/admin/packages/:id', requireAdmin, (req, res) => {
    try {
        const { name, description, price, currency, duration_days, max_sessions, features } = req.body;
        
        const result = PackageManager.updatePackage(req.params.id, {
            name,
            description,
            price: parseFloat(price),
            currency: currency || 'USD',
            duration_days: parseInt(duration_days),
            max_sessions: parseInt(max_sessions),
            features: Array.isArray(features) ? features : []
        });

        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                error: 'الباقة غير موجودة'
            });
        }

        res.json({
            success: true,
            message: 'تم تحديث الباقة بنجاح'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'خطأ في تحديث الباقة',
            details: error.message
        });
    }
});

router.delete('/admin/packages/:id', requireAdmin, (req, res) => {
    try {
        const result = PackageManager.deletePackage(req.params.id);
        
        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                error: 'الباقة غير موجودة'
            });
        }

        res.json({
            success: true,
            message: 'تم حذف الباقة بنجاح'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'خطأ في حذف الباقة',
            details: error.message
        });
    }
});

// تحديث إعدادات النظام
router.put('/admin/system/settings', requireAdmin, (req, res) => {
    try {
        const { admin_phone, admin_email, support_whatsapp, company_name, company_address, terms_conditions, privacy_policy } = req.body;
        
        PackageManager.updateSystemSettings({
            admin_phone,
            admin_email,
            support_whatsapp,
            company_name,
            company_address,
            terms_conditions,
            privacy_policy
        });

        res.json({
            success: true,
            message: 'تم تحديث إعدادات النظام بنجاح'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'خطأ في تحديث إعدادات النظام',
            details: error.message
        });
    }
});

// إحصائيات النظام
router.get('/admin/stats', requireAdmin, (req, res) => {
    try {
        const subscriptionStats = PackageManager.getSubscriptionStats();
        const packageStats = PackageManager.getPackageStats();
        
        res.json({
            success: true,
            data: {
                subscriptions: subscriptionStats,
                packages: packageStats
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'خطأ في جلب الإحصائيات',
            details: error.message
        });
    }
});

// ========================================
// معالجة الأخطاء
// ========================================

// معالجة أخطاء multer
router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'حجم الملف كبير جداً (الحد الأقصى 16MB)',
                code: 'FILE_TOO_LARGE'
            });
        }
    }
    
    if (error.message === 'نوع الملف غير مدعوم') {
        return res.status(400).json({
            success: false,
            error: 'نوع الملف غير مدعوم',
            code: 'UNSUPPORTED_FILE_TYPE'
        });
    }
    
    next(error);
});

module.exports = { router, setActiveClientsRef };
