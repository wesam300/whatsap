@echo off
REM ========================================
REM سكريبت تحديث السيرفر التلقائي (Windows)
REM ========================================

echo 🔄 بدء تحديث السيرفر...
echo.

REM الانتقال إلى مجلد المشروع
cd /d "%~dp0"

echo 📂 المجلد الحالي: %CD%
echo.

REM إيقاف الخادم
echo ⏸️ إيقاف الخادم...
taskkill /F /IM node.exe /FI "WINDOWTITLE eq *server.js*" >nul 2>&1
if %errorlevel% equ 0 (
    echo    ✅ تم إيقاف الخادم
) else (
    echo    ℹ️ لا توجد عملية node server.js نشطة
)
timeout /t 2 /nobreak >nul

REM جلب التحديثات
echo 📥 جلب التحديثات من GitHub...
git fetch origin
git pull origin main
if %errorlevel% neq 0 (
    echo ❌ فشل في جلب التحديثات
    pause
    exit /b 1
)

REM تثبيت الحزم
echo 📦 تثبيت/تحديث الحزم...
call npm install
if %errorlevel% neq 0 (
    echo ❌ فشل في تثبيت الحزم
    pause
    exit /b 1
)

REM إصلاح صلاحيات الأدمن
echo 🔧 إصلاح صلاحيات الأدمن...
if exist "fix-admin-permissions.js" (
    node fix-admin-permissions.js
) else (
    echo    ℹ️ ملف fix-admin-permissions.js غير موجود
)

REM تنظيف عمليات Chrome
echo 🧹 تنظيف عمليات Chrome المتبقية...
if exist "cleanup-chrome-processes.js" (
    node cleanup-chrome-processes.js
) else (
    echo    ℹ️ ملف cleanup-chrome-processes.js غير موجود
)

REM إعادة تشغيل الخادم
echo ▶️ إعادة تشغيل الخادم...
echo    ⚠️ يجب تشغيل الخادم يدوياً: node server.js
echo    أو استخدام PM2: pm2 restart whatsapp-dashboard

echo.
echo ✅ اكتمل التحديث بنجاح!
echo.
pause

