@echo off
chcp 65001 >nul
echo ========================================
echo تحديث حزمة whatsapp-web.js
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] التحقق من الإصدار الحالي...
npm list whatsapp-web.js --depth=0 2>nul
echo.

echo [2/3] تحديث whatsapp-web.js إلى أحدث إصدار...
call npm install whatsapp-web.js@latest --save
if errorlevel 1 (
    echo.
    echo ❌ فشل التحديث!
    pause
    exit /b 1
)
echo.

echo [3/3] التحقق من الإصدار الجديد...
npm list whatsapp-web.js --depth=0 2>nul
echo.

echo ========================================
echo ✅ تم التحديث بنجاح!
echo ========================================
echo.
echo 📝 ملاحظات:
echo - قد تحتاج لإعادة تشغيل الخادم
echo - قد تحتاج لحذف مجلد .wwebjs_cache إذا استمرت المشاكل
echo.
echo اضغط أي مفتاح للخروج...
pause >nul

