const express = require('express');
const router = express.Router();
const db = require('./db');
const path = require('path');
const fs = require('fs').promises;
const { getPuppeteerOptions, isClientHealthy } = require('./session-manager');

// Middleware للتحقق من المصادقة
const requireAuth = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        res.status(401).json({ error: 'غير مصرح' });
    }
};

router.use(requireAuth);

// قائمة التقارير
router.get('/', (req, res) => {
    try {
        const reports = db.prepare('SELECT id, name, description, created_at FROM report_templates WHERE user_id = ? ORDER BY created_at DESC').all(req.session.userId);
        res.json(reports);
    } catch (error) {
        console.error('Error fetching reports:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء جلب التقارير' });
    }
});

// جلب تقرير محدد
router.get('/:id', (req, res) => {
    try {
        const report = db.prepare('SELECT * FROM report_templates WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
        if (!report) {
            return res.status(404).json({ error: 'التقرير غير موجود' });
        }
        res.json(report);
    } catch (error) {
        console.error('Error fetching report:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء جلب التقرير' });
    }
});

// إنشاء تقرير جديد
router.post('/', (req, res) => {
    const { name, description, content, parameters } = req.body;

    if (!name || !content) {
        return res.status(400).json({ error: 'الاسم والمحتوى مطلوبان' });
    }

    try {
        const result = db.prepare(`
            INSERT INTO report_templates (user_id, name, description, content, parameters)
            VALUES (?, ?, ?, ?, ?)
        `).run(req.session.userId, name, description, content, JSON.stringify(parameters || []));

        res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
        console.error('Error creating report:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء إنشاء التقرير' });
    }
});

// تحديث تقرير
router.put('/:id', (req, res) => {
    const { name, description, content, parameters } = req.body;

    try {
        const result = db.prepare(`
            UPDATE report_templates 
            SET name = ?, description = ?, content = ?, parameters = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
        `).run(name, description, content, JSON.stringify(parameters || []), req.params.id, req.session.userId);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'التقرير غير موجود أو غير مصرح بتعديله' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating report:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء تحديث التقرير' });
    }
});

// حذف تقرير
router.delete('/:id', (req, res) => {
    try {
        const result = db.prepare('DELETE FROM report_templates WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'التقرير غير موجود' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting report:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء حذف التقرير' });
    }
});

// دالة مساعدة لتوليد PDF
async function generatePDF(content, data = {}) {
    // تعويض المتغيرات في القالب
    let html = content;
    for (const [key, value] of Object.entries(data)) {
        html = html.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }

    // إضافة ستايل بسيط للطباعة
    html = `
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: 'Arial', sans-serif; margin: 0; padding: 20px; }
                table { width: 100%; border-collapse: collapse; }
                td, th { border: 1px solid #ddd; padding: 8px; text-align: right; }
                @page { margin: 20mm; }
            </style>
        </head>
        <body>
            ${html}
        </body>
        </html>
    `;

    // استخدام Puppeteer لتوليد PDF
    // نستخدم require هنا لتجنب المشاكل في السيرفر الرئيسي إذا لم يكن puppeteer محملاً
    const puppeteer = require('puppeteer-core');
    const browser = await puppeteer.launch(getPuppeteerOptions());

    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
        return pdfBuffer;
    } finally {
        await browser.close();
    }
}

// معاينة PDF (تحميل)
router.post('/:id/preview', async (req, res) => {
    try {
        const report = db.prepare('SELECT content FROM report_templates WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
        if (!report) return res.status(404).json({ error: 'التقرير غير موجود' });

        const pdfBuffer = await generatePDF(report.content, req.body.data);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=report.pdf');
        res.send(pdfBuffer);
    } catch (error) {
        console.error('Error generating PDF:', error);
        res.status(500).json({ error: 'فشل توليد ملف PDF' });
    }
});

// إرسال عبر واتساب
router.post('/:id/send', async (req, res) => {
    const { sessionId, phone, data } = req.body;

    if (!sessionId || !phone) {
        return res.status(400).json({ error: 'معرف الجلسة ورقم الهاتف مطلوبان' });
    }

    try {
        // التحقق من الجلسة
        const activeClients = req.app.get('activeClients'); // سنحتاج لتمرير هذا
        const client = activeClients.get(sessionId);

        if (!client || !await isClientHealthy(client)) {
            return res.status(400).json({ error: 'جلسة الواتساب غير نشطة' });
        }

        // جلب القالب
        const report = db.prepare('SELECT content, name FROM report_templates WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
        if (!report) return res.status(404).json({ error: 'التقرير غير موجود' });

        // توليد PDF
        const pdfBuffer = await generatePDF(report.content, data);

        // إعداد المرفق
        const { MessageMedia } = require('whatsapp-web.js');
        const media = new MessageMedia('application/pdf', pdfBuffer.toString('base64'), `${report.name}.pdf`);

        // إرسال الرسالة
        const chatId = phone.includes('@c.us') ? phone : `${phone}@c.us`;
        await client.sendMessage(chatId, media, { caption: `تقرير: ${report.name}` });

        res.json({ success: true, message: 'تم إرسال التقرير بنجاح' });

    } catch (error) {
        console.error('Error sending report:', error);
        res.status(500).json({ error: 'فشل إرسال التقرير: ' + error.message });
    }
});

module.exports = router;
