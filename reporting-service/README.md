# WhatsApp Reporting Service

نظام متكامل لبناء وإرسال التقارير عبر WhatsApp

## المميزات

✅ **بناء بصري** - صمم تقاريرك بدون كود  
✅ **إرسال WhatsApp** - إرسال مباشر للتقارير  
✅ **تحميل PDF** - تحميل التقارير كملفات  
✅ **REST API** - استدعاء من Oracle/Java/.NET  
✅ **Templates** - قوالب قابلة لإعادة الاستخدام

## التثبيت

```bash
cd reporting-service
npm install
```

## التشغيل

```bash
npm start
```

الخدمة ستعمل على: `http://localhost:4000`

## الاستخدام

### 1. بناء تقرير جديد

افتح: `http://localhost:4000/builder`

1. أدخل اسم التقرير
2. صمم الترويسة (Header)
3. أضف حقول البيانات
4. صمم أعمدة الجدول
5. أضف التذييل (Footer)
6. احفظ التقرير
7. **احصل على API Endpoint**

### 2. استخدام API

#### إرسال عبر WhatsApp

```bash
POST /api/reports/:reportId/send-whatsapp
Content-Type: application/json

{
  "parameters": {
    "order_no": "12345",
    "customer_name": "أحمد محمد",
    "items": [...]
  },
  "phone": "249912309788",
  "sessionId": "45",
  "caption": "فاتورة رقم 12345"
}
```

#### تحميل PDF

```bash
GET /api/reports/:reportId/download?order_no=12345&customer_name=أحمد
```

### 3. من Oracle APEX

```sql
DECLARE
  v_response CLOB;
BEGIN
  v_response := APEX_WEB_SERVICE.MAKE_REST_REQUEST(
    p_url => 'http://localhost:4000/api/reports/RPT_XXX/send-whatsapp',
    p_http_method => 'POST',
    p_body => '{
      "parameters": {"order_no": "' || :P3_ORDER_NO || '"},
      "phone": "' || :P3_PHONE || '",
      "sessionId": "45"
    }'
  );
END;
```

### 4. من JavaScript

```javascript
const response = await fetch('http://localhost:4000/api/reports/RPT_XXX/send-whatsapp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    parameters: { order_no: '12345' },
    phone: '249912309788',
    sessionId: '45'
  })
});
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/reports/create` | Create template |
| GET | `/api/reports/list` | List templates |
| GET | `/api/reports/:id` | Get template |
| PUT | `/api/reports/:id` | Update template |
| DELETE | `/api/reports/:id` | Delete template |
| POST | `/api/reports/:id/generate` | Generate PDF |
| POST | `/api/reports/:id/send-whatsapp` | Send via WhatsApp |
| GET | `/api/reports/:id/download` | Download PDF |
| POST | `/api/reports/:id/preview` | Preview HTML |

## Template Structure

```json
{
  "name": "فاتورة المبيعات",
  "header": {
    "title": "فاتورة مبيعات",
    "logo": "https://...",
    "companyInfo": { ... }
  },
  "table": {
    "columns": [
      { "field": "item_name", "label": "اسم الصنف" }
    ]
  },
  "footer": {
    "notes": "شكراً",
    "signatures": ["المحاسب"]
  },
  "styling": {
    "primaryColor": "#667eea"
  }
}
```

## الملفات

- `server.js` - Express server
- `ReportBuilder.js` - Template management
- `ReportGenerator.js` - PDF generation
- `ReportAPI.js` - REST API
- `public/builder.html` - Visual builder
- `templates/` - Saved templates

## المتطلبات

- Node.js 14+
- Puppeteer (للـ PDF)
- WhatsApp service (للإرسال)
