const express = require('express');

const { prisma } = require('../database');
const { getS3FileInfo, deleteS3File } = require('../S3Client');

const router = express.Router();


router.get('/allkeys', async (req, res) => {
    try {
        const keys = await prisma.file.findMany({
            where: {
                status: 'ready',
            },
            select: { 
                filename: true,
                name: true,
                storageKey: true,
                createdAt: true, 
            },
            orderBy: { createdAt: 'desc' },
        });
        
        res.json({ success: true, keys })

    } catch (err) {
        req.logger.error('api /files/allkeys error', { err });
        res.status(500).json({ error: 'Не удалось получить ключи загруженных файлов' });
    }
});

router.delete('/key/:key', async (req, res) => {
    try {
        const key = 'uploads/' + req.params.key;

        const existInDb = await prisma.file.findUnique({ where: { storageKey: key }, select: { id: true, status: true } });
        if (!existInDb || existInDb.status === 'pending') return res.status(404).json({ error: 'File does not found' });

        await deleteS3File(key);
        await prisma.file.delete({
            where: { id: existInDb.id }
        });

        res.json({ success: true });
    } catch (err) {
        req.logger.error('api /files/key/:key delete error', { err });
        res.status(500).json({ error: 'Не удалось удалить файл' });
    }
});

router.patch('/key/:key', async (req, res) => {
    try {
        const key = 'uploads/' + req.params.key;
        const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
        if (!name || name.length > 16) return res.status(404).json({ error: 'Incorrect name' });

        const existInDb = await prisma.file.findUnique({ where: { storageKey: key }, select: { id: true, status: true } });
        const existInS3 = await getS3FileInfo(key);
        if (!existInDb || !existInS3.exist || existInDb.status === 'pending') return res.status(404).json({ error: 'File does not found' });

        await prisma.file.update({ 
            where: { id: existInDb.id }, 
            data: { 
                name,
                sizeBytes: existInS3.size,
                mimetype: existInS3.mimetype,
            } 
        });
        res.json({ success: true })
    } catch (err) {
        req.logger.error('api /files/key/:key patch error', { err });
        res.status(500).json({ error: 'Не удалось изменить имя файла' });
    }
});

module.exports = router;