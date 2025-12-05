#!/bin/bash

# ========================================
# سكريبت تحديث السيرفر التلقائي
# ========================================

set -e  # إيقاف عند أي خطأ

echo "🔄 بدء تحديث السيرفر..."
echo ""

# الانتقال إلى مجلد المشروع
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "📂 المجلد الحالي: $(pwd)"
echo ""

# إيقاف الخادم
echo "⏸️ إيقاف الخادم..."
if command -v pm2 &> /dev/null; then
    pm2 stop whatsapp-dashboard 2>/dev/null || echo "   ℹ️ الخادم غير متوقف في PM2"
else
    pkill -f "node server.js" 2>/dev/null || echo "   ℹ️ لا توجد عملية node server.js"
fi
sleep 2

# جلب التحديثات
echo "📥 جلب التحديثات من GitHub..."
git fetch origin
git pull origin main || {
    echo "❌ فشل في جلب التحديثات"
    exit 1
}

# تثبيت الحزم
echo "📦 تثبيت/تحديث الحزم..."
npm install || {
    echo "❌ فشل في تثبيت الحزم"
    exit 1
}

# إصلاح صلاحيات الأدمن
echo "🔧 إصلاح صلاحيات الأدمن..."
if [ -f "fix-admin-permissions.js" ]; then
    node fix-admin-permissions.js || echo "   ⚠️ تحذير: فشل في إصلاح صلاحيات الأدمن"
else
    echo "   ℹ️ ملف fix-admin-permissions.js غير موجود"
fi

# تنظيف عمليات Chrome
echo "🧹 تنظيف عمليات Chrome المتبقية..."
if [ -f "cleanup-chrome-processes.js" ]; then
    node cleanup-chrome-processes.js || echo "   ⚠️ تحذير: فشل في تنظيف عمليات Chrome"
else
    echo "   ℹ️ ملف cleanup-chrome-processes.js غير موجود"
fi

# إعادة تشغيل الخادم
echo "▶️ إعادة تشغيل الخادم..."
if command -v pm2 &> /dev/null; then
    pm2 restart whatsapp-dashboard || pm2 start server.js --name whatsapp-dashboard
    echo "   ✅ الخادم يعمل في PM2"
    pm2 status
else
    echo "   ⚠️ PM2 غير مثبت، يجب تشغيل الخادم يدوياً:"
    echo "   node server.js"
fi

echo ""
echo "✅ اكتمل التحديث بنجاح!"
echo ""
echo "💡 نصيحة: تحقق من السجلات للتأكد من عمل الخادم بشكل صحيح"
echo "   pm2 logs whatsapp-dashboard"

