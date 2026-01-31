# 📄 دليل استخدام نظام الفواتير

## 🎯 نظرة عامة

تم إضافة نظام خاص لإنشاء وإرسال الفواتير عبر الواتساب. يمكنك الآن:

1. ✅ إنشاء الفواتير من Oracle APEX
2. ✅ إرسالها مباشرة عبر الواتساب
3. ✅ حفظ HTML الفاتورة
4. ✅ إنشاء PDF وإرساله

## 🚀 الاستخدام السريع

### من Oracle APEX (JavaScript)

```javascript
// 1. أضف المكتبات في Page Attributes > JavaScript > File URLs:
// https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
// https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js
// http://your-server:3001/apex-invoice-helper.js

// 2. استخدم الدالة:
async function sendInvoice() {
    const result = await generatePDFAndSendToWhatsApp({
        reportsServerUrl: 'http://your-server:3001',
        whatsappApiUrl: 'https://srv998477.hstgr.cloud/api',
        apiKey: 'your_api_key',
        sessionToken: 'your_session_token',
        sessionId: '45',
        orderNo: $v('P3_ORDER_NO'),
        orderDate: $v('P3_ORDER_DATE'),
        customerName: $v('P3_CUSTOMER_NAME'),
        phone: $v('P3_PHONE'),
        flag: 'PAID',
        items: [
            {
                partname: 'صنف 1',
                store: 'مخزن 1',
                unit_name: 'قطعة',
                quant: 10,
                price: 100,
                total: 1000
            }
        ],
        total: 1000,
        phoneNumber: $v('P3_PHONE'),
        caption: 'فاتورة مبيعات'
    });
    
    if (result.success) {
        alert('✅ تم الإرسال!');
    }
}
```

### من PL/SQL

```sql
-- استدعاء API مباشرة
DECLARE
    l_response CLOB;
BEGIN
    l_response := apex_web_service.make_rest_request(
        p_url => 'http://your-server:3001/api/invoice/generate-and-send',
        p_http_method => 'POST',
        p_body => '{
            "orderNo": "12345",
            "orderDate": "01-01-2024",
            "customerName": "أحمد محمد",
            "phone": "0912345678",
            "flag": "PAID",
            "items": [
                {
                    "partname": "صنف 1",
                    "store": "مخزن 1",
                    "unit_name": "قطعة",
                    "quant": 10,
                    "price": 100,
                    "total": 1000
                }
            ],
            "total": 1000,
            "phoneNumber": "0912345678"
        }',
        p_content_type => 'application/json'
    );
END;
```

## 📋 API Endpoint

### POST `/api/invoice/generate-and-send`

**المعاملات المطلوبة:**

```json
{
    "orderNo": "رقم الطلب",
    "orderDate": "01-01-2024",
    "customerName": "اسم العميل",
    "customerNameEn": "Customer Name (اختياري)",
    "phone": "رقم الهاتف",
    "fullAddress": "العنوان الكامل (اختياري)",
    "flag": "PAID" أو "غير مدفوع",
    "items": [
        {
            "partname": "اسم الصنف",
            "store": "المخزن",
            "unit_name": "الوحدة",
            "quant": 10,
            "price": 100,
            "total": 1000
        }
    ],
    "total": 1000,
    "discount": 0,
    "discountAmount": 0,
    "phoneNumber": "رقم الواتساب (للإرسال)",
    "caption": "رسالة مرفقة (اختياري)"
}
```

**الاستجابة:**

```json
{
    "success": true,
    "message": "تم إنشاء وإرسال الفاتورة بنجاح",
    "html": "<html>...</html>",
    "reportUrl": "http://server/api/invoice/view?html=..."
}
```

## 🔧 الإعدادات

### 1. ملف `.env`:

```env
PORT=3001
WHATSAPP_API_URL=https://srv998477.hstgr.cloud/api
WHATSAPP_API_KEY=your_api_key
SESSION_TOKEN=your_session_token
SESSION_ID=45
REPORT_BASE_URL=http://your-server:3001
```

### 2. في APEX:

- أضف المكتبات المطلوبة (jsPDF, html2canvas)
- أضف ملف `apex-invoice-helper.js`
- استخدم الدوال الجاهزة

## 📝 مثال كامل

انظر إلى:
- `APEX_INTEGRATION.md` - دليل التكامل الكامل
- `APEX_EXAMPLE.sql` - أمثلة SQL/PL-SQL
- `apex-invoice-helper.js` - دوال JavaScript جاهزة

## 🎨 تخصيص التصميم

يمكنك تعديل تصميم الفاتورة في `server.js` في دالة `/api/invoice/generate-and-send`.

التصميم الحالي يشمل:
- ✅ Header مع معلومات الشركة
- ✅ Watermark للفواتير المبدئية
- ✅ جدول الأصناف
- ✅ حساب الخصومات
- ✅ تذييل مع التوقيعات

## ⚠️ ملاحظات مهمة

1. **CORS**: تأكد من تفعيل CORS في APEX إذا كان السيرفر على نطاق مختلف
2. **HTTPS**: للاستخدام في الإنتاج، استخدم HTTPS
3. **الأمان**: لا تضع API Keys في الكود المكشوف
4. **الأخطاء**: تحقق من حالة الجلسة قبل الإرسال

## 🆘 حل المشاكل

### الجلسة غير نشطة
```javascript
// تحقق من حالة الجلسة أولاً
const dbgRes = await fetch(`${whatsappApiUrl}/${apiKey}/debug-sessions`);
const dbg = await dbgRes.json();
// تحقق من dbg.activeSessions
```

### خطأ في CORS
- تأكد من إعدادات CORS في سيرفر التقارير
- استخدم HTTPS في الإنتاج

### خطأ في إنشاء PDF
- تأكد من إضافة jsPDF و html2canvas
- تحقق من أن HTML صحيح

## 📞 الدعم

للمزيد من المساعدة، راجع:
- `README.md` - الدليل الرئيسي
- `APEX_INTEGRATION.md` - دليل التكامل
- `QUICK_START.md` - البدء السريع

