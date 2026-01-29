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
            const puppeteerBrowser = client.pupBrowser || client.pupPage?.browser() || null;
            
            // إغلاق المتصفح أولاً إذا كان متاحاً
            if (puppeteerBrowser) {
                try {
                    // الحصول على جميع الصفحات وإغلاقها
                    const pages = await puppeteerBrowser.pages();
                    for (const page of pages) {
                        try {
                            await page.close();
                        } catch (pageError) {
                            // تجاهل أخطاء إغلاق الصفحات
                        }
                    }
                    
                    // إغلاق المتصفح
                    await puppeteerBrowser.close();
                    console.log(`[${sessionId}] تم إغلاق المتصفح بنجاح`);
                    
                    // انتظار قليل للتأكد من إغلاق المتصفح
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (browserError) {
                    console.error(`[${sessionId}] خطأ في إغلاق المتصفح:`, browserError.message);
                }
            }
            
            // إغلاق العميل
            try {
                await client.destroy();
                console.log(`[${sessionId}] تم إغلاق العميل بنجاح`);
            } catch (destroyError) {
                console.error(`[${sessionId}] خطأ في إغلاق العميل:`, destroyError.message);
            }
        } catch (destroyError) {
            console.error(`[${sessionId}] خطأ في إغلاق العميل:`, destroyError.message);
            
            // محاولة إجبار الإغلاق
            try {
                // الحصول على PID من المتصفح إذا كان متاحاً
                const puppeteerBrowser = client.pupBrowser || client.pupPage?.browser() || null;
                if (puppeteerBrowser && puppeteerBrowser.process) {
                    const pid = puppeteerBrowser.process().pid;
                    if (pid) {
                        console.log(`[${sessionId}] محاولة إغلاق عملية Chrome بقوة (PID: ${pid})`);
                        const { exec } = require('child_process');
                        const { promisify } = require('util');
                        const execAsync = promisify(exec);
                        
                        try {
                            if (process.platform === 'win32') {
                                await execAsync(`taskkill /F /T /PID ${pid}`);
                            } else {
                                await execAsync(`kill -9 ${pid}`);
                            }
                            console.log(`[${sessionId}] تم إغلاق العملية بنجاح`);
                        } catch (killError) {
                            console.error(`[${sessionId}] فشل في إغلاق العملية:`, killError.message);
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

