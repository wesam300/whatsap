// ========================================
// إدارة الجلسات - دوال مشتركة
// ========================================
// يحتوي على دوال لإدارة الجلسات وإغلاقها بشكل كامل

// دالة مساعدة لإغلاق الجلسة بشكل كامل مع إغلاق عملية Chrome
async function destroyClientCompletely(sessionId, client, reconnectionTimers = null) {
    try {
        if (!client) {
            console.log(`[${sessionId}] لا يوجد عميل لإغلاقه`);
            return;
        }

        console.log(`[${sessionId}] بدء إغلاق الجلسة بشكل كامل...`);

        // إلغاء أي محاولات إعادة اتصال
        if (reconnectionTimers) {
            if (reconnectionTimers.has(String(sessionId))) {
                clearTimeout(reconnectionTimers.get(String(sessionId)));
                reconnectionTimers.delete(String(sessionId));
            }
        }

        // محاولة إغلاق العميل
        try {
            // الحصول على المتصفح من العميل إذا كان متاحاً
            const puppeteerBrowser = client.pupBrowser || null;
            
            // إغلاق المتصفح أولاً إذا كان متاحاً
            if (puppeteerBrowser) {
                try {
                    await puppeteerBrowser.close();
                    console.log(`[${sessionId}] تم إغلاق المتصفح بنجاح`);
                } catch (browserError) {
                    console.error(`[${sessionId}] خطأ في إغلاق المتصفح:`, browserError.message);
                }
            }
            
            // إغلاق العميل
            await client.destroy();
            
            console.log(`[${sessionId}] تم إغلاق العميل بنجاح`);
        } catch (destroyError) {
            console.error(`[${sessionId}] خطأ في إغلاق العميل:`, destroyError.message);
            
            // محاولة إجبار الإغلاق
            try {
                // الحصول على PID من المتصفح إذا كان متاحاً
                if (client.pupBrowser && client.pupBrowser.process) {
                    const pid = client.pupBrowser.process().pid;
                    if (pid) {
                        console.log(`[${sessionId}] محاولة إغلاق عملية Chrome بقوة (PID: ${pid})`);
                        // في Windows
                        if (process.platform === 'win32') {
                            const { exec } = require('child_process');
                            exec(`taskkill /F /T /PID ${pid}`, (error) => {
                                if (error) {
                                    console.error(`[${sessionId}] فشل في إغلاق العملية:`, error.message);
                                } else {
                                    console.log(`[${sessionId}] تم إغلاق العملية بنجاح`);
                                }
                            });
                        } else {
                            // في Linux/Mac
                            const { exec } = require('child_process');
                            exec(`kill -9 ${pid}`, (error) => {
                                if (error) {
                                    console.error(`[${sessionId}] فشل في إغلاق العملية:`, error.message);
                                } else {
                                    console.log(`[${sessionId}] تم إغلاق العملية بنجاح`);
                                }
                            });
                        }
                    }
                }
            } catch (forceCloseError) {
                console.error(`[${sessionId}] فشل في إغلاق العملية بقوة:`, forceCloseError.message);
            }
        }

        console.log(`[${sessionId}] تم إغلاق الجلسة بشكل كامل`);
    } catch (error) {
        console.error(`[${sessionId}] خطأ عام في إغلاق الجلسة:`, error.message);
    }
}

module.exports = {
    destroyClientCompletely
};

