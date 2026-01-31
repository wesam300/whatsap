-- ========================================
-- مثال استخدام سيرفر التقارير من Oracle APEX
-- ========================================

-- الطريقة 1: استخدام JavaScript مباشرة
-- أضف هذا الكود في JavaScript Function في APEX

/*
async function sendInvoiceFromAPEX() {
    const config = {
        reportsServerUrl: 'http://your-server:3001',
        whatsappApiUrl: 'https://srv998477.hstgr.cloud/api',
        apiKey: 'wa_401293125daf37cb993ac6f570c7edb93559d71dc9f75615f9a26858cbb87da7',
        sessionToken: 'st_e2c5493fe919e1f345297072bb1fe224125d6d3e7c6a15ea',
        sessionId: '45',
        orderNo: $v('P3_ORDER_NO'),
        orderDate: $v('P3_ORDER_DATE'),
        customerName: $v('P3_CUSTOMER_NAME'),
        customerNameEn: $v('P3_CUSTOMER_NAME_EN'),
        phone: $v('P3_PHONE'),
        fullAddress: $v('P3_FULL_ADDRESS'),
        flag: $v('P3_FLAG') || 'PAID',
        items: [], // سيتم ملؤها من الجدول
        total: parseFloat($v('P3_TOTAL')) || 0,
        discount: parseFloat($v('P3_DISCOUNT')) || 0,
        discountAmount: parseFloat($v('P3_DISCOUNT_AMOUNT')) || 0,
        phoneNumber: $v('P3_PHONE'),
        caption: 'فاتورة مبيعات'
    };
    
    // جمع الأصناف من الجدول
    apex.region('ITEMS_REGION').widget().interactiveGrid('getViews','grid').model.forEach(function(record) {
        config.items.push({
            partname: record.get('PARTNAME'),
            store: record.get('STORE'),
            unit_name: record.get('UNIT_NAME'),
            quant: parseFloat(record.get('QUANT')) || 0,
            price: parseFloat(record.get('PRICE')) || 0,
            total: parseFloat(record.get('TOTAL')) || 0
        });
    });
    
    try {
        const result = await generatePDFAndSendToWhatsApp(config);
        if (result.success) {
            apex.message.showSuccess('✅ تم الإرسال بنجاح!');
            $s('P3_NEW', result.html); // حفظ HTML
        }
    } catch (error) {
        apex.message.showErrors([{type: 'error', message: error.message}]);
    }
}
*/

-- ========================================
-- الطريقة 2: استخدام PL/SQL Process
-- ========================================

CREATE OR REPLACE PROCEDURE send_invoice_to_whatsapp (
    p_order_no IN VARCHAR2,
    p_reports_server_url IN VARCHAR2 DEFAULT 'http://localhost:3001'
) AS
    l_items_json CLOB;
    l_request_body CLOB;
    l_response CLOB;
    l_http_request UTL_HTTP.req;
    l_http_response UTL_HTTP.resp;
    l_url VARCHAR2(4000);
    l_order_date VARCHAR2(20);
    l_customer_name VARCHAR2(150);
    l_customer_name_en VARCHAR2(100);
    l_phone VARCHAR2(50);
    l_full_address VARCHAR2(250);
    l_flag VARCHAR2(100);
    l_total NUMBER;
    l_discount NUMBER := 0;
    l_discount_amount NUMBER := 0;
BEGIN
    -- جلب بيانات الطلب
    SELECT 
        TO_CHAR(order_date, 'DD-MM-YYYY'),
        NVL(custname_v, ''),
        NVL(mobile_or_phone, ''),
        NVL(flag, 'PAID'),
        NVL(full_address, ''),
        NVL((SELECT cust_name FROM CUSTOMERS WHERE cust_no=sales_order.cust_no), ''),
        NVL((SELECT SUM(quant * price) FROM sales_order_det WHERE order_no = sales_order.order_no), 0),
        NVL(DISCOUNT, 0),
        NVL(DISCOUNT_AMOUNT, 0)
    INTO 
        l_order_date, l_customer_name, l_phone, l_flag, l_full_address, 
        l_customer_name_en, l_total, l_discount, l_discount_amount
    FROM sales_order
    WHERE order_no = p_order_no;

    -- جمع الأصناف
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
        "orderNo": "' || REPLACE(p_order_no, '"', '\"') || '",
        "orderDate": "' || REPLACE(l_order_date, '"', '\"') || '",
        "customerName": "' || REPLACE(l_customer_name, '"', '\"') || '",
        "customerNameEn": "' || REPLACE(l_customer_name_en, '"', '\"') || '",
        "phone": "' || REPLACE(l_phone, '"', '\"') || '",
        "fullAddress": "' || REPLACE(l_full_address, '"', '\"') || '",
        "flag": "' || REPLACE(l_flag, '"', '\"') || '",
        "items": ' || l_items_json || ',
        "total": ' || l_total || ',
        "discount": ' || l_discount || ',
        "discountAmount": ' || l_discount_amount || ',
        "phoneNumber": "' || REPLACE(l_phone, '"', '\"') || '",
        "caption": "فاتورة مبيعات رقم: ' || REPLACE(p_order_no, '"', '\"') || '"
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
    
    -- معالجة الاستجابة (يمكن حفظها في جدول أو عرضها)
    DBMS_OUTPUT.PUT_LINE('Response: ' || l_response);
    
EXCEPTION
    WHEN OTHERS THEN
        BEGIN
            -- محاولة إغلاق الاستجابة إذا كانت مفتوحة
            IF l_http_response IS NOT NULL THEN
                BEGIN
                    UTL_HTTP.end_response(l_http_response);
                EXCEPTION
                    WHEN OTHERS THEN NULL; -- تجاهل الأخطاء عند الإغلاق
                END;
            END IF;
        EXCEPTION
            WHEN OTHERS THEN NULL; -- تجاهل الأخطاء في معالجة الاستثناء
        END;
        RAISE_APPLICATION_ERROR(-20001, 'خطأ في إرسال الفاتورة: ' || SQLERRM);
END;
/

-- استخدام Procedure من APEX Process:
/*
BEGIN
    send_invoice_to_whatsapp(
        p_order_no => :P3_ORDER_NO,
        p_reports_server_url => 'http://your-server:3001'
    );
END;
*/

-- ========================================
-- الطريقة 3: استخدام APEX Web Service
-- ========================================

-- في APEX: Shared Components > Web Service References
-- أنشئ Web Service جديد:
-- URL: http://your-server:3001/api/invoice/generate-and-send
-- Method: POST
-- Content Type: application/json

-- ثم استخدمه من Process:
/*
DECLARE
    l_response CLOB;
BEGIN
    l_response := apex_web_service.make_rest_request(
        p_url => 'http://your-server:3001/api/invoice/generate-and-send',
        p_http_method => 'POST',
        p_body => '{
            "orderNo": "' || :P3_ORDER_NO || '",
            "orderDate": "' || :P3_ORDER_DATE || '",
            "customerName": "' || :P3_CUSTOMER_NAME || '",
            "phone": "' || :P3_PHONE || '",
            "phoneNumber": "' || :P3_PHONE || '"
        }',
        p_content_type => 'application/json'
    );
    
    -- معالجة l_response
END;
*/

