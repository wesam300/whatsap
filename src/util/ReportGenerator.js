'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

class ReportGenerator {
    constructor() {
        this.browser = null;
    }

    async initBrowser() {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
        }
        return this.browser;
    }

    async closeBrowser() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }

    applyDataToTemplate(template, data) {
        const parameters = data.parameters || {};

        let html = this.generateHTML(template, parameters);

        return html;
    }

    generateHTML(template, parameters) {
        const { header, table, footer, styling, settings } = template;

        let html = `
<!DOCTYPE html>
<html dir="rtl">
<head>
    <meta charset="UTF-8">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: ${styling.fontFamily || 'Arial'}, sans-serif;
            font-size: ${styling.fontSize || '12px'};
            direction: rtl;
            background: white;
        }
        .page {
            width: 210mm;
            min-height: 297mm;
            padding: ${settings.margins?.top || 20}mm ${settings.margins?.right || 20}mm ${settings.margins?.bottom || 20}mm ${settings.margins?.left || 20}mm;
            margin: auto;
            background: white;
            position: relative;
        }
        .watermark {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            opacity: 0.1;
            z-index: 0;
            pointer-events: none;
        }
        .content { position: relative; z-index: 1; }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            padding-bottom: 20px;
            border-bottom: 2px solid ${styling.primaryColor || '#667eea'};
            margin-bottom: 20px;
        }
        .header-logo img { max-height: 80px; }
        .header-title {
            text-align: center;
            font-size: 24px;
            font-weight: bold;
            color: ${styling.primaryColor || '#667eea'};
            margin: 20px 0;
        }
        .company-info {
            font-size: 11px;
            line-height: 1.6;
        }
        .company-info i {
            color: ${styling.primaryColor || '#667eea'};
            width: 20px;
            text-align: center;
        }
        .info-section {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            margin: 15px 0;
        }
        .info-row {
            display: flex;
            justify-content: space-between;
            margin: 8px 0;
        }
        .info-label { font-weight: bold; }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        th {
            background: ${styling.primaryColor || '#667eea'};
            color: white;
            padding: 10px;
            text-align: center;
            border: 1px solid ${styling.primaryColor || '#667eea'};
        }
        td {
            padding: 8px;
            text-align: center;
            border: 1px solid #dee2e6;
        }
        tr:nth-child(even) { background: #f8f9fa; }
        .total-row {
            background: ${styling.primaryColor || '#667eea'} !important;
            color: white;
            font-weight: bold;
        }
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 2px solid ${styling.primaryColor || '#667eea'};
        }
        .signatures {
            display: flex;
            justify-content: space-around;
            margin-top: 30px;
        }
        .signature-box {
            text-align: center;
            width: 30%;
        }
        .signature-line {
            border-top: 1px solid #333;
            margin-top: 40px;
            padding-top: 5px;
        }
    </style>
</head>
<body>
    <div class="page">`;

        if (styling.watermark) {
            html += `
        <div class="watermark">
            <img src="${styling.watermark}" style="max-width: 400px;">
        </div>`;
        }

        html += `
        <div class="content">
            <div class="header">`;

        if (header.logo) {
            html += `
                <div class="header-logo">
                    <img src="${header.logo}" alt="Logo">
                </div>`;
        }

        if (header.companyInfo) {
            html += `
                <div class="company-info">`;

            if (header.companyInfo.name) {
                html += `<div><strong>${header.companyInfo.name}</strong></div>`;
            }
            if (header.companyInfo.phone) {
                html += `<div><i class="fa fa-phone"></i> ${header.companyInfo.phone}</div>`;
            }
            if (header.companyInfo.email) {
                html += `<div><i class="fa fa-envelope"></i> ${header.companyInfo.email}</div>`;
            }
            if (header.companyInfo.address) {
                html += `<div><i class="fa fa-location-dot"></i> ${header.companyInfo.address}</div>`;
            }

            html += `
                </div>`;
        }

        html += `
            </div>`;

        if (header.title) {
            html += `
            <div class="header-title">${header.title}</div>`;
        }

        if (parameters) {
            html += `
            <div class="info-section">`;

            for (const [key, value] of Object.entries(parameters)) {
                if (typeof value === 'string' || typeof value === 'number') {
                    html += `
                <div class="info-row">
                    <span class="info-label">${this.formatFieldName(key)}:</span>
                    <span>${value}</span>
                </div>`;
                }
            }

            html += `
            </div>`;
        }

        if (table.columns && table.columns.length > 0) {
            html += `
            <table>
                <thead>
                    <tr>`;

            table.columns.forEach(col => {
                html += `<th>${col.label || col.field}</th>`;
            });

            html += `
                    </tr>
                </thead>
                <tbody>`;

            const items = parameters.items || [];
            items.forEach((item, index) => {
                html += `<tr>`;

                table.columns.forEach(col => {
                    const value = item[col.field] || '';
                    html += `<td>${value}</td>`;
                });

                html += `</tr>`;
            });

            if (parameters.total) {
                html += `
                    <tr class="total-row">
                        <td colspan="${table.columns.length - 1}">الإجمالي</td>
                        <td>${parameters.total}</td>
                    </tr>`;
            }

            html += `
                </tbody>
            </table>`;
        }

        if (footer) {
            html += `
            <div class="footer">`;

            if (footer.notes) {
                html += `<div style="text-align: center; margin: 15px 0;">${footer.notes}</div>`;
            }

            if (footer.signatures && footer.signatures.length > 0) {
                html += `
                <div class="signatures">`;

                footer.signatures.forEach(sig => {
                    html += `
                    <div class="signature-box">
                        <div>${sig}</div>
                        <div class="signature-line"></div>
                    </div>`;
                });

                html += `
                </div>`;
            }

            html += `
            </div>`;
        }

        html += `
        </div>
    </div>
</body>
</html>`;

        return html;
    }

    formatFieldName(field) {
        return field
            .replace(/_/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase());
    }

    async generatePDF(html, outputPath) {
        const browser = await this.initBrowser();
        const page = await browser.newPage();

        await page.setContent(html, { waitUntil: 'networkidle0' });

        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' }
        });

        await page.close();

        if (outputPath) {
            await fs.writeFile(outputPath, pdf);
        }

        return pdf;
    }

    async generateFromTemplate(template, data, outputPath = null) {
        const html = this.applyDataToTemplate(template, data);
        const pdf = await this.generatePDF(html, outputPath);

        return {
            html,
            pdf,
            success: true
        };
    }
}

module.exports = ReportGenerator;
