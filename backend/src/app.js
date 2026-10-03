const express = require('express');
const cors = require('cors');
const requestIp = require('request-ip');

const requestLogger = require('./middleware/requestLogger');
const errorHandler = require('./middleware/errorLogger');

const s3Route = require('./routes/s3');
const filesRoute = require('./routes/files');
const adminRoute = require('./routes/admin');

const app = express();
app.use(cors({
    origin: process.env.CORS_FRONTEND_URL,
}));
app.use(express.json());

app.set('trust proxy', true);
app.use(requestIp.mw());
app.use(requestLogger);
app.use('/api/s3', s3Route);
app.use('/api/files', filesRoute);
app.use('/api/admin', adminRoute);
app.use(errorHandler);

module.exports = app;