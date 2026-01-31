'use strict';

const express = require('express');
const ReportBuilder = require('./ReportBuilder');
const ReportGenerator = require('./ReportGenerator');
const path = require('path');
const fs = require('fs').promises;

class ReportAPI {
    constructor(whatsappService = null) {
        this.router = express.Router();
        this.reportBuilder = new ReportBuilder();
        this.reportGenerator = new ReportGenerator();
        this.whatsappService = whatsappService;
        this.outputDir = './output';
        this.setupRoutes();
        this.ensureOutputDir();
    }

    async ensureOutputDir() {
        try {
            await fs.mkdir(this.outputDir, { recursive: true });
        } catch (error) {
            console.error('Failed to create output directory:', error);
        }
    }

    setupRoutes() {
        this.router.post('/create', this.createReport.bind(this));
        this.router.get('/list', this.listReports.bind(this));
        this.router.get('/:reportId', this.getReport.bind(this));
        this.router.put('/:reportId', this.updateReport.bind(this));
        this.router.delete('/:reportId', this.deleteReport.bind(this));

        this.router.post('/:reportId/generate', this.generateReport.bind(this));
        this.router.post('/:reportId/send-whatsapp', this.sendWhatsApp.bind(this));
        this.router.get('/:reportId/download', this.downloadReport.bind(this));
        this.router.post('/:reportId/preview', this.previewReport.bind(this));
    }

    async createReport(req, res) {
        try {
            const result = await this.reportBuilder.createTemplate(req.body);
            res.json(result);
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    }

    async listReports(req, res) {
        try {
            const templates = await this.reportBuilder.listTemplates();
            res.json({ success: true, templates });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    }

    async getReport(req, res) {
        try {
            const template = await this.reportBuilder.getTemplate(req.params.reportId);
            res.json({ success: true, template });
        } catch (error) {
            res.status(404).json({ success: false, error: error.message });
        }
    }

    async updateReport(req, res) {
        try {
            const result = await this.reportBuilder.updateTemplate(req.params.reportId, req.body);
            res.json(result);
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    }

    async deleteReport(req, res) {
        try {
            const result = await this.reportBuilder.deleteTemplate(req.params.reportId);
            res.json(result);
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    }

    async generateReport(req, res) {
        try {
            const template = await this.reportBuilder.getTemplate(req.params.reportId);
            const data = req.body;

            const outputPath = path.join(this.outputDir, `${req.params.reportId}_${Date.now()}.pdf`);
            const result = await this.reportGenerator.generateFromTemplate(template, data, outputPath);

            res.json({
                success: true,
                pdfUrl: `/output/${path.basename(outputPath)}`,
                downloadLink: `/api/reports/${req.params.reportId}/download?${new URLSearchParams(data.parameters || {})}`
            });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    }

    async sendWhatsApp(req, res) {
        try {
            if (!this.whatsappService) {
                return res.status(503).json({
                    success: false,
                    error: 'WhatsApp service not configured'
                });
            }

            const { parameters, phone, sessionId, caption } = req.body;

            if (!phone) {
                return res.status(400).json({
                    success: false,
                    error: 'Phone number is required'
                });
            }

            const template = await this.reportBuilder.getTemplate(req.params.reportId);

            const outputPath = path.join(this.outputDir, `${req.params.reportId}_${Date.now()}.pdf`);
            await this.reportGenerator.generateFromTemplate(template, { parameters }, outputPath);

            const result = await this.whatsappService.sendMedia({
                sessionId: sessionId || 'default',
                to: phone,
                mediaPath: outputPath,
                caption: caption || `تقرير: ${template.name}`
            });

            setTimeout(async () => {
                try {
                    await fs.unlink(outputPath);
                } catch (e) { }
            }, 60000);

            res.json({
                success: true,
                messageId: result.messageId,
                message: 'Report sent successfully via WhatsApp'
            });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    }

    async downloadReport(req, res) {
        try {
            const template = await this.reportBuilder.getTemplate(req.params.reportId);
            const parameters = req.query;

            const result = await this.reportGenerator.generateFromTemplate(template, { parameters });

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${template.name}.pdf"`);
            res.send(Buffer.from(result.pdf));
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    }

    async previewReport(req, res) {
        try {
            const template = await this.reportBuilder.getTemplate(req.params.reportId);
            const data = req.body;

            const html = this.reportGenerator.applyDataToTemplate(template, data);

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    }

    getRouter() {
        return this.router;
    }

    async cleanup() {
        await this.reportGenerator.closeBrowser();
    }
}

module.exports = ReportAPI;
