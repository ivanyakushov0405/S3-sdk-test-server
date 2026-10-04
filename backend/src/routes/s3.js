const express = require('express');
const busboy = require('busboy');
const multer = require('multer');

const { prisma } = require('../database');

const { getStorageKey, getS3FileInfo, uploadS3File, uploadMultipartS3File, getS3UploadUrl } = require('../S3Client');

const router = express.Router();

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: parseInt(process.env.UPLOAD_MULTER_LIMIT_MB) * 1024 * 1024 },
});


router.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Файл не передан' });
    try {
        const nameFile = req.query.name;
        if (!nameFile || nameFile.length > 16) return res.status(404).json({ error: 'Incorrect name' });
        const key = getStorageKey('uploads', req.file.originalname);
        await uploadS3File(req.file.buffer, key, req.file.mimetype);
        await prisma.file.create({
            data: {
                storageKey: key,
                filename: req.file.originalname,
                name: nameFile,
                mimetype: req.file.mimetype,
                sizeBytes: req.file.size,
                status: 'ready',
            }
        });
        res.json({ key });
    } catch (err) {
        req.logger.error('S3 upload error:', { err });
        res.status(500).json({ error: 'Не удалось загрузить файл' });
    }
});


async function busboyFileMulti(req, res, key, fileStream, mimeType, filename, name, sendResponse) {
    let upload, uploadedBytes;
    try {
        upload = uploadMultipartS3File(key, fileStream, mimeType);
        upload.on('httpUploadProgress', (progress) => {
            uploadedBytes = progress.loaded;
        });
        const uploadStart = Date.now();
        await upload.done();
        req.logger.debug('Upload в S3 завершён', {
            key,
            uploadDurationMs: Date.now() - uploadStart,
        });

        await prisma.file.create({
            data: {
                storageKey: key,
                filename,
                name,
                mimetype: mimeType,
                sizeBytes: uploadedBytes,
                status: 'ready',
            },
        });

        sendResponse(200, { key });
    } catch (err) {
        req.logger.error('stream-upload api error', { err });
        if (upload) {
            try {
                await upload.abort();
            } catch (abortErr) {
                if (abortErr.name !== 'NoSuchUpload') {
                    req.logger.error('Не удалось отменить upload', { abortErr });
                }
            }
        }
        sendResponse(500, { error: 'Не удалось загрузить файл' });
    }
}
async function busboyFileBuff(req, res, key, fileStream, mimeType, filename, name, sendResponse, start) {
    try {
        const chunks = [];
        for await (const chunk of fileStream) {
            chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);

        req.logger.info('Файл прочитан в память', { 
            totalBytes: buffer.length, 
            readDurationMs: Date.now() - start 
        });

        const upload = uploadMultipartS3File(key, buffer, mimeType);

        upload.on('httpUploadProgress', (progress) => {
            req.logger.debug('Прогресс загрузки в S3', { loaded: progress.loaded });
        });

        await upload.done();

        await prisma.file.create({
            data: {
                storageKey: key,
                filename,
                name,
                mimetype: mimeType,
                sizeBytes: buffer.length,
                status: 'ready',
            },
        });

        sendResponse(200, { key });
    } catch (err) {
        req.logger.error('stream-upload api error', { err });
        sendResponse(500, { error: 'Не удалось загрузить файл' });
    }
}

router.post('/stream-upload', (req, res) => {
    const MAX_SIZE = parseInt(process.env.UPLOAD_MULTIPART_LIMIT_MB) * 1024 * 1024;
    const contentLength = parseInt(req.headers['content-length'], 10);
    const nameFile = req.query.name;
    if (!nameFile || nameFile.length > 16) return res.status(404).json({ error: 'Incorrect name' });

    if (contentLength && contentLength > MAX_SIZE) {
        return res.status(413).json({ error: `Файл превышает лимит ${process.env.UPLOAD_MULTIPART_LIMIT_MB} МБ` });
    }

    let responseSent = false;
    function sendResponse(status, body) {
        if (responseSent) return;
        responseSent = true;
        res.status(status).json(body);
    }

    const bb = busboy({
        headers: req.headers,
        limits: { fileSize: MAX_SIZE, files: 1 },
    });

    bb.on('field', (name, value) => {
        req.logger.debug(`Поле ${name} = ${value}`);
    });

    bb.on('file', async (name, fileStream, info) => {
        const { filename, mimeType } = info;
        const key = getStorageKey('uploads', filename);

        const start = Date.now();

        fileStream.on('limit', () => {
            req.logger.warn('Файл превысил лимит размера', { filename });
        });
        fileStream.on('end', () => {
            req.logger.debug('Файл дочитан от клиента', {
                readDurationMs: Date.now() - start,
            });
        });
        fileStream.on('error', (err) => {
            req.logger.error('fileStream ERROR', { err });
        });
        fileStream.on('close', () => {
            req.logger.debug('fileStream CLOSE событие');
        });
        await busboyFileMulti(req, res, key, fileStream, mimeType, filename, nameFile, sendResponse)
        
    });

    bb.on('close', () => {
        req.logger.debug('Busboy завершил обработку');
    });

    bb.on('error', (err) => {
        req.logger.error('stream-upload api error', { err });
        sendResponse(500, { error: 'Ошибка обработки файла' });
    });

    req.pipe(bb);
});

router.get('/presigned-upload-url', async (req, res) => {
    const { filename, name, type, size } = req.query;
    if (!name || name.length > 16) return res.status(404).json({ error: 'Incorrect name' });
    const MAX_SIZE = parseInt(process.env.UPLOAD_URL_LIMIT_MB) * 1024 * 1024;

    if (!filename || !type) {
        return res.status(400).json({ error: 'filename и type обязательны' });
    }
    if (size && parseInt(size, 10) > MAX_SIZE) {
        return res.status(413).json({ error: `Файл превышает лимит ${process.env.UPLOAD_URL_LIMIT_MB} МБ` });
    }
    try {
        const key = getStorageKey('uploads', filename);
        const url = await getS3UploadUrl(key, type);
        await prisma.file.create({
            data: {
                storageKey: key,
                filename,
                name,
                mimetype: type,
                sizeBytes: parseInt(size, 10) || 0,
                status: 'pending',
            },
        });
        res.json({ url, key });
    } catch (err) {
        req.logger.error('presigned-upload-url api error:', { err });
        res.status(500).json({ error: 'Не удалось получить ссылку' });
    }
});
router.post('/confirm-upload', async (req, res) => {
    const { key, filename } = req.query;

    if (!key || !filename) {
        return res.status(400).json({ error: 'key и filename обязательны' });
    }

    try {
        // Проверяем у САМОГО S3, что файл реально долетел, и берём РЕАЛЬНЫЕ метаданные
        const existed = await getS3FileInfo(key);
        if (existed.exist) {
            const file = await prisma.file.update({
                where: { storageKey: key },
                data: { status: 'ready', sizeBytes: existed.size, mimetype: existed.mimetype },
            });

            res.status(201).json(file);
        } else return res.status(400).json({ error: 'Файл не найден в хранилище — загрузка не завершена' });
        
    } catch (err) {
        req.logger.error('confirm-upload api error:', { err });
        res.status(500).json({ error: 'Не удалось подтвердить загрузку' });
    }
});

router.get('/presigned-download-url', async (req, res) => {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'key обязателен' });

    try {
        const url = await getS3DownloadUrl(key);
        res.json({ url });
    } catch (err) {
        req.logger.error('presigned-download-url api error:', { err });
        res.status(500).json({ error: 'Не удалось получить ссылку' });
    }
});

module.exports = router;
