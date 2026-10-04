const winston = require('winston');

const errorMetaFormat = winston.format((info) => {
    Object.keys(info).forEach((key) => {
        if (info[key] instanceof Error) {
            info[key] = {
                message: info[key].message,
                stack: info[key].stack,
                ...info[key], // остальные свойства ошибки, если есть (например, err.code)
            };
        }
    });
    return info;
});
const logger = winston.createLogger({
    format: winston.format.combine(
        winston.format.timestamp(),
        errorMetaFormat(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { 
        service: 'MyServer',
        instanceId: process.env.NODE_APP_INSTANCE,
        appName: process.env.name
    },
    transports: [
        //new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        //new winston.transports.File({ filename: 'logs/combined.log', level: 'info' }),
    ],
});
// error: 0
// warn:  1
// info:  2
// http:  3
// verbose: 4
// debug: 5
// silly: 6

const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ level, message, timestamp, service, job, stack, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        const jobStr = job ? ` [${job}] ` : ' ';
        const errStr = stack ? `\n${stack}` : '';
        return `${timestamp} [${service}]${jobStr}${level}: ${message}${metaStr}${errStr}`;
    })
)

// S3
const s3ClientLogger = logger.child({ sdk: 's3' });
const safeStringify = (obj) => {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
        // Проверяем сериализованный Buffer (после toJSON())
        if (value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) {
            return `<Buffer ${value.data.length} bytes>`;
        }
        // На случай, если Buffer ещё не сериализован (редко, но на всякий случай)
        if (Buffer.isBuffer(value)) {
            return `<Buffer ${value.length} bytes>`;
        }
        if (value && typeof value.pipe === 'function') {
            return '<Stream>';
        }
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) return '[Circular]';
            seen.add(value);
        }
        return value;
    });
};
function formatS3Log(level, args) {
    // Если пришёл один объект с полезными полями — разворачиваем его на верхний уровень
    const detail = args.length === 1 && typeof args[0] === 'object' ? args[0] : { raw: args };
    const isExpectedNotFound =
        detail.commandName === 'HeadObjectCommand' &&
        (detail.error?.name === 'NotFound' || detail.metadata?.httpStatusCode === 404);

    const actualLevel = isExpectedNotFound ? 'debug' : level;
    const meta = {
        clientName: detail.clientName,
        input: detail.input ? JSON.parse(safeStringify(detail.input)) : undefined,
        errorName: detail.error?.name,
        errorCode: detail.error?.Code,
        httpStatusCode: detail.metadata?.httpStatusCode,
        requestId: detail.metadata?.requestId,
    };

    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    const errStr = detail.error?.message ? `\n${detail.error?.message}` : '';
    const parts = [`[S3 SDK] ${detail.commandName}`, metaStr.trim(), errStr.trim()].filter(Boolean);

    s3ClientLogger[actualLevel](parts.join(' '), {
        ...meta,
        commandName: detail.commandName,
        errorMessage: detail.error?.message,
    });
}
const s3LoggingEnabled = process.env.S3_LOGGING_FLAG === 'true';

const noop = () => {};
const formatsForS3 = {
    error: (...args) => formatS3Log('error', args),
    warn: s3LoggingEnabled ? (...args) => formatS3Log('warn', args) : noop,
    info: s3LoggingEnabled ? (...args) => formatS3Log('info', args) : noop,
    debug: noop,
};

const envConfig = {
    'production': { level: 'info', format: winston.format.json() },
    'dev-container': { level: 'debug', format: winston.format.json() },
    'dev': { level: 'debug', format: consoleFormat },
};

const { level, format } = envConfig[process.env.NODE_ENV] || envConfig.production;

logger.add(new winston.transports.Console({ level, format }));

module.exports = { logger, formatsForS3 };