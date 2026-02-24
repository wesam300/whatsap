@echo off
REM ========================================
REM سكريبت تنظيف عمليات Chrome المتبقية (Windows)
REM ========================================

echo 🧹 بدء تنظيف عمليات Chrome المتبقية...
echo.

REM البحث عن عمليات chrome.exe
for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq chrome.exe" /FO CSV ^| findstr /V "PID" ^| findstr "chrome.exe"') do (
    set PID=%%a
    set PID=!PID:"=!
    if not "!PID!"=="" (
        echo 🔄 إغلاق العملية !PID!...
        taskkill /F /T /PID !PID! >nul 2>&1
        if !errorlevel! equ 0 (
            echo    ✅ تم إغلاق العملية !PID!
        ) else (
            echo    ⚠️ لم يتم إغلاق العملية !PID! (قد تكون انتهت بالفعل)
        )
    )
)

echo.
echo ✅ اكتمل التنظيف!
pause

