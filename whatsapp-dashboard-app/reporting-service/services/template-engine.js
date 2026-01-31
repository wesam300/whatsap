const Handlebars = require('handlebars');
const fs = require('fs').promises;
const path = require('path');

// Register useful helpers
Handlebars.registerHelper('formatDate', (date) => {
    if (!date) return '';
    return new Date(date).toLocaleDateString('ar-SA');
});

Handlebars.registerHelper('formatCurrency', (amount, currency) => {
    if (amount === undefined || amount === null) return '';
    return new Intl.NumberFormat('ar-SA', {
        style: 'currency',
        currency: currency || 'SAR'
    }).format(amount);
});

async function renderTemplate(templateId, data) {
    // Basic security check to prevent directory traversal
    if (templateId.includes('..') || templateId.includes('/') || templateId.includes('\\')) {
        throw new Error('Invalid template ID');
    }

    const templatePath = path.join(__dirname, '../templates', `${templateId}.html`);

    try {
        await fs.access(templatePath);
    } catch (error) {
        throw new Error(`Template '${templateId}' not found`);
    }

    const templateSource = await fs.readFile(templatePath, 'utf8');
    const template = Handlebars.compile(templateSource);
    return template(data);
}

module.exports = { renderTemplate };
