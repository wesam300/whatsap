@echo off
echo تحديث حزمة whatsapp-web.js...
cd /d "%~dp0"
npm install whatsapp-web.js@latest
echo.
echo تم التحديث بنجاح!
echo اضغط أي مفتاح للخروج...
pause >nul

