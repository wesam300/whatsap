#!/bin/bash

# ========================================
# سكريبت تنظيف عمليات Chrome المتبقية (Linux/Mac)
# ========================================

echo "🧹 بدء تنظيف عمليات Chrome المتبقية..."

# البحث عن عمليات Chrome/Chromium
CHROME_PIDS=$(ps aux | grep -i chrome | grep -v grep | grep -v "cleanup-chrome" | awk '{print $2}')

if [ -z "$CHROME_PIDS" ]; then
    echo "✅ لا توجد عمليات Chrome نشطة"
    exit 0
fi

echo "📊 تم العثور على عمليات Chrome:"
ps aux | grep -i chrome | grep -v grep | grep -v "cleanup-chrome"

echo ""
echo "🔧 إغلاق عمليات Chrome..."

for PID in $CHROME_PIDS; do
    if [ ! -z "$PID" ]; then
        echo "   🔄 إغلاق العملية $PID..."
        kill -9 $PID 2>/dev/null
        if [ $? -eq 0 ]; then
            echo "   ✅ تم إغلاق العملية $PID"
        else
            echo "   ⚠️ لم يتم إغلاق العملية $PID (قد تكون انتهت بالفعل)"
        fi
    fi
done

echo ""
echo "✅ اكتمل التنظيف!"

