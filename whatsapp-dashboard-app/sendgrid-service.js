// ========================================
// خدمة SendGrid لإرسال البريد الإلكتروني
// ========================================
// بديل مجاني ومتطور لـ Gmail SMTP

const sgMail = require('@sendgrid/mail');

// ========================================
// إعدادات SendGrid
// ========================================
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || 'SG.your-api-key-here';

// تهيئة SendGrid
if (SENDGRID_API_KEY && SENDGRID_API_KEY !== 'SG.your-api-key-here') {
    sgMail.setApiKey(SENDGRID_API_KEY);
    console.log('✅ SendGrid تم تهيئته بنجاح');
} else {
    console.log('⚠️ SendGrid لم يتم تهيئته، سيتم استخدام الخدمة البديلة');
}

// ========================================
// دالة إرسال رمز التحقق
// ========================================
async function sendVerificationEmailViaSendGrid(email, verificationCode, username) {
    if (!SENDGRID_API_KEY || SENDGRID_API_KEY === 'SG.your-api-key-here') {
        throw new Error('SendGrid API Key غير مهيأ');
    }

    const msg = {
        to: email,
        from: 'noreply@whatsapp-dashboard.com', // يمكنك تغييرها
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
                    
                    <hr style="border: none; border-top: 1px solid #e1e5e9; margin: 30px 0;">
                    
                    <div style="text-align: center; color: #999; font-size: 12px;">
                        <p>هذا البريد الإلكتروني تم إرساله عبر SendGrid</p>
                        <p>لا ترد على هذا البريد الإلكتروني</p>
                    </div>
                </div>
            </div>
        `
    };

    try {
        const result = await sgMail.send(msg);
        console.log('✅ تم إرسال البريد عبر SendGrid:', result[0].headers['x-message-id']);
        return { success: true, messageId: result[0].headers['x-message-id'] };
    } catch (error) {
        console.error('❌ خطأ في إرسال البريد عبر SendGrid:', error);
        throw new Error('فشل في إرسال البريد عبر SendGrid');
    }
}

module.exports = {
    sendVerificationEmailViaSendGrid,
    isSendGridAvailable: () => SENDGRID_API_KEY && SENDGRID_API_KEY !== 'SG.your-api-key-here'
};
