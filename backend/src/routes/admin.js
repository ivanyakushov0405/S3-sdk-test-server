const express = require('express');
const { prisma } = require('../database');

const { countS3Objects } = require('../S3Client');
const { fullSyncronizationDBToS3 } = require('../jobs/syncronization-postgres-s3');

const router = express.Router();

router.get('/storages-stat', async (req, res) => {
    const statLogger = req.logger;
    try {
        const { from, to } = req.query;

        const sinceDate = from ? new Date(from) : null;
        const untilDate = to ? new Date(to) : null;

        // валидация — проверяем, что даты распарсились корректно
        if (from && isNaN(sinceDate.getTime())) return res.status(400).json({ error: 'Некорректный формат даты "from"' });
        if (to && isNaN(untilDate.getTime())) return res.status(400).json({ error: 'Некорректный формат даты "to"' });
        if (sinceDate && untilDate && sinceDate > untilDate) return res.status(400).json({ error: '"from" не может быть позже "to"' });

        const uploadsStat = await countS3Objects('uploads/', sinceDate, untilDate);
        const backupsStat = await countS3Objects('backups/', sinceDate, untilDate);

        const dbWhere = {};
        if (sinceDate || untilDate) {
            dbWhere.createdAt = {};
            if (sinceDate) dbWhere.createdAt.gte = sinceDate;
            if (untilDate) dbWhere.createdAt.lte = untilDate;
        }

        const dbReadyCount = await prisma.file.count({ where: { ...dbWhere, status: 'ready' } });
        const dbPendingCount = await prisma.file.count({ where: { ...dbWhere, status: 'pending' } });

        const stat = {
            period: { from: sinceDate, to: untilDate },
            s3Uploads: uploadsStat.filteredCount,
            s3Backups: backupsStat.filteredCount,
            postgresReadyStatus: dbReadyCount,
            postgresPendingStatus: dbPendingCount,
        };

        statLogger.info('Статистика получена', stat);
        res.json(stat);
    } catch (err) {
        statLogger.error('Ошибка получения статистики', { err });
        res.status(500).json({ error: 'Не удалось получить статистику' });
    }
});
// пример GET /api/admin/full-sync?status=ready&from=2026-09-01&to=2026-09-30
router.delete('/full-sync', async (req, res) => {
    const syncRouteLogger = req.logger;
    try {
        const { status, from, to } = req.query;
        if (!status) return res.status(400).json({ error: 'Status не должен быть пустым' });
        const sinceDate = from ? new Date(from) : null;
        const untilDate = to ? new Date(to) : null;

        if (from && isNaN(sinceDate.getTime())) return res.status(400).json({ error: 'Некорректный формат даты "from"' });
        if (to && isNaN(untilDate.getTime())) return res.status(400).json({ error: 'Некорректный формат даты "to"' });
        if (sinceDate && untilDate && sinceDate > untilDate) return res.status(400).json({ error: '"from" не может быть позже "to"' });
        
        const stat = await fullSyncronizationDBToS3('full-sync', sinceDate, untilDate, status);
        res.json(stat);
    } catch (err) {
        syncRouteLogger.error('Ошибка полной синхронизации', { err });
        res.status(400).json({ error: err.message || 'Не удалось выполнить синхронизацию' });
    }
});

module.exports = router;