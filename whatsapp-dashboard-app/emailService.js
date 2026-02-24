const nodemailer = require('nodemailer');

// ========================================
// خدمة إرسال البريد الإلكتروني
// ========================================
// هذا الملف يحتوي على إعدادات SMTP لإرسال رسائل التحقق
// وإعادة تعيين كلمة المرور عبر البريد الإلكتروني
//
// الإعدادات الحالية مخصصة لـ Gmail مع TLS (المنفذ 587)
// إذا واجهت مشاكل، راجع الإعدادات البديلة أدناه
//
// ملاحظات مهمة:
// 1. تأكد من تفعيل المصادقة الثنائية في Gmail
// 2. استخدم كلمة مرور التطبيق وليس كلمة مرور الحساب
// 3. تأكد من أن المنفذ 587 مفتوح في جدار الحماية
//
// ========================================
// إعدادات SMTP لـ Gmail
// ========================================
// الإعدادات الحالية تستخدم TLS (المنفذ 587)
// إذا واجهت مشاكل، جرب الإعدادات البديلة أدناه
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // استخدام TLS
    auth: {
        user: process.env.EMAIL_USER || 'wemu20@gmail.com', // بريدك الإلكتروني
        pass: process.env.EMAIL_PASS || 'skub bkxy ygor qpbu' // كلمة مرور التطبيق
    },
    tls: {
        rejectUnauthorized: false,
        ciphers: 'SSLv3'
    },
    connectionTimeout: 60000, // 60 ثانية
    greetingTimeout: 30000,   // 30 ثانية
    socketTimeout: 60000      // 60 ثانية
});

// ========================================
// إعدادات بديلة لـ Gmail مع SSL (المنفذ 465)
// ========================================
// استخدم هذه الإعدادات إذا واجهت مشاكل مع TLS
// const transporter = nodemailer.createTransport({
//     host: 'smtp.gmail.com',
//     port: 465,
//     secure: true, // استخدام SSL
//     auth: {
//         user: process.env.EMAIL_USER || 'wemu20@gmail.com',
//         pass: process.env.EMAIL_PASS || 'skub bkxy ygor qpbu'
//     },
//     connectionTimeout: 60000,
//     greetingTimeout: 30000,
//     socketTimeout: 60000
// });

// ========================================
// إعدادات بديلة لـ Gmail مع OAuth2 (متقدم)
// ========================================
// استخدم هذه الإعدادات إذا واجهت مشاكل مع SMTP العادي
// const transporter = nodemailer.createTransport({
//     service: 'gmail',
//     auth: {
//         type: 'OAuth2',
//         user: process.env.EMAIL_USER || 'wemu20@gmail.com',
//         clientId: process.env.GMAIL_CLIENT_ID,
//         clientSecret: process.env.GMAIL_CLIENT_SECRET,
//         refreshToken: process.env.GMAIL_REFRESH_TOKEN
//     }
// });

// ========================================
// إعدادات بديلة لـ SMTP المخصص
// ========================================
// استخدم هذه الإعدادات لمزودي البريد الإلكتروني الآخرين
// const transporter = nodemailer.createTransport({
//     host: 'smtp.your-provider.com',
//     port: 587,
//     secure: false,
//     auth: {
//         user: process.env.EMAIL_USER || 'wemu20@gmail.com',
//         pass: process.env.EMAIL_PASS || 'skub bkxy ygor qpbu'
//     }
// });

/**
 * إرسال رمز التحقق عبر البريد الإلكتروني
 * @param {string} email - البريد الإلكتروني المستلم
 * @param {string} verificationCode - رمز التحقق
 * @param {string} username - اسم المستخدم
 * @returns {Promise}
 */
async function sendVerificationEmail(email, verificationCode, username) {
    const mailOptions = {
        from: process.env.EMAIL_USER || 'wemu20@gmail.com',
        to: email,
        subject: 'تحقق من بريدك الإلكتروني - WhatsApp Dashboard',
        html: `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa;">
                <div style="background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                    <div style="text-align: center; margin-bottom: 30px;">
                        <h1 style="color: #25D366; margin: 0; font-size: 28px;">📱 WhatsApp Dashboard</h1>
                        <p style="color: #666; margin: 10px 0 0 0;">مرحباً ${username}!</p>
                    </div>
                    
                    <div style="background: #e8f5e8; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                        <h2 style="color: #155724; margin: 0 0 15px 0; text-align: center;">تحقق من بريدك الإلكتروني</h2>
                        <p style="color: #155724; margin: 0; text-align: center; line-height: 1.6;">
                            شكراً لك على التسجيل في WhatsApp Dashboard. 
                            لتفعيل حسابك، يرجى استخدام رمز التحقق التالي:
                        </p>
                    </div>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <div style="background: #25D366; color: white; padding: 20px; border-radius: 10px; display: inline-block; font-size: 24px; font-weight: bold; letter-spacing: 5px;">
                            ${verificationCode}
                        </div>
                    </div>
                    
                    <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                        <p style="color: #856404; margin: 0; font-size: 14px;">
                            <strong>ملاحظة:</strong> هذا الرمز صالح لمدة 10 دقائق فقط. 
                            إذا لم تقم بإنشاء هذا الحساب، يمكنك تجاهل هذا البريد الإلكتروني.
                        </p>
                    </div>
                    
                    <div style="text-align: center; margin-top: 30px;">
                        <p style="color: #666; margin: 0; font-size: 14px;">
                            إذا لم تستلم الرمز، تحقق من مجلد الرسائل غير المرغوب فيها
                        </p>
                    </div>
                    
                    <hr style="border: none; border-top: 1px solid #e1e5e9; margin: 30px 0;">
                    
                    <div style="text-align: center; color: #999; font-size: 12px;">
                        <p>هذا البريد الإلكتروني تم إرساله تلقائياً من WhatsApp Dashboard</p>
                        <p>لا ترد على هذا البريد الإلكتروني</p>
                    </div>
                </div>
            </div>
        `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent successfully:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Error sending email:', error);
        
        // رسائل خطأ أكثر تفصيلاً
        if (error.code === 'EAUTH') {
            throw new Error('خطأ في المصادقة: تأكد من صحة كلمة مرور التطبيق');
        } else if (error.code === 'ESOCKET') {
            throw new Error('خطأ في الاتصال: تأكد من إعدادات الشبكة');
        } else if (error.code === 'ECONNECTION') {
            throw new Error('فشل في الاتصال بخادم Gmail');
        } else {
            throw new Error(`فشل في إرسال البريد الإلكتروني: ${error.message}`);
        }
    }
}

/**
 * إرسال إشعار إعادة تعيين كلمة المرور
 * @param {string} email - البريد الإلكتروني المستلم
 * @param {string} resetToken - رمز إعادة التعيين
 * @param {string} username - اسم المستخدم
 * @returns {Promise}
 */
async function sendPasswordResetEmail(email, resetToken, username) {
    const resetLink = `${process.env.BASE_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;
    
    const mailOptions = {
        from: process.env.EMAIL_USER || 'wemu20@gmail.com',
        to: email,
        subject: 'إعادة تعيين كلمة المرور - WhatsApp Dashboard',
        html: `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa;">
                <div style="background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                    <div style="text-align: center; margin-bottom: 30px;">
                        <h1 style="color: #25D366; margin: 0; font-size: 28px;">📱 WhatsApp Dashboard</h1>
                        <p style="color: #666; margin: 10px 0 0 0;">مرحباً ${username}!</p>
                    </div>
                    
                    <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                        <h2 style="color: #856404; margin: 0 0 15px 0; text-align: center;">طلب إعادة تعيين كلمة المرور</h2>
                        <p style="color: #856404; margin: 0; text-align: center; line-height: 1.6;">
                            لقد تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بحسابك.
                        </p>
                    </div>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${resetLink}" style="background: #25D366; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                            إعادة تعيين كلمة المرور
                        </a>
                    </div>
                    
                    <div style="background: #f8d7da; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                        <p style="color: #721c24; margin: 0; font-size: 14px;">
                            <strong>تحذير:</strong> إذا لم تطلب إعادة تعيين كلمة المرور، 
                            يمكنك تجاهل هذا البريد الإلكتروني. الرابط صالح لمدة ساعة واحدة فقط.
                        </p>
                    </div>
                    
                    <div style="text-align: center; margin-top: 30px;">
                        <p style="color: #666; margin: 0; font-size: 14px;">
                            أو يمكنك نسخ الرابط التالي في المتصفح:
                        </p>
                        <p style="color: #25D366; margin: 10px 0 0 0; font-size: 12px; word-break: break-all;">
                            ${resetLink}
                        </p>
                    </div>
                    
                    <hr style="border: none; border-top: 1px solid #e1e5e9; margin: 30px 0;">
                    
                    <div style="text-align: center; color: #999; font-size: 12px;">
                        <p>هذا البريد الإلكتروني تم إرساله تلقائياً من WhatsApp Dashboard</p>
                        <p>لا ترد على هذا البريد الإلكتروني</p>
                    </div>
                </div>
            </div>
        `
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('Password reset email sent successfully:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Error sending password reset email:', error);
        
        // رسائل خطأ أكثر تفصيلاً
        if (error.code === 'EAUTH') {
            throw new Error('خطأ في المصادقة: تأكد من صحة كلمة مرور التطبيق');
        } else if (error.code === 'ESOCKET') {
            throw new Error('خطأ في الاتصال: تأكد من إعدادات الشبكة');
        } else if (error.code === 'ECONNECTION') {
            throw new Error('فشل في الاتصال بخادم Gmail');
        } else {
            throw new Error(`فشل في إرسال بريد إعادة تعيين كلمة المرور: ${error.message}`);
        }
    }
}

// ========================================
// تصدير الدوال
// ========================================
// يتم تصدير الدوال التالية لاستخدامها في server.js
module.exports = {
    sendVerificationEmail,      // إرسال رمز التحقق
    sendPasswordResetEmail      // إرسال رابط إعادة تعيين كلمة المرور
};
