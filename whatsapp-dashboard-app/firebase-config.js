// ========================================
// إعدادات Firebase
// ========================================
// هذا الملف يحتوي على إعدادات Firebase لإرسال البريد الإلكتروني
// بدلاً من SMTP التقليدي

const admin = require('firebase-admin');

// ========================================
// إعدادات Firebase (يمكنك تغييرها)
// ========================================
const firebaseConfig = {
    // يمكنك الحصول على هذه البيانات من لوحة تحكم Firebase
    // https://console.firebase.google.com/
    apiKey: process.env.FIREBASE_API_KEY || "AIzaSyBxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "your-project.firebaseapp.com",
    projectId: process.env.FIREBASE_PROJECT_ID || "your-project-id",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "your-project.appspot.com",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "123456789",
    appId: process.env.FIREBASE_APP_ID || "1:123456789:web:abcdef123456"
};

// ========================================
// تهيئة Firebase
// ========================================
let firebaseApp;

try {
    // محاولة تهيئة Firebase
    firebaseApp = admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        ...firebaseConfig
    });
    console.log('✅ Firebase تم تهيئته بنجاح');
} catch (error) {
    console.log('⚠️ Firebase لم يتم تهيئته، سيتم استخدام الخدمة البديلة');
    firebaseApp = null;
}

// ========================================
// دالة إرسال البريد الإلكتروني عبر Firebase
// ========================================
async function sendEmailViaFirebase(to, subject, htmlContent) {
    if (!firebaseApp) {
        throw new Error('Firebase غير مهيأ');
    }

    try {
        // استخدام Firebase Functions لإرسال البريد الإلكتروني
        const result = await admin.firestore().collection('emails').add({
            to: to,
            subject: subject,
            html: htmlContent,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            status: 'pending'
        });

        console.log('✅ تم إرسال البريد الإلكتروني عبر Firebase:', result.id);
        return { success: true, messageId: result.id };
    } catch (error) {
        console.error('❌ خطأ في إرسال البريد عبر Firebase:', error);
        throw new Error('فشل في إرسال البريد عبر Firebase');
    }
}

// ========================================
// تصدير الدوال
// ========================================
module.exports = {
    firebaseApp,
    sendEmailViaFirebase,
    isFirebaseAvailable: () => firebaseApp !== null
};
