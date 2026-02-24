// ========================================
// إدارة الجلسات - دوال مشتركة
// ========================================

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');
const path = require('path');

// مسارات Chrome الشائعة (ويندوز / لينكس / ماك)
function getChromeExecutablePath() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        const p = process.env.PUPPETEER_EXECUTABLE_PATH.trim();
        if (fs.existsSync(p)) return p;
    }
    if (process.platform === 'win32') {
        const winPaths = [];
        if (process.env.LOCALAPPDATA) winPaths.push(process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe');
        if (process.env.PROGRAMFILES) winPaths.push(process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe');
        if (process.env['PROGRAMFILES(X86)']) winPaths.push(process.env['PROGRAMFILES(X86)'] + '\\Google\\Chrome\\Application\\chrome.exe');
        winPaths.push('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');
        for (const p of winPaths) {
            if (fs.existsSync(p)) return p;
        }
    }
    if (process.platform === 'linux') {
        const linuxPaths = [
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/snap/bin/chromium',
        ];
        for (const p of linuxPaths) {
            if (fs.existsSync(p)) return p;
        }
    }
    if (process.platform === 'darwin') {
        const macPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
        if (fs.existsSync(macPath)) return macPath;
    }
    return null;
}

// فحص صحة العميل - يتحقق من أن الجلسة تعمل بشكل صحيح
async function isClientHealthy(client) {
    try {
        if (!client) return false;
        if (!client.info) return false;
        if (!client.pupPage) return false;

        // التحقق من أن الصفحة ليست مغلقة
        try {
            if (typeof client.pupPage.isClosed === 'function' && client.pupPage.isClosed()) {
                return false;
            }
        } catch (e) {
            return false;
        }

        // محاولة تنفيذ أمر بسيط للتحقق من صحة الاتصال (timeout معقول لتقليل الانقطاع بسبب التأخر المؤقت)
        try {
            await Promise.race([
                client.pupPage.evaluate(() => true),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Health check timeout')), 12000))
            ]);
            return true;
        } catch (e) {
            return false;
        }
    } catch (e) {
        return false;
    }
}

// قتل أي عمليات Chrome تستخدم مجلد الجلسة (لحل مشكلة "browser is already running" على ويندوز)
async function killChromeProcessesForSession(sessionId) {
    const sid = String(sessionId);
    const pattern = `session-session_${sid}`;
    try {
        if (process.platform === 'win32') {
            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);
            const arg = '*' + pattern + '*';
            const psScript = "& { param($p) Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like $p } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }";
            await execAsync('powershell -NoProfile -Command "' + psScript + '" -ArgumentList "' + arg.replace(/"/g, '\\"') + '"').catch(() => { });
            await new Promise(r => setTimeout(r, 800));
        } else if (process.platform === 'linux' || process.platform === 'darwin') {
            const { stdout } = await execAsync(`pgrep -f "${pattern}"`).catch(() => ({ stdout: '' }));
            const pids = stdout.trim().split('\n').filter(Boolean);
            if (pids.length > 0) {
                await execAsync(`kill -9 ${pids.join(' ')}`).catch(() => { });
            }
        }
    } catch (e) {
        // تجاهل أخطاء القتل
    }
}

// دالة لإغلاق الجلسة بشكل كامل مع إغلاق عملية Chrome
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

        // الحصول على PID قبل محاولة الإغلاق
        let chromePid = null;
        try {
            const puppeteerBrowser = client.pupBrowser || (client.pupPage && client.pupPage.browser());
            if (puppeteerBrowser && puppeteerBrowser.process && puppeteerBrowser.process()) {
                chromePid = puppeteerBrowser.process().pid;
            }
        } catch (e) { }

        // محاولة إغلاق المتصفح أولاً
        try {
            const puppeteerBrowser = client.pupBrowser || (client.pupPage && client.pupPage.browser());
            if (puppeteerBrowser) {
                // إغلاق جميع الصفحات
                try {
                    const pages = await puppeteerBrowser.pages();
                    await Promise.all(pages.map(page => page.close().catch(() => { })));
                } catch (e) { }

                // إغلاق المتصفح
                await puppeteerBrowser.close().catch(() => { });
                console.log(`[${sessionId}] تم إغلاق المتصفح بنجاح`);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        } catch (e) { }

        // محاولة إغلاق العميل
        try {
            await client.destroy().catch(() => { });
            console.log(`[${sessionId}] تم إغلاق العميل بنجاح`);
        } catch (e) { }

        // إذا لم يُغلق المتصفح، استخدم kill
        if (chromePid) {
            if (process.platform === 'win32') {
                try {
                    await execAsync(`taskkill /F /PID ${chromePid}`).catch(() => { });
                } catch (e) { }
            } else if (process.platform === 'linux' || process.platform === 'darwin') {
                try {
                    await execAsync(`kill -9 ${chromePid}`).catch(() => { });
                } catch (e) { }
            }
        }

        // قتل أي عمليات Chrome مرتبطة بهذه الجلسة (لينكس/ماك/ويندوز)
        await killChromeProcessesForSession(String(sessionId));

        console.log(`[${sessionId}] تم إغلاق الجلسة بشكل كامل`);
    } catch (error) {
        console.error(`[${sessionId}] خطأ في إغلاق الجلسة:`, error.message);
    }
}

// دالة لتنظيف عمليات Chrome الزائدة (Zombies)
async function cleanupChromeZombies() {
    const platform = process.platform;
    console.log('🧹 بدء تنظيف عمليات Chrome المعلقة (Zombies)...');

    try {
        if (platform === 'linux' || platform === 'darwin') {
            try {
                const { stdout } = await execAsync('pgrep -f "chrome.*session-session_"').catch(() => ({ stdout: '' }));
                const pids = stdout.trim().split('\n').filter(Boolean);

                if (pids.length > 0) {
                    console.log(`🔫 تم العثور على ${pids.length} عملية معلقة: ${pids.join(', ')}`);

                    for (const pid of pids) {
                        try {
                            await execAsync(`kill -15 ${pid}`).catch(() => { });
                            await new Promise(resolve => setTimeout(resolve, 300));
                            await execAsync(`kill -9 ${pid}`).catch(() => { });
                        } catch (e) { }
                    }

                    await new Promise(resolve => setTimeout(resolve, 1000));
                    console.log('✅ تم تنظيف العمليات المعلقة');
                    return pids.length;
                } else {
                    console.log('✨ لا توجد عمليات معلقة');
                }
            } catch (e) {
                if (e.code === 1) {
                    console.log('✨ لا توجد عمليات معلقة');
                }
            }
        }
    } catch (error) {
        console.error('⚠️ خطأ أثناء تنظيف العمليات:', error.message);
    }
    return 0;
}

// تنظيف جميع عمليات Chrome غير المرتبطة بجلسات نشطة
async function cleanupOrphanedChromeProcesses(activeSessionIds = []) {
    if (process.platform !== 'linux' && process.platform !== 'darwin') return 0;

    try {
        const { stdout } = await execAsync('pgrep -f "chrome.*session-session_"').catch(() => ({ stdout: '' }));
        const pids = stdout.trim().split('\n').filter(Boolean);

        if (pids.length === 0) return 0;

        let killedCount = 0;
        for (const pid of pids) {
            try {
                const { stdout: cmdline } = await execAsync(`ps -p ${pid} -o args=`).catch(() => ({ stdout: '' }));

                // استخراج sessionId من سطر الأوامر
                const match = cmdline.match(/session-session_(\d+)/);
                if (match) {
                    const sessionId = match[1];
                    // إذا لم تكن الجلسة نشطة، اقتل العملية
                    if (!activeSessionIds.includes(sessionId) && !activeSessionIds.includes(parseInt(sessionId))) {
                        await execAsync(`kill -9 ${pid}`).catch(() => { });
                        killedCount++;
                    }
                }
            } catch (e) { }
        }

        if (killedCount > 0) {
            console.log(`🧹 تم إغلاق ${killedCount} عملية Chrome يتيمة`);
        }
        return killedCount;
    } catch (e) {
        return 0;
    }
}

// إعداد خيارات Puppeteer محسّنة لتقليل استهلاك الموارد
// استخدام Chrome المثبت على النظام إن وُجد (مطلوب مع puppeteer-core)
function getPuppeteerOptions() {
    const executablePath = getChromeExecutablePath();
    if (!executablePath) {
        if (!getPuppeteerOptions._chromeWarned) {
            getPuppeteerOptions._chromeWarned = true;
            console.warn('⚠️ لم يتم العثور على Chrome على النظام. ثبّت Chrome أو عيّن PUPPETEER_EXECUTABLE_PATH. أو نفّذ: npx puppeteer browsers install chrome');
        }
    } else if (!getPuppeteerOptions._chromeLogged) {
        getPuppeteerOptions._chromeLogged = true;
        console.log('✅ استخدام Chrome المثبت على النظام:', executablePath);
    }
    const opts = {
        headless: true,
        ...(executablePath ? { executablePath } : {}),
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-plugins',
            '--disable-software-rasterizer',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-breakpad',
            '--disable-client-side-phishing-detection',
            '--disable-component-update',
            '--disable-default-apps',
            '--disable-domain-reliability',
            '--disable-features=TranslateUI,BlinkGenPropertyTrees',
            '--disable-hang-monitor',
            '--disable-ipc-flooding-protection',
            '--disable-notifications',
            '--disable-offer-store-unmasked-wallet-cards',
            '--disable-popup-blocking',
            '--disable-prompt-on-repost',
            '--disable-renderer-backgrounding',
            '--disable-sync',
            '--disable-translate',
            '--disable-web-security',
            '--metrics-recording-only',
            '--no-first-run',
            '--no-zygote',
            // '--single-process', // تسبب مشاكل على Windows
            '--safebrowsing-disable-auto-update',
            '--enable-automation',
            '--password-store=basic',
            '--use-mock-keychain',
            '--disable-blink-features=AutomationControlled',
            '--memory-pressure-off',
            '--max-old-space-size=256',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
    };
    return opts;
}

module.exports = {
    destroyClientCompletely,
    killChromeProcessesForSession,
    cleanupChromeZombies,
    cleanupOrphanedChromeProcesses,
    getPuppeteerOptions,
    isClientHealthy
};
