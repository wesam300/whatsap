'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const { Client, LocalAuth } = require('./index');
const ReportAPI = require('./src/util/ReportAPI');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'wa_401293125daf37cb993ac6f570c7edb93559d71dc9f75615f9a26858cbb87da7';

// Authentication Middleware
const authenticateAPI = (req, res, next) => {
    // Allow public access to builder and static files
    if (req.path.startsWith('/builder') ||
        req.path === '/' ||
        req.path.startsWith('/css') ||
        req.path.startsWith('/js') ||
        req.path.startsWith('/output')) {
        return next();
    }

    // Check API Key
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    if (apiKey && apiKey === API_KEY) {
        return next();
    }

    // Allow session token for internal communication if needed
    // const sessionToken = req.headers['x-session-token'];

    res.status(401).json({ success: false, error: 'Unauthorized: Invalid API Key' });
};

app.use(authenticateAPI);
const clients = new Map();

function getOrCreateClient(sessionId = 'default') {
    if (!clients.has(sessionId)) {
        console.log(`Initializing client for session: ${sessionId}`);
        const client = new Client({
            authStrategy: new LocalAuth({ clientId: sessionId }),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        });

        client.on('qr', (qr) => {
            console.log(`QR Code for session ${sessionId}:`, qr);
            client.qrCode = qr;
        });

        client.on('ready', () => {
            console.log(`Client ${sessionId} is ready!`);
            client.info = client.info || {}; // Ensure info object exists
        });

        client.on('authenticated', () => {
            console.log(`Client ${sessionId} authenticated`);
            client.qrCode = null; // Clear QR code on authentication
        });

        client.on('auth_failure', (msg) => {
            console.error(`Authentication failure for session ${sessionId}:`, msg);
        });

        client.initialize();
        clients.set(sessionId, client);
    }

    return clients.get(sessionId);
}

// WhatsApp Service for Reports
const whatsappService = {
    async sendMedia({ sessionId, to, mediaPath, caption }) {
        try {
            const client = getOrCreateClient(sessionId);

            // Wait a bit if client is initializing
            if (!client.info) {
                // Simple check, might need more robust readiness check
                if (!client.pupBrowser) {
                    throw new Error('Client not ready. Please scan QR code first.');
                }
            }

            const chatId = to.includes('@c.us') ? to : `${to}@c.us`;

            // Read file as base64
            const mediaData = fs.readFileSync(mediaPath, { encoding: 'base64' });
            const { MessageMedia } = require('./index');
            const media = new MessageMedia('application/pdf', mediaData, path.basename(mediaPath));

            const result = await client.sendMessage(chatId, media, {
                caption: caption
            });

            return {
                success: true,
                messageId: result.id._serialized
            };
        } catch (error) {
            console.error('WhatsApp send error:', error);
            throw error;
        }
    }
};

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/output', express.static(path.join(__dirname, 'output')));

// Report API
const reportAPI = new ReportAPI(whatsappService);
app.use('/api/reports', reportAPI.getRouter());

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/builder', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'builder.html'));
});

app.get('/reports', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'reports.html'));
});

// WhatsApp Session Management API (Simplified for main project)
app.get('/api/sessions/:sessionId/qr', (req, res) => {
    const client = getOrCreateClient(req.params.sessionId);

    if (client.qrCode) {
        res.json({ success: true, qr: client.qrCode });
    } else if (client.info) {
        res.json({ success: true, authenticated: true, info: client.info });
    } else {
        res.json({ success: false, message: 'QR not ready yet' });
    }
});

app.get('/api/sessions/:sessionId/status', (req, res) => {
    const client = clients.get(req.params.sessionId);

    if (!client) {
        return res.json({ success: true, status: 'not_initialized' });
    }

    // Determine status
    let status = 'initializing';
    if (client.qrCode) status = 'waiting_qr';
    if (client.info) status = 'ready';

    res.json({
        success: true,
        status,
        info: client.info
    });
});

// Health Check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'WhatsApp Main Project with Reporting',
        sessions: Array.from(clients.keys())
    });
});

// Cleanup
process.on('SIGINT', async () => {
    console.log('Shutting down...');

    for (const [sessionId, client] of clients) {
        console.log(`Closing session: ${sessionId}`);
        await client.destroy().catch(e => console.error(e));
    }

    if (reportAPI.cleanup) await reportAPI.cleanup();
    process.exit(0);
});

// Start Server
app.listen(PORT, () => {
    console.log(`\n🚀 WhatsApp Main Project Service`);
    console.log(`📍 Server: http://localhost:${PORT}`);
    console.log(`📊 Reports: http://localhost:${PORT}/reports`);
    console.log(`\nReady to accept connections...\n`);

    // Initialize default session on start
    getOrCreateClient('default');
});
