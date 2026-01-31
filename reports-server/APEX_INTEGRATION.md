# 🔗 دليل التكامل مع Oracle APEX

## 📋 نظرة عامة

يمكنك استخدام سيرفر التقارير لإنشاء وإرسال الفواتير من Oracle APEX بدلاً من إنشاء HTML مباشرة في PL/SQL.

## 🚀 الطريقة 1: استخدام JavaScript في APEX

### 1. إضافة المكتبات المطلوبة

في صفحة APEX، أضف في **Page Attributes > JavaScript > File URLs**:

```html
<!-- jsPDF و html2canvas -->
https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js

<!-- ملف المساعد -->
http://your-reports-server:3001/apex-invoice-helper.js
```

### 2. إنشاء دالة JavaScript في APEX

في **Page Attributes > JavaScript > Function and Global Variable Declaration**:

```javascript
async function sendInvoiceToWhatsApp() {
    try {
        // جمع بيانات الفاتورة من الصفحة
        const orderNo = $v('P3_ORDER_NO');
        const orderDate = $v('P3_ORDER_DATE');
        const customerName = $v('P3_CUSTOMER_NAME');
        const phone = $v('P3_PHONE');
        
        // جمع الأصناف من جدول
        const items = [];
        // مثال: إذا كان لديك جدول تفاعلي
        $('#items_table tbody tr').each(function() {
            items.push({
                partname: $(this).find('.partname').text(),
                store: $(this).find('.store').text(),
                unit_name: $(this).find('.unit').text(),
                quant: parseFloat($(this).find('.quant').text()) || 0,
                price: parseFloat($(this).find('.price').text()) || 0,
                total: parseFloat($(this).find('.total').text()) || 0
            });
        });
        
        // إعدادات الإرسال
        const config = {
            reportsServerUrl: 'http://your-reports-server:3001', // رابط سيرفر التقارير
            whatsappApiUrl: 'https://srv998477.hstgr.cloud/api',
            apiKey: 'wa_401293125daf37cb993ac6f570c7edb93559d71dc9f75615f9a26858cbb87da7',
            sessionToken: 'st_e2c5493fe919e1f345297072bb1fe224125d6d3e7c6a15ea',
            sessionId: '45',
            orderNo: orderNo,
            orderDate: orderDate,
            customerName: customerName,
            phone: phone,
            flag: $v('P3_FLAG') || 'PAID',
            items: items,
            total: parseFloat($v('P3_TOTAL')) || 0,
            discount: parseFloat($v('P3_DISCOUNT')) || 0,
            discountAmount: parseFloat($v('P3_DISCOUNT_AMOUNT')) || 0,
            phoneNumber: phone,
            caption: `فاتورة مبيعات رقم: ${orderNo}\nبتاريخ: ${orderDate}`
        };
        
        // إرسال الفاتورة
        const result = await generatePDFAndSendToWhatsApp(config);
        
        if (result.success) {
            apex.message.showSuccess('✅ تم إرسال الفاتورة عبر WhatsApp بنجاح!');
            // حفظ HTML في حقل إذا أردت
            $s('P3_NEW', result.html);
        } else {
            apex.message.showErrors([{
                type: 'error',
                location: 'page',
                message: '❌ فشل الإرسال: ' + (result.error || 'خطأ غير معروف')
            }]);
        }
    } catch (error) {
        apex.message.showErrors([{
            type: 'error',
            location: 'page',
            message: '❌ خطأ: ' + error.message
        }]);
    }
}
```

### 3. استدعاء الدالة من زر

في **Button > Action > Execute JavaScript Code**:

```javascript
sendInvoiceToWhatsApp();
```

## 🔧 الطريقة 2: استخدام PL/SQL مع HTTP Request

### 1. إنشاء Procedure في APEX

```sql
CREATE OR REPLACE PROCEDURE send_invoice_via_reports_server (
    p_order_no VARCHAR2,
    p_order_date VARCHAR2,
    p_customer_name VARCHAR2,
    p_phone VARCHAR2,
    p_flag VARCHAR2 DEFAULT 'PAID',
    p_phone_number VARCHAR2,
    p_reports_server_url VARCHAR2 DEFAULT 'http://localhost:3001'
) AS
    l_items_json CLOB;
    l_request_body CLOB;
    l_response CLOB;
    l_http_request UTL_HTTP.req;
    l_http_response UTL_HTTP.resp;
    l_url VARCHAR2(4000);
BEGIN
    -- جمع الأصناف من sales_order_det
    SELECT JSON_ARRAYAGG(
        JSON_OBJECT(
            'partname' VALUE NVL((SELECT partname FROM SMSSPARE WHERE partno = part_code), ''),
            'store' VALUE NVL((SELECT store_abbrev FROM stores WHERE store_no=sales_order_det.store_no), ''),
            'unit_name' VALUE NVL((SELECT v.UNITNAME FROM SMSSPARE s JOIN V_LKPUNIT v ON s.UNITCODE = v.UNITCODE WHERE s.partno = part_code), ''),
            'quant' VALUE NVL(quant, 0),
            'price' VALUE NVL(price, 0),
            'total' VALUE NVL(quant, 0) * NVL(price, 0)
        )
    ) INTO l_items_json
    FROM sales_order_det
    WHERE order_no = p_order_no;
    
    -- إنشاء JSON للطلب
    l_request_body := '{
        "orderNo": "' || p_order_no || '",
        "orderDate": "' || p_order_date || '",
        "customerName": "' || REPLACE(p_customer_name, '"', '\"') || '",
        "phone": "' || p_phone || '",
        "flag": "' || p_flag || '",
        "items": ' || l_items_json || ',
        "total": ' || (SELECT SUM(quant * price) FROM sales_order_det WHERE order_no = p_order_no) || ',
        "phoneNumber": "' || p_phone_number || '",
        "caption": "فاتورة مبيعات رقم: ' || p_order_no || '"
    }';
    
    -- إرسال الطلب
    l_url := p_reports_server_url || '/api/invoice/generate-and-send';
    l_http_request := UTL_HTTP.begin_request(l_url, 'POST', 'HTTP/1.1');
    UTL_HTTP.set_header(l_http_request, 'Content-Type', 'application/json');
    UTL_HTTP.set_header(l_http_request, 'Content-Length', LENGTH(l_request_body));
    UTL_HTTP.write_text(l_http_request, l_request_body);
    l_http_response := UTL_HTTP.get_response(l_http_request);
    
    -- قراءة الاستجابة
    UTL_HTTP.read_text(l_http_response, l_response);
    UTL_HTTP.end_response(l_http_response);
    
    -- معالجة الاستجابة
    DBMS_OUTPUT.PUT_LINE('Response: ' || l_response);
    
EXCEPTION
    WHEN OTHERS THEN
        IF UTL_HTTP.INVALID_URL THEN
            UTL_HTTP.end_response(l_http_response);
        END IF;
        RAISE;
END;
/
```

### 2. استدعاء Procedure من APEX

في **Process > PL/SQL Code**:

```sql
BEGIN
    send_invoice_via_reports_server(
        p_order_no => :P3_ORDER_NO,
        p_order_date => :P3_ORDER_DATE,
        p_customer_name => :P3_CUSTOMER_NAME,
        p_phone => :P3_PHONE,
        p_flag => :P3_FLAG,
        p_phone_number => :P3_PHONE,
        p_reports_server_url => 'http://your-reports-server:3001'
    );
END;
```

## 📝 الطريقة 3: استخدام AJAX من APEX

### في JavaScript Function:

```javascript
function sendInvoiceViaAJAX() {
    apex.server.process(
        'SEND_INVOICE', // Process Name
        {
            x01: $v('P3_ORDER_NO'),
            x02: $v('P3_ORDER_DATE'),
            x03: $v('P3_CUSTOMER_NAME'),
            x04: $v('P3_PHONE')
        },
        {
            success: function(pData) {
                if (pData.success) {
                    apex.message.showSuccess('✅ تم الإرسال بنجاح!');
                    // يمكنك فتح الرابط
                    window.open(pData.reportUrl, '_blank');
                } else {
                    apex.message.showErrors([{
                        type: 'error',
                        message: '❌ ' + pData.error
                    }]);
                }
            },
            error: function(pData) {
                apex.message.showErrors([{
                    type: 'error',
                    message: '❌ خطأ في الاتصال'
                }]);
            }
        }
    );
}
```

### في Process (AJAX Callback):

```sql
DECLARE
    l_order_no VARCHAR2(100) := apex_application.g_x01;
    l_order_date VARCHAR2(100) := apex_application.g_x02;
    l_customer_name VARCHAR2(150) := apex_application.g_x03;
    l_phone VARCHAR2(50) := apex_application.g_x04;
    l_response CLOB;
BEGIN
    -- استدعاء API
    l_response := apex_web_service.make_rest_request(
        p_url => 'http://your-reports-server:3001/api/invoice/generate-and-send',
        p_http_method => 'POST',
        p_body => '{
            "orderNo": "' || l_order_no || '",
            "orderDate": "' || l_order_date || '",
            "customerName": "' || l_customer_name || '",
            "phone": "' || l_phone || '",
            "phoneNumber": "' || l_phone || '"
        }',
        p_content_type => 'application/json'
    );
    
    -- إرجاع الاستجابة
    apex_json.open_object;
    apex_json.write('response', l_response);
    apex_json.close_object;
END;
```

## ⚙️ الإعدادات المطلوبة

### 1. في سيرفر التقارير (.env):

```env
PORT=3001
WHATSAPP_API_URL=https://srv998477.hstgr.cloud/api
WHATSAPP_API_KEY=wa_401293125daf37cb993ac6f570c7edb93559d71dc9f75615f9a26858cbb87da7
SESSION_TOKEN=st_e2c5493fe919e1f345297072bb1fe224125d6d3e7c6a15ea
SESSION_ID=45
REPORT_BASE_URL=https://your-reports-server.com
```

### 2. في APEX Application Settings:

- تأكد من تفعيل **Web Service References** إذا كنت تستخدم PL/SQL
- أضف **CORS headers** إذا لزم الأمر

## 🎯 مثال كامل

انظر إلى ملف `apex-invoice-helper.js` للحصول على دالة جاهزة للاستخدام.

## 📞 الدعم

للمزيد من المساعدة، راجع ملف `README.md` في مشروع سيرفر التقارير.

