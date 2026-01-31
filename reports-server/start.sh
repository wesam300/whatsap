#!/bin/bash

echo "========================================"
echo "  سيرفر التقارير - WhatsApp Reports"
echo "========================================"
echo ""

if [ ! -d "node_modules" ]; then
    echo "جاري تثبيت المكتبات..."
    npm install
    echo ""
fi

if [ ! -f ".env" ]; then
    echo "تحذير: ملف .env غير موجود!"
    echo "يرجى نسخ .env.example إلى .env وتعديله"
    echo ""
    read -p "اضغط Enter للمتابعة..."
fi

echo "بدء تشغيل السيرفر..."
echo ""
node server.js

