// ========================================
// خدمة بريد إلكتروني متعددة الخيارات
// ========================================
// نظام ذكي يختار أفضل خدمة متاحة لإرسال البريد الإلكتروني

const { sendVerificationEmailViaSendGrid, isSendGridAvailable } = require('./sendgrid-service');
const { sendEmailViaFirebase, isFirebaseAvailable } = require('./firebase-config');

// ========================================
// دالة إرسال البريد الإلكتروني الذكية
// ========================================
async function sendVerificationEmail(email, verificationCode, username) {
    const emailContent = `
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
                    <p>هذا البريد الإلكتروني تم إرساله تلقائياً من WhatsApp Dashboard</p>
                    <p>لا ترد على هذا البريد الإلكتروني</p>
                </div>
            </div>
        </div>
    `;

    // ========================================
    // نظام Fallback الذكي
    // ========================================
    
    // المحاولة الأولى: SendGrid
    if (isSendGridAvailable()) {
        try {
            console.log('🔄 محاولة إرسال البريد عبر SendGrid...');
            return await sendVerificationEmailViaSendGrid(email, 'تحقق من بريدك الإلكتروني - WhatsApp Dashboard', emailContent);
        } catch (error) {
            console.log('❌ SendGrid فشل، جاري تجربة Firebase...');
        }
    }

    // المحاولة الثانية: Firebase
    if (isFirebaseAvailable()) {
        try {
            console.log('🔄 محاولة إرسال البريد عبر Firebase...');
            return await sendEmailViaFirebase(email, 'تحقق من بريدك الإلكتروني - WhatsApp Dashboard', emailContent);
        } catch (error) {
            console.log('❌ Firebase فشل، جاري تجربة الخدمة المحلية...');
        }
    }

    // المحاولة الأخيرة: الخدمة المحلية (محاكاة)
    try {
        console.log('🔄 استخدام الخدمة المحلية (محاكاة)...');
        return await sendEmailLocally(email, verificationCode, username);
    } catch (error) {
        console.error('❌ جميع الخدمات فشلت');
        throw new Error('فشل في إرسال البريد الإلكتروني عبر جميع الخدمات المتاحة');
    }
}

// ========================================
// الخدمة المحلية (محاكاة)
// ========================================
async function sendEmailLocally(email, verificationCode, username) {
    // محاكاة إرسال البريد الإلكتروني
    console.log('📧 محاكاة إرسال البريد الإلكتروني:');
    console.log('   إلى:', email);
    console.log('   الموضوع: تحقق من بريدك الإلكتروني');
    console.log('   رمز التحقق:', verificationCode);
    console.log('   اسم المستخدم:', username);
    
    // انتظار لمدة ثانية واحدة لمحاكاة الإرسال
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('✅ تم إرسال البريد الإلكتروني بنجاح (محاكاة)');
    return { success: true, messageId: 'local-' + Date.now() };
}

// ========================================
// دالة فحص حالة الخدمات
// ========================================
function getServiceStatus() {
    return {
        sendgrid: isSendGridAvailable(),
        firebase: isFirebaseAvailable(),
        local: true, // الخدمة المحلية متاحة دائماً
        recommended: isSendGridAvailable() ? 'SendGrid' : (isFirebaseAvailable() ? 'Firebase' : 'Local')
    };
}

module.exports = {
    sendVerificationEmail,
    getServiceStatus,
    sendEmailLocally
};
