const express = require('express');
const router = express.Router();
const { generatePDF } = require('../services/pdf-generator');
const { renderTemplate } = require('../services/template-engine');

// Direct print (returns HTML with print script)
router.post('/direct', async (req, res) => {
    try {
        const { templateId, data, format } = req.body;

        if (!templateId) {
            return res.status(400).json({ success: false, error: 'Template ID is required' });
        }

        const html = await renderTemplate(templateId, data || {});

        // Add auto-print script
        const printHtml = `
            ${html}
            <script>
                window.onload = function() {
                    window.print();
                    setTimeout(() => window.close(), 1000);
                };
            </script>
        `;

        res.json({
            success: true,
            html: printHtml,
            format: format || 'A4'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// PDF for printing
router.post('/pdf', async (req, res) => {
    try {
        const { templateId, data, format } = req.body;

        if (!templateId) {
            return res.status(400).json({ success: false, error: 'Template ID is required' });
        }

        const html = await renderTemplate(templateId, data || {});
        const pdfBuffer = await generatePDF(html, { format });

        res.json({
            success: true,
            pdf: pdfBuffer.toString('base64'),
            format: format || 'A4'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
