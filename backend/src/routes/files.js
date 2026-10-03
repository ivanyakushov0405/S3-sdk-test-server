const express = require('express');

const { prisma } = require('../database');

const router = express.Router();


router.get('/allkeys', async (req, res) => {
    try {
        const keys = await prisma.file.findMany({
            where: {
                status: 'ready',
            },
            select: { 
                filename: true,
                storageKey: true,
                 createdAt: true, 
            },
        });
        
        res.json({ success: true, keys })

    } catch (err) {
        req.logger.error('api /files/allkeys error', { err });
        res.status(500).json({ error: 'Не удалось получить ключи загруженных файлов' });
    }
});

module.exports = router;