'use strict';

const fs = require('fs').promises;
const path = require('path');

class ReportBuilder {
    constructor(templatesDir = './templates') {
        this.templatesDir = templatesDir;
        this.ensureTemplatesDir();
    }

    async ensureTemplatesDir() {
        try {
            await fs.mkdir(this.templatesDir, { recursive: true });
        } catch (error) {
            console.error('Failed to create templates directory:', error);
        }
    }

    generateReportId() {
        return `RPT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    async createTemplate(templateData) {
        const reportId = this.generateReportId();

        const template = {
            id: reportId,
            name: templateData.name || 'Untitled Report',
            version: '1.0',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            header: templateData.header || {
                logo: '',
                title: '',
                companyInfo: {}
            },
            dataSource: templateData.dataSource || {
                type: 'parameters',
                fields: []
            },
            table: templateData.table || {
                columns: []
            },
            footer: templateData.footer || {
                signatures: [],
                qrCode: false,
                notes: ''
            },
            styling: templateData.styling || {
                primaryColor: '#667eea',
                secondaryColor: '#764ba2',
                fontFamily: 'Arial',
                fontSize: '12px',
                watermark: null
            },
            settings: templateData.settings || {
                pageSize: 'A4',
                orientation: 'portrait',
                margins: { top: 20, right: 20, bottom: 20, left: 20 }
            }
        };

        const filePath = path.join(this.templatesDir, `${reportId}.json`);
        await fs.writeFile(filePath, JSON.stringify(template, null, 2));

        return {
            success: true,
            reportId,
            apiEndpoint: `/api/reports/${reportId}`,
            downloadLink: `/api/reports/${reportId}/download`,
            whatsappEndpoint: `/api/reports/${reportId}/send-whatsapp`
        };
    }

    async getTemplate(reportId) {
        try {
            const filePath = path.join(this.templatesDir, `${reportId}.json`);
            const data = await fs.readFile(filePath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            throw new Error(`Template not found: ${reportId}`);
        }
    }

    async updateTemplate(reportId, updates) {
        const template = await this.getTemplate(reportId);

        Object.assign(template, updates, {
            updatedAt: new Date().toISOString()
        });

        const filePath = path.join(this.templatesDir, `${reportId}.json`);
        await fs.writeFile(filePath, JSON.stringify(template, null, 2));

        return { success: true, template };
    }

    async deleteTemplate(reportId) {
        try {
            const filePath = path.join(this.templatesDir, `${reportId}.json`);
            await fs.unlink(filePath);
            return { success: true };
        } catch (error) {
            throw new Error(`Failed to delete template: ${reportId}`);
        }
    }

    async listTemplates() {
        try {
            const files = await fs.readdir(this.templatesDir);
            const templates = [];

            for (const file of files) {
                if (file.endsWith('.json')) {
                    const data = await fs.readFile(path.join(this.templatesDir, file), 'utf8');
                    const template = JSON.parse(data);
                    templates.push({
                        id: template.id,
                        name: template.name,
                        createdAt: template.createdAt,
                        updatedAt: template.updatedAt
                    });
                }
            }

            return templates;
        } catch (error) {
            return [];
        }
    }

    validateTemplate(template) {
        const errors = [];

        if (!template.name) {
            errors.push('Template name is required');
        }

        if (!template.table || !template.table.columns || template.table.columns.length === 0) {
            errors.push('At least one table column is required');
        }

        if (!template.dataSource || !template.dataSource.fields) {
            errors.push('Data source fields are required');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }
}

module.exports = ReportBuilder;
