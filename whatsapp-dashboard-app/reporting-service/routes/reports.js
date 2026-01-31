const express = require('express');
const router = express.Router();
const { generatePDF } = require('../services/pdf-generator');
const { renderTemplate } = require('../services/template-engine');
const axios = require('axios');

// Generate PDF report and optionally send via WhatsApp
router.post('/generate', async (req, res) => {
    try {
        const {
            templateId,
            data,
            sendViaWhatsApp,
            recipients,
            whatsAppApiKey,
            whatsAppSessionToken
        } = req.body;

        if (!templateId) {
            return res.status(400).json({ success: false, error: 'Template ID is required' });
        }

        // Render HTML from template
        const html = await renderTemplate(templateId, data || {});

        // Convert to PDF
        const pdfBuffer = await generatePDF(html);
        const pdfBase64 = pdfBuffer.toString('base64');

        // Send via WhatsApp if requested
        if (sendViaWhatsApp && recipients && recipients.length > 0) {
            const whatsAppApiUrl = process.env.WHATSAPP_API_URL || 'http://localhost:3000';

            // Using a loop to send to multiple recipients
            // In a production environment, this should probably be a background job
            const results = [];
            for (const recipient of recipients) {
                try {
                    await axios.post(`${whatsAppApiUrl}/api/send-file`, {
                        to: recipient,
                        file: pdfBase64,
                        filename: `report_${Date.now()}.pdf`,
                        mimetype: 'application/pdf',
                        caption: data.title || 'Report'
                    }, {
                        headers: {
                            'x-api-key': whatsAppApiKey,
                            'x-session-token': whatsAppSessionToken
                        }
                    });
                    results.push({ recipient, status: 'sent' });
                } catch (err) {
                    console.error(`Failed to send report to ${recipient}:`, err.message);
                    results.push({ recipient, status: 'failed', error: err.message });
                }
            }
        }

        res.json({
            success: true,
            pdf: pdfBase64,
            message: 'Report generated successfully'
        });
    } catch (error) {
        console.error('Report generation error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
