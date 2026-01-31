const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.REPORT_JWT_SECRET || 'your-secret-key';

function verifyToken(req, res, next) {
    // Support API Key or JWT
    const apiKey = req.headers['x-api-key'];
    const authHeader = req.headers['authorization'];

    if (apiKey) {
        // Simple API Key check - in production checking against DB is recommended
        if (apiKey.startsWith('rpt_')) {
            req.apiKey = apiKey;
            return next();
        }
    }

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = decoded;
            return next();
        } catch (error) {
            return res.status(401).json({
                error: 'Invalid Token'
            });
        }
    }

    res.status(401).json({
        error: 'Authentication Required'
    });
}

module.exports = { verifyToken };
