'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const ReportAPI = require('./ReportAPI');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/output', express.static(path.join(__dirname, 'output')));

const whatsappService = {
    async sendMedia({ sessionId, to, mediaPath, caption }) {
        console.log('WhatsApp send media:', { sessionId, to, mediaPath, caption });
        return { messageId: `msg_${Date.now()}`, success: true };
    }
};

const reportAPI = new ReportAPI(whatsappService);
app.use('/api/reports', reportAPI.getRouter());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/builder', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'builder.html'));
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'reporting-service' });
});

process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await reportAPI.cleanup();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    await reportAPI.cleanup();
    process.exit(0);
});

app.listen(PORT, () => {
    console.log(`Reporting Service running on http://localhost:${PORT}`);
    console.log(`Report Builder: http://localhost:${PORT}/builder`);
});
