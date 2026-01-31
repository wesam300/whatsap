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

// دالة لتنظيف عمليات Chrome الزائدة (Zombies)
async function cleanupChromeZombies() {
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);
    const platform = process.platform;

    console.log('🧹 بدء تنظيف عمليات Chrome المعلقة (Zombies)...');

    try {
        if (platform === 'linux' || platform === 'darwin') {
            // البحث عن العمليات التي تحتوي على مسار الجلسات في سطر الأوامر
            // نستخدم نمط محدد جداً لتجنب إغلاق متصفحات أخرى
            try {
                // البحث عن PIDs
                const { stdout } = await execAsync('pgrep -f "chrome.*session-session_"');
                const pids = stdout.trim().split('\n').filter(Boolean);

                if (pids.length > 0) {
                    console.log(`🔫 تم العثور على ${pids.length} عملية معلقة: ${pids.join(', ')}`);
                    // قتل العمليات بقوة
                    await execAsync(`kill -9 ${pids.join(' ')}`);
                    console.log('✅ تم تنظيف جميع العمليات المعلقة بنجاح');
                    return pids.length;
                } else {
                    console.log('✨ لا توجد عمليات معلقة');
                }
            } catch (e) {
                if (e.code === 1) {
                    console.log('✨ لا توجد عمليات معلقة');
                } else {
                    throw e;
                }
            }
        } else if (platform === 'win32') {
            try {
                // استخدام WMIC للويندوز
                await execAsync('wmic process where "name=\'chrome.exe\' and commandline like \'%session-session_%\'" call terminate');
                console.log('✅ تمت محاولة تنظيف العمليات على Windows');
            } catch (e) {
                // تجاهل الأخطاء في ويندوز لأنها قد تعني عدم وجود عمليات
                console.log('ℹ️ محاولة التنظيف على Windows انتهت');
            }
        }
    } catch (error) {
        console.error('⚠️ خطأ أثناء تنظيف العمليات المعلقة:', error.message);
    }
    return 0;
}

// دالة مساعدة لإعداد خيارات Puppeteer لتعطيل تخزين الميديا
function getPuppeteerOptions() {
    return {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            // تعطيل تخزين الميديا والكاش
            '--disable-dev-shm-usage',
            '--disable-application-cache',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-breakpad',
            '--disable-client-side-phishing-detection',
            '--disable-component-update',
            '--disable-default-apps',
            '--disable-domain-reliability',
            '--disable-features=TranslateUI',
            '--disable-hang-monitor',
            '--disable-ipc-flooding-protection',
            '--disable-notifications',
            '--disable-offer-store-unmasked-wallet-cards',
            '--disable-popup-blocking',
            '--disable-prompt-on-repost',
            '--disable-renderer-backgrounding',
            '--disable-sync',
            '--disable-translate',
            '--metrics-recording-only',
            '--no-first-run',
            '--safebrowsing-disable-auto-update',
            '--enable-automation',
            '--password-store=basic',
            '--use-mock-keychain',
            // تعطيل blob storage و IndexedDB
            '--disable-blink-features=AutomationControlled',
            '--disable-features=BlinkHeapDirtyFlag,BlinkHeapIncrementalMarking',
        ],
        // تعطيل تخزين الملفات المؤقتة
        ignoreDefaultArgs: ['--enable-automation'],
    };
}

module.exports = {
    destroyClientCompletely,
    cleanupChromeZombies,
    getPuppeteerOptions
};

