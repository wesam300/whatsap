# تحديث حزمة whatsapp-web.js
Write-Host "تحديث حزمة whatsapp-web.js إلى الإصدار الأحدث..." -ForegroundColor Green
Set-Location $PSScriptRoot
npm install whatsapp-web.js@latest
Write-Host "`nتم التحديث بنجاح!" -ForegroundColor Green
Write-Host "الإصدار الجديد: " -NoNewline
npm list whatsapp-web.js

