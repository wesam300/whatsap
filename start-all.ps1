# Start WhatsApp Dashboard Project (All Services)
$ErrorActionPreference = "Stop"

Write-Host "🚀 Starting WhatsApp Dashboard System..." -ForegroundColor Green

# 1. Start Reporting Service (Port 3001)
Write-Host "📊 Starting Reporting Service..." -ForegroundColor Cyan
$reportingPath = Join-Path $PSScriptRoot "whatsapp-dashboard-app\reporting-service"

if (Test-Path $reportingPath) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$reportingPath'; echo 'Starting Reporting Service on Port 3001...'; npm start"
} else {
    Write-Host "❌ Reporting Service directory not found at $reportingPath" -ForegroundColor Red
}

# 2. Start Main Application (Port 3000)
Write-Host "📱 Starting Main Dashboard..." -ForegroundColor Cyan
$mainPath = Join-Path $PSScriptRoot "whatsapp-dashboard-app"

if (Test-Path $mainPath) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$mainPath'; echo 'Starting Main Dashboard on Port 3000...'; npm start"
} else {
    Write-Host "❌ Main Application directory not found at $mainPath" -ForegroundColor Red
}

Write-Host "✅ System startup initiated!" -ForegroundColor Green
Write-Host "   - Main Dashboard: http://localhost:3000"
Write-Host "   - Reporting Service: http://localhost:3001"
Write-Host "   (Check the opened windows for logs)"
