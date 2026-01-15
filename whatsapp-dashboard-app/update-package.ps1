# تحديث حزمة whatsapp-web.js
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "تحديث حزمة whatsapp-web.js" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $PSScriptRoot

Write-Host "[1/3] التحقق من الإصدار الحالي..." -ForegroundColor Yellow
try {
    npm list whatsapp-web.js --depth=0 2>&1 | Out-Host
} catch {
    Write-Host "   ⚠️ لا يمكن قراءة الإصدار الحالي" -ForegroundColor Yellow
}
Write-Host ""

Write-Host "[2/3] تحديث whatsapp-web.js إلى أحدث إصدار..." -ForegroundColor Yellow
try {
    npm install whatsapp-web.js@latest --save
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ فشل التحديث!" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ خطأ في التحديث: $_" -ForegroundColor Red
    exit 1
}
Write-Host ""

Write-Host "[3/3] التحقق من الإصدار الجديد..." -ForegroundColor Yellow
try {
    npm list whatsapp-web.js --depth=0 2>&1 | Out-Host
} catch {
    Write-Host "   ⚠️ لا يمكن قراءة الإصدار الجديد" -ForegroundColor Yellow
}
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "✅ تم التحديث بنجاح!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "📝 ملاحظات:" -ForegroundColor Yellow
Write-Host "- قد تحتاج لإعادة تشغيل الخادم" -ForegroundColor Gray
Write-Host "- قد تحتاج لحذف مجلد .wwebjs_cache إذا استمرت المشاكل" -ForegroundColor Gray
Write-Host ""

