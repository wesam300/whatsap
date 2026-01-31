const express = require('express');
const cors = require('cors');
const reportsRouter = require('./routes/reports');
const templatesRouter = require('./routes/templates');
const printRouter = require('./routes/print');
const { verifyToken } = require('./middleware/auth');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Routes - All protected
app.use('/api/reports', verifyToken, reportsRouter);
app.use('/api/templates', verifyToken, templatesRouter);
app.use('/api/print', verifyToken, printRouter);

// Root route for health check
app.get('/', (req, res) => {
    res.json({
        service: 'WhatsApp Reporting Service',
        status: 'online',
        version: '1.0.0',
        message: 'This is an API service. Please use the main dashboard to interact.'
    });
});

const PORT = process.env.REPORT_SERVICE_PORT || 3001;
app.listen(PORT, () => {
    console.log(`📊 Reporting Service running on port ${PORT}`);
});
