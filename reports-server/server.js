// ========================================
// WhatsApp Reports Server
// ========================================
// سيرفر التقارير مع تكامل خدمة الواتساب

require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 3001;

// إعدادات الواتساب
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || 'http://localhost:3000/api';
const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY || '';
const SESSION_TOKEN = process.env.SESSION_TOKEN || '';
const SESSION_ID = process.env.SESSION_ID || '';

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// إنشاء قاعدة البيانات
const dbPath = path.join(__dirname, 'reports.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('خطأ في الاتصال بقاعدة البيانات:', err.message);
    } else {
        console.log('✅ تم الاتصال بقاعدة البيانات');
        initializeDatabase();
    }
});

// تهيئة قاعدة البيانات
function initializeDatabase() {
    db.serialize(() => {
        // جدول التقارير
        db.run(`CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            template_data TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_active INTEGER DEFAULT 1
        )`);

        // جدول سجلات إرسال التقارير
        db.run(`CREATE TABLE IF NOT EXISTS report_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            report_id INTEGER,
            recipient TEXT NOT NULL,
            status TEXT NOT NULL,
            error_message TEXT,
            sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (report_id) REFERENCES reports(id)
        )`);

        console.log('✅ تم تهيئة قاعدة البيانات');
    });
}

// دالة مساعدة لتنفيذ استعلامات قاعدة البيانات
function dbQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) {
                reject(err);
            } else {
                resolve({ lastID: this.lastID, changes: this.changes });
            }
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

// دالة لتحويل البيانات إلى HTML
function generateReportHTML(templateData, parameters = {}) {
    let html = templateData.html || '';
    
    // استبدال المعاملات في HTML
    Object.keys(parameters).forEach(key => {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        html = html.replace(regex, parameters[key]);
    });
    
    // إضافة CSS إذا كان موجوداً
    if (templateData.css) {
        html = html.replace('</head>', `<style>${templateData.css}</style></head>`);
    }
    
    return html;
}

// دالة لإرسال التقرير عبر الواتساب
async function sendReportViaWhatsApp(phoneNumber, message, reportHTML = null) {
    try {
        const headers = {
            'Content-Type': 'application/json'
        };
        
        // استخدام API Key أو Session Token
        if (WHATSAPP_API_KEY) {
            headers['x-api-key'] = WHATSAPP_API_KEY;
        } else if (SESSION_TOKEN) {
            headers['x-session-token'] = SESSION_TOKEN;
        }
        
        // التأكد من وجود sessionId
        if (!SESSION_ID) {
            return { 
                success: false, 
                error: 'SESSION_ID غير محدد في ملف .env' 
            };
        }
        
        // إعداد رقم الهاتف (إضافة @c.us إذا لم يكن موجوداً)
        let formattedPhone = phoneNumber.trim();
        if (!formattedPhone.includes('@')) {
            formattedPhone = formattedPhone.includes('+') 
                ? formattedPhone.replace('+', '') + '@c.us'
                : formattedPhone + '@c.us';
        }
        
        // إرسال الرسالة النصية (مع HTML إذا كان موجوداً)
        let finalMessage = message || '';
        
        // إذا كان هناك HTML، أضفه للرسالة
        if (reportHTML) {
            // تحويل HTML إلى نص بسيط للواتساب (يمكن تحسينه لاحقاً)
            // يمكن إضافة رابط للتقرير أو إرسال HTML كصورة
            const reportBaseUrl = process.env.REPORT_BASE_URL || `http://localhost:${PORT}`;
            finalMessage += '\n\n📊 رابط التقرير: ' + 
                `${reportBaseUrl}/api/reports/view?html=${encodeURIComponent(reportHTML)}`;
        }
        
        const response = await axios.post(
            `${WHATSAPP_API_URL}/send-message`,
            {
                sessionId: SESSION_ID,
                to: formattedPhone,
                message: finalMessage
            },
            { headers }
        );
        
        if (response.data.success) {
            console.log(`✅ تم إرسال التقرير إلى ${phoneNumber}`);
            return { success: true, message: 'تم إرسال التقرير بنجاح' };
        } else {
            return { 
                success: false, 
                error: response.data.error || 'فشل في إرسال التقرير' 
            };
        }
    } catch (error) {
        console.error('خطأ في إرسال التقرير:', error.response?.data || error.message);
        return { 
            success: false, 
            error: error.response?.data?.error || error.message 
        };
    }
}

// ========================================
// API Routes
// ========================================

// الصفحة الرئيسية
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// الحصول على جميع التقارير
app.get('/api/reports', async (req, res) => {
    try {
        const reports = await dbQuery(
            'SELECT id, name, description, created_at, updated_at, is_active FROM reports ORDER BY created_at DESC'
        );
        res.json({ success: true, reports });
    } catch (error) {
        console.error('خطأ في جلب التقارير:', error);
        res.status(500).json({ success: false, error: 'فشل في جلب التقارير' });
    }
});

// الحصول على تقرير محدد
app.get('/api/reports/:id', async (req, res) => {
    try {
        const report = await dbGet('SELECT * FROM reports WHERE id = ?', [req.params.id]);
        if (!report) {
            return res.status(404).json({ success: false, error: 'التقرير غير موجود' });
        }
        
        report.template_data = JSON.parse(report.template_data);
        res.json({ success: true, report });
    } catch (error) {
        console.error('خطأ في جلب التقرير:', error);
        res.status(500).json({ success: false, error: 'فشل في جلب التقرير' });
    }
});

// إنشاء تقرير جديد
app.post('/api/reports', async (req, res) => {
    try {
        const { name, description, template_data } = req.body;
        
        if (!name || !template_data) {
            return res.status(400).json({ 
                success: false, 
                error: 'اسم التقرير وبيانات القالب مطلوبة' 
            });
        }
        
        const result = await dbRun(
            'INSERT INTO reports (name, description, template_data) VALUES (?, ?, ?)',
            [name, description || '', JSON.stringify(template_data)]
        );
        
        res.json({ 
            success: true, 
            message: 'تم إنشاء التقرير بنجاح',
            reportId: result.lastID 
        });
    } catch (error) {
        console.error('خطأ في إنشاء التقرير:', error);
        res.status(500).json({ success: false, error: 'فشل في إنشاء التقرير' });
    }
});

// تحديث تقرير
app.put('/api/reports/:id', async (req, res) => {
    try {
        const { name, description, template_data, is_active } = req.body;
        const reportId = req.params.id;
        
        const updateFields = [];
        const updateValues = [];
        
        if (name !== undefined) {
            updateFields.push('name = ?');
            updateValues.push(name);
        }
        if (description !== undefined) {
            updateFields.push('description = ?');
            updateValues.push(description);
        }
        if (template_data !== undefined) {
            updateFields.push('template_data = ?');
            updateValues.push(JSON.stringify(template_data));
        }
        if (is_active !== undefined) {
            updateFields.push('is_active = ?');
            updateValues.push(is_active ? 1 : 0);
        }
        
        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        updateValues.push(reportId);
        
        const sql = `UPDATE reports SET ${updateFields.join(', ')} WHERE id = ?`;
        await dbRun(sql, updateValues);
        
        res.json({ success: true, message: 'تم تحديث التقرير بنجاح' });
    } catch (error) {
        console.error('خطأ في تحديث التقرير:', error);
        res.status(500).json({ success: false, error: 'فشل في تحديث التقرير' });
    }
});

// حذف تقرير
app.delete('/api/reports/:id', async (req, res) => {
    try {
        await dbRun('DELETE FROM reports WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'تم حذف التقرير بنجاح' });
    } catch (error) {
        console.error('خطأ في حذف التقرير:', error);
        res.status(500).json({ success: false, error: 'فشل في حذف التقرير' });
    }
});

// عرض التقرير مع المعاملات
app.get('/api/reports/:id/view', async (req, res) => {
    try {
        const report = await dbGet('SELECT * FROM reports WHERE id = ?', [req.params.id]);
        if (!report) {
            return res.status(404).json({ success: false, error: 'التقرير غير موجود' });
        }
        
        const templateData = JSON.parse(report.template_data);
        const parameters = req.query; // المعاملات من query string
        
        const html = generateReportHTML(templateData, parameters);
        
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (error) {
        console.error('خطأ في عرض التقرير:', error);
        res.status(500).json({ success: false, error: 'فشل في عرض التقرير' });
    }
});

// عرض تقرير من HTML مباشرة (للاستخدام مع الروابط)
app.get('/api/reports/view', async (req, res) => {
    try {
        const html = req.query.html;
        if (!html) {
            return res.status(400).json({ success: false, error: 'HTML مطلوب' });
        }
        
        const decodedHTML = decodeURIComponent(html);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(decodedHTML);
    } catch (error) {
        console.error('خطأ في عرض التقرير:', error);
        res.status(500).json({ success: false, error: 'فشل في عرض التقرير' });
    }
});

// إرسال التقرير عبر الواتساب
app.post('/api/reports/:id/send', async (req, res) => {
    try {
        const { phoneNumber, parameters, message } = req.body;
        const reportId = req.params.id;
        
        if (!phoneNumber) {
            return res.status(400).json({ 
                success: false, 
                error: 'رقم الهاتف مطلوب' 
            });
        }
        
        // الحصول على التقرير
        const report = await dbGet('SELECT * FROM reports WHERE id = ?', [reportId]);
        if (!report) {
            return res.status(404).json({ success: false, error: 'التقرير غير موجود' });
        }
        
        const templateData = JSON.parse(report.template_data);
        const reportHTML = generateReportHTML(templateData, parameters || {});
        
        // إنشاء رابط للتقرير
        const reportBaseUrl = process.env.REPORT_BASE_URL || `http://localhost:${PORT}`;
        const reportUrl = `${reportBaseUrl}/api/reports/${reportId}/view?${new URLSearchParams(parameters || {}).toString()}`;
        
        // إرسال التقرير عبر الواتساب
        const finalMessage = (message || `📊 تقرير: ${report.name}\n\n`) + `🔗 رابط التقرير: ${reportUrl}`;
        
        const result = await sendReportViaWhatsApp(
            phoneNumber, 
            finalMessage,
            reportHTML
        );
        
        // حفظ السجل
        await dbRun(
            'INSERT INTO report_logs (report_id, recipient, status, error_message) VALUES (?, ?, ?, ?)',
            [
                reportId,
                phoneNumber,
                result.success ? 'sent' : 'failed',
                result.error || null
            ]
        );
        
        if (result.success) {
            res.json({ 
                success: true, 
                message: 'تم إرسال التقرير بنجاح',
                reportHTML: reportHTML
            });
        } else {
            res.status(500).json({ 
                success: false, 
                error: result.error || 'فشل في إرسال التقرير' 
            });
        }
    } catch (error) {
        console.error('خطأ في إرسال التقرير:', error);
        res.status(500).json({ success: false, error: 'فشل في إرسال التقرير' });
    }
});

// الحصول على سجلات إرسال التقارير
app.get('/api/reports/:id/logs', async (req, res) => {
    try {
        const logs = await dbQuery(
            'SELECT * FROM report_logs WHERE report_id = ? ORDER BY sent_at DESC LIMIT 100',
            [req.params.id]
        );
        res.json({ success: true, logs });
    } catch (error) {
        console.error('خطأ في جلب السجلات:', error);
        res.status(500).json({ success: false, error: 'فشل في جلب السجلات' });
    }
});

// الحصول على جميع السجلات
app.get('/api/logs', async (req, res) => {
    try {
        const logs = await dbQuery(`
            SELECT rl.*, r.name as report_name 
            FROM report_logs rl 
            LEFT JOIN reports r ON rl.report_id = r.id 
            ORDER BY rl.sent_at DESC 
            LIMIT 100
        `);
        res.json({ success: true, logs });
    } catch (error) {
        console.error('خطأ في جلب السجلات:', error);
        res.status(500).json({ success: false, error: 'فشل في جلب السجلات' });
    }
});

// ========================================
// API خاص للفاتورة (للاستخدام من PL/SQL)
// ========================================

// إنشاء فاتورة ديناميكية وإرسالها
app.post('/api/invoice/generate-and-send', async (req, res) => {
    try {
        const { 
            orderNo, 
            orderDate, 
            customerName, 
            customerNameEn,
            phone, 
            fullAddress,
            flag, // 'PAID' or other
            items, // array of {partname, store, unit_name, quant, price, total}
            total,
            discount,
            discountAmount,
            phoneNumber, // للواتساب
            caption // رسالة مرفقة
        } = req.body;

        if (!orderNo || !items || !Array.isArray(items)) {
            return res.status(400).json({ 
                success: false, 
                error: 'بيانات الفاتورة مطلوبة (orderNo, items)' 
            });
        }

        // تحديد نوع الفاتورة
        const invoiceTitle = flag === 'PAID' ? 'فاتـورة مبيـعات' : 'فاتـورة مبدئيـة';
        const watermarkHTML = flag === 'PAID' 
            ? '<img src="#APP_FILES#logo.png" style="width:85%;">'
            : `<div style="position:relative; width:100%; height:100%;">
                <div style="position:absolute; top:50%; left:0; width:100%; height:40px; border-top: 15px dashed #f00; border-bottom: 15px dashed #f00; transform: translateY(-50%) rotate(-45deg);"></div>
                <div style="position:absolute; top:50%; left:0; width:100%; height:40px; border-top: 15px dashed #f00; border-bottom: 15px dashed #f00; transform: translateY(-50%) rotate(45deg);"></div>
              </div>`;

        // حساب الإجمالي بعد الخصم
        let totalAfterDiscount = total || 0;
        if (discount > 0) {
            totalAfterDiscount = total - (total * discount / 100);
        } else if (discountAmount > 0) {
            totalAfterDiscount = total - discountAmount;
        }

        // بناء HTML الفاتورة
        let invoiceHTML = `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
<div style="font-family:Arial; direction:rtl; background:#fff; padding:20px; padding-bottom: 40px; max-width:800px; margin:auto; border:2px solid #f58220; position:relative; min-height:1000px; display:flex; flex-direction:column; page-break-inside:avoid;">

  <div style="flex:1 0 auto; display:flex; flex-direction:column;">
    <!-- Watermark Background Logo -->
    <div style="position:absolute; top:0; left:0; width:100%; height:100%; display:flex; justify-content:center; align-items:center; opacity:0.15; z-index:0; pointer-events:none; overflow:hidden;">
      ${watermarkHTML}
    </div>

    <!-- Header -->
<div style="display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:10px; z-index:1; position:relative;">

  <!-- Right Column: Contact Info -->
  <div style="flex:1; font-size:13px; padding-inline-end:5px;">
    <div style="display:flex; align-items:center; margin-bottom:5px; direction:ltr; white-space:nowrap;">
      <div style="color:#f58220; width:20px; text-align:center; flex-shrink:0;"><i class="fa-solid fa-phone"></i></div>
      <div style="margin-left:5px;">+249 9123 09 788 / +249 9123 37 300</div>
    </div>
    <div style="display:flex; align-items:center; margin-bottom:5px; direction:ltr; white-space:nowrap;">
      <div style="color:#f58220; width:20px; text-align:center; flex-shrink:0;"><i class="fa-solid fa-phone"></i></div>
      <div style="margin-left:5px;">+249 183 490 000</div>
      <div style="color:#f58220; width:20px; text-align:center; margin-left:15px; flex-shrink:0;"><i class="fa-solid fa-fax"></i></div>
      <div style="margin-left:5px;">+249 183 464 000</div>
    </div>
    <div style="display:flex; align-items:center; margin-bottom:5px; direction:ltr; white-space:nowrap;">
      <div style="color:#f58220; width:20px; text-align:center; flex-shrink:0;"><i class="fa-solid fa-envelope"></i></div>
      <div style="margin-left:5px;">info@aryamsudan.com</div>
    </div>
    <div style="display:flex; align-items:center; margin-bottom:5px; direction:ltr; white-space:nowrap;">
      <div style="color:#f58220; width:20px; text-align:center; flex-shrink:0;"><i class="fa-solid fa-globe"></i></div>
      <div style="margin-left:5px;">www.aryamsudan.com</div>
    </div>
    <div style="display:flex; align-items:center; direction:ltr; white-space:nowrap;">
      <div style="color:#f58220; width:20px; text-align:center; flex-shrink:0;"><i class="fa-solid fa-location-dot"></i></div>
      <div style="margin-left:5px;">Sudan - Khartoum - AlSajana</div>
    </div>
  </div>

  <!-- Separator -->
  <div style="width:1px; background:#f58220; height:140px; margin:0 20px;"></div>

  <!-- Logo Column -->
  <div style="flex:1; text-align:center;">
    <img src="#APP_FILES#logo.png" style="height:100px; max-width:100%;">
  </div>
</div>

<!-- Invoice Title -->
<div style="text-align:center; margin:20px auto; width:250px; background:#f15a24; color:#fff; font-size:20px; font-weight:bold; padding:10px 0; border-radius:25px;">
  ${invoiceTitle}
</div>

<!-- Invoice Info -->
<div style="border: 0px solid #f58220; border-radius: 10px; padding: 10px; margin: 5px; font-size:13px; display: flex; justify-content: center; align-items: center; gap: 15px; direction: rtl;">

  <div style="text-align: center; border: 1px solid #f58220; border-radius: 10px; padding: 6px 10px; ">
    <span style="font-weight: bold; color: #000;">رقم الفاتورة : </span>
    <span style="color:#f15a24;">${orderNo}</span>
  </div>

  <div style="text-align: center; border: 1px solid #f58220; border-radius: 10px; padding: 6px 10px; ">
    <span style="font-weight: bold; color: #000;">تاريخ الفاتورة : </span>
    <span style="color:#f15a24;">${orderDate || ''}</span>
  </div>

</div>

<!-- Customer Info -->
<table style="width:100%; font-size:13px; margin-top:10px; border-collapse:collapse; z-index:1; position:relative;">
  <tr>
    <td style="width:50%; padding:4px; text-align:right;">
      <b>الاســـــــــم :</b>
      <span>${customerName || ''}</span>
    </td>
    <td style="width:50%; padding:4px; text-align:right;">
      <span>${customerNameEn || ''}</span>
    </td>
  </tr>
  <tr>
    <td style="width:50%; padding:4px; text-align:right;">
      <b>رقم الهاتف :</b> ${phone || ''}
    </td>
    <td style="width:50%; padding:4px; text-align:right;">
      <b>العنوان :</b> ${fullAddress || ''}
    </td>
  </tr>
</table>

  <!-- Items Table -->
  <table style="width:100%; border-collapse:collapse; margin-top:15px; font-size:12px; text-align:center; z-index:1; position:relative; page-break-inside:auto;">
    <tr style="background:#f58220; color:white; page-break-inside:avoid;">
      <th style="border:1px solid #f58220; padding:5px;">رقم</th>
      <th style="border:1px solid #f58220; padding:5px;">اسم الصنف<br>Item Name</th>
      <th style="border:1px solid #f58220; padding:5px;">المخزن<br>Store</th>
      <th style="border:1px solid #f58220; padding:5px;">الوحدة<br>Unit</th>
      <th style="border:1px solid #f58220; padding:5px;">الكمية<br>Qty</th>
      <th style="border:1px solid #f58220; padding:5px;">السعر<br>Price</th>
      <th style="border:1px solid #f58220; padding:5px;">الإجمالي<br>Total</th>
    </tr>`;

        // إضافة الأصناف
        items.forEach((item, index) => {
            const rn = index + 1;
            const formattedPrice = item.price ? Math.trunc(item.price).toLocaleString('en-US') : '0';
            const formattedTotal = item.total ? Math.trunc(item.total).toLocaleString('en-US') : '0';
            const formattedQuant = item.quant ? item.quant.toString() : '0';

            invoiceHTML += `
    <tr style="page-break-inside:avoid;">
      <td style="border:1px solid #f58220; padding:4px;">${rn}</td>
      <td style="border:1px solid #f58220; padding:4px; direction:rtl; unicode-bidi:isolate; text-align:right;">${item.partname || ''}</td>
      <td style="border:1px solid #f58220; padding:4px;"><div style="direction:ltr;">${item.store || ''}</div></td>
      <td style="border:1px solid #f58220; padding:4px;">${item.unit_name || ''}</td>
      <td style="border:1px solid #f58220; padding:4px;"><div style="direction:ltr;">${formattedQuant}</div></td>
      <td style="border:1px solid #f58220; padding:4px;"><div style="direction:ltr;">${formattedPrice}</div></td>
      <td style="border:1px solid #f58220; padding:4px;"><div style="direction:ltr;">${formattedTotal}</div></td>
    </tr>`;

            // إضافة مسافة بعد الصنف رقم 29
            if (rn === 29) {
                invoiceHTML += `
    <tr style="page-break-inside:avoid;">
      <td colspan="7" style="border:none; padding:20px; background:transparent;"></td>
    </tr>`;
            }
        });

        // إجمالي الفاتورة
        const formattedTotal = total ? Math.trunc(total).toLocaleString('en-US') : '0';
        invoiceHTML += `
    <tr style="page-break-inside:avoid;">
      <td colspan="6" style="text-align:center; padding:5px; border:1px solid #f58220;"><b>إجمالي الفاتورة</b></td>
      <td style="padding:5px; border:1px solid #f58220; text-align:center;"><div style="direction:ltr;"><b>${formattedTotal}</b></div></td>
    </tr>`;

        // الخصم
        if (discount > 0) {
            const discountValue = Math.trunc(total * discount / 100);
            const formattedDiscount = discountValue.toLocaleString('en-US');
            invoiceHTML += `
    <tr style="page-break-inside:avoid;">
      <td colspan="6" style="text-align:center; padding:5px; border:1px solid #f58220;"><b>الخصم (${discount}%)</b></td>
      <td style="padding:5px; border:1px solid #f58220; text-align:center;"><div style="direction:ltr;"><b>${formattedDiscount}</b></div></td>
    </tr>`;
        } else if (discountAmount > 0) {
            const formattedDiscount = Math.trunc(discountAmount).toLocaleString('en-US');
            invoiceHTML += `
    <tr style="page-break-inside:avoid;">
      <td colspan="6" style="text-align:center; padding:5px; border:1px solid #f58220;"><b>الخصم</b></td>
      <td style="padding:5px; border:1px solid #f58220; text-align:center;"><div style="direction:ltr;"><b>${formattedDiscount}</b></div></td>
    </tr>`;
        }

        // الإجمالي بعد الخصم
        if (discount > 0 || discountAmount > 0) {
            const formattedAfterDiscount = Math.trunc(totalAfterDiscount).toLocaleString('en-US');
            invoiceHTML += `
    <tr style="page-break-inside:avoid;">
      <td colspan="6" style="text-align:center; padding:5px; border:1px solid #f58220;"><b>الإجمالي بعد الخصم</b></td>
      <td style="padding:5px; border:1px solid #f58220; text-align:center;"><div style="direction:ltr;"><b>${formattedAfterDiscount}</b></div></td>
    </tr>`;
        }

        // التذييل
        invoiceHTML += `
  </table>
  </div>

  <!-- Signature Section -->
  <div style="margin-top:auto; padding-top: 17px; page-break-inside:avoid;">
    <table style="width:100%; font-family:Arial, sans-serif; font-size:13px; text-align:center; border-spacing:0;">
      <tr>
        <td style="width:33%; vertical-align:top;">
          <div style="font-weight:bold;">توقيع المحاسب</div>
          <div style="font-size:11px; color:#555;">Accountant Signature</div>
          <div style="margin-top:20px;">....................................</div>
        </td>
        <td style="width:34%; vertical-align:top;">
          <div style="font-size:11px; color:#555; font-weight:bold;">خدمة العملاء</div>
          <div dir="ltr" style="font-size:20px; font-weight:bold; color:#000;">
            <i class="fa-brands fa-whatsapp" style="color:#25d366;"></i> 0912118777
          </div>
          <div style="margin-top:5px;">
            <img src="#APP_FILES#qrcode.jpeg" style="height:75px;">
          </div>
        </td>
        <td style="width:33%; vertical-align:top;">
          <div style="font-weight:bold;">ختم الشركة</div>
          <div style="font-size:11px; color:#555;">Company Stamp</div>
          <div style="margin-top:20px;">....................................</div>
        </td>
      </tr>
    </table>
  </div>
</div>`;

        // إذا طُلب إرسال عبر الواتساب
        if (phoneNumber) {
            const headers = {
                'Content-Type': 'application/json'
            };
            
            if (WHATSAPP_API_KEY) {
                headers['x-api-key'] = WHATSAPP_API_KEY;
            } else if (SESSION_TOKEN) {
                headers['x-session-token'] = SESSION_TOKEN;
            }

            // تنسيق رقم الهاتف
            let formattedPhone = phoneNumber.trim().replace(/[^\d]/g, '');
            if (!formattedPhone.includes('@')) {
                formattedPhone = formattedPhone + '@c.us';
            }

            // إنشاء رابط للتقرير
            const reportBaseUrl = process.env.REPORT_BASE_URL || `http://localhost:${PORT}`;
            const reportUrl = `${reportBaseUrl}/api/invoice/view?html=${encodeURIComponent(invoiceHTML)}`;
            
            const finalMessage = (caption || `📊 فاتورة مبيعات رقم: ${orderNo}\nبتاريخ: ${orderDate || ''}\n\nمع تحيات شركة أريام`) + 
                `\n\n🔗 رابط الفاتورة: ${reportUrl}`;

            try {
                const response = await axios.post(
                    `${WHATSAPP_API_URL}/send-message`,
                    {
                        sessionId: SESSION_ID,
                        to: formattedPhone,
                        message: finalMessage
                    },
                    { headers }
                );

                if (response.data.success) {
                    return res.json({ 
                        success: true, 
                        message: 'تم إنشاء وإرسال الفاتورة بنجاح',
                        html: invoiceHTML,
                        reportUrl: reportUrl
                    });
                } else {
                    return res.json({ 
                        success: false, 
                        error: response.data.error || 'فشل في إرسال الفاتورة',
                        html: invoiceHTML,
                        reportUrl: reportUrl
                    });
                }
            } catch (error) {
                console.error('خطأ في إرسال الفاتورة:', error.response?.data || error.message);
                return res.json({ 
                    success: false, 
                    error: error.response?.data?.error || error.message,
                    html: invoiceHTML,
                    reportUrl: reportUrl
                });
            }
        } else {
            // إرجاع HTML فقط بدون إرسال
            const reportBaseUrl = process.env.REPORT_BASE_URL || `http://localhost:${PORT}`;
            const reportUrl = `${reportBaseUrl}/api/invoice/view?html=${encodeURIComponent(invoiceHTML)}`;
            
            return res.json({ 
                success: true, 
                message: 'تم إنشاء الفاتورة بنجاح',
                html: invoiceHTML,
                reportUrl: reportUrl
            });
        }
    } catch (error) {
        console.error('خطأ في إنشاء الفاتورة:', error);
        res.status(500).json({ 
            success: false, 
            error: 'فشل في إنشاء الفاتورة: ' + error.message 
        });
    }
});

// عرض فاتورة من HTML مباشرة
app.get('/api/invoice/view', async (req, res) => {
    try {
        const html = req.query.html;
        if (!html) {
            return res.status(400).json({ success: false, error: 'HTML مطلوب' });
        }
        
        const decodedHTML = decodeURIComponent(html);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(decodedHTML);
    } catch (error) {
        console.error('خطأ في عرض الفاتورة:', error);
        res.status(500).json({ success: false, error: 'فشل في عرض الفاتورة' });
    }
});

// بدء السيرفر
app.listen(PORT, () => {
    console.log(`🚀 سيرفر التقارير يعمل على المنفذ ${PORT}`);
    console.log(`📱 افتح http://localhost:${PORT} في المتصفح`);
    console.log(`📊 API متاح على http://localhost:${PORT}/api`);
});

// إغلاق قاعدة البيانات عند إيقاف السيرفر
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('خطأ في إغلاق قاعدة البيانات:', err.message);
        } else {
            console.log('✅ تم إغلاق قاعدة البيانات');
        }
        process.exit(0);
    });
});

