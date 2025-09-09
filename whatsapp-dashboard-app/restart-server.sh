#!/bin/bash

echo "🚀 إعادة تشغيل خادم WhatsApp Dashboard..."

# إيقاف الخادم الحالي
echo "⏹️ إيقاف الخادم الحالي..."
pm2 stop whatsapp

# انتظار قليل
sleep 2

# تشغيل script التحديث
echo "🔧 تشغيل script التحديث..."
node update-server.js

# إعادة تشغيل الخادم
echo "▶️ إعادة تشغيل الخادم..."
pm2 start server.js --name whatsapp

# عرض حالة الخادم
echo "📊 حالة الخادم:"
pm2 status

# عرض السجلات
echo "📝 آخر 10 أسطر من السجل:"
pm2 logs whatsapp --lines 10

echo "✅ تم الانتهاء من إعادة التشغيل!"
