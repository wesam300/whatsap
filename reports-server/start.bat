@echo off
echo ========================================
echo   سيرفر التقارير - WhatsApp Reports
echo ========================================
echo.

if not exist node_modules (
    echo جاري تثبيت المكتبات...
    call npm install
    echo.
)

if not exist .env (
    echo تحذير: ملف .env غير موجود!
    echo يرجى نسخ .env.example إلى .env وتعديله
    echo.
    pause
)

echo بدء تشغيل السيرفر...
echo.
node server.js

pause

