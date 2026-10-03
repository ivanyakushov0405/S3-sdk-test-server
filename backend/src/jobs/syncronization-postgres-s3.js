const { prisma } = require('../database');
const { getS3FileInfo, countS3Objects, deleteS3File } = require('../S3Client');
const { logger } = require('../logger');



const syncPeriod = parseInt(process.env.SYNCRONIZATION_DB_S3_PERIOD_MS); //24 часа
async function syncronizationDBToS3(jobName) {
    const syncLogger = logger.child({ type: 'job', job: jobName });
    syncLogger.info('Запуск...');
    
    const sinceDate = new Date(Date.now() - syncPeriod);

    const { s3Keys, s3TotalCount } = await countS3Objects('uploads/', sinceDate);
    const dbFiles = await prisma.file.findMany({
        where: { createdAt: { gt: sinceDate } },
        select: { id: true, storageKey: true, status: true, createdAt: true },
    });
    
    syncLogger.info(`За период ${(syncPeriod / 60000).toFixed(0)} мин: в S3 — ${s3Keys.length}, в БД — ${dbFiles.length}`, {
        syncPeriodMs: syncPeriod,
        uploadedS3: s3TotalCount,
        createdPostgres: dbFiles.length,
    });
    
    
    // Step 1: запись в БД есть, а файла в S3 нет — чистим БД
    let numberDeletedDBFiles = 0;
    const s3KeySet = new Set(s3Keys);
    for (const file of dbFiles) {
        if (s3KeySet.has(file.storageKey) || file.status === 'pending') continue;
        try {
            const existed = await getS3FileInfo(file.storageKey); // перепроверяем напрямую, список мог немного отстать
            if (!existed.exist) {
                await prisma.file.delete({ where: { id: file.id } });
                numberDeletedDBFiles++;
                syncLogger.info(`Удалена запись без файла: ${file.storageKey}`, { deletedId: file.id, deletedKey: file.storageKey, source: 'postgres' });
            }
        } catch (err) {
            syncLogger.error(`Ошибка проверки в БД ${file.storageKey}`, { err, key: file.storageKey, source: 'postgres' });
        }
    }

    // Step 2: файл в S3 есть, а записи в БД нет — чистим S3
    let numberDeletedS3Files = 0;
    const dbKeySet = new Set(dbFiles.map(f => f.storageKey));
    for (const key of s3Keys) {
        if (dbKeySet.has(key)) continue;

        try {
            await deleteS3File(key);
            numberDeletedS3Files ++;
            syncLogger.info(`Удалён файл без записи в БД: ${key}`, { deletedKey: key, source: 's3' });
        } catch (err) {
            syncLogger.error(`Не удалось удалить файл ${key}`, { err, key, source: 's3' });
        }
    }
    const dbFilesTotalCount = await prisma.file.count({ where: { status: 'ready' } });
    if (dbFilesTotalCount !== (s3TotalCount - numberDeletedS3Files)) syncLogger.warn(`Нужны синхронизация за полный период времени: в S3 — ${s3TotalCount - numberDeletedS3Files}, в БД — ${dbFilesTotalCount}`, {
        totalCountS3: (s3TotalCount - numberDeletedS3Files),
        totalCountPostgres: dbFilesTotalCount,
    });
    
    syncLogger.info(`Синхронизация завершена, удалено: в S3 — ${numberDeletedS3Files}, в БД — ${numberDeletedDBFiles}`, { 
        deletedS3: numberDeletedS3Files, 
        deletedPostgres: numberDeletedDBFiles,
    });
    return { 
        syncPeriodMs: syncPeriod,
        uploadedS3: s3TotalCount,
        createdRecordsPostgres: dbFiles.length,
        isNeedFullSync: (dbFilesTotalCount !== (s3TotalCount - numberDeletedS3Files)),
        deletedS3: numberDeletedS3Files, 
        deletedPostgres: numberDeletedDBFiles 
    };
}

async function fullSyncronizationDBToS3(jobName, sinceDate, untilDate, fileStatus = 'ready') {
    const syncLogger = logger.child({ type: 'job', job: jobName });
    syncLogger.info('Запуск...');
    
    const dbWhere = {};
    if (sinceDate || untilDate) {
        dbWhere.createdAt = {};
        if (sinceDate) dbWhere.createdAt.gte = sinceDate;
        if (untilDate) dbWhere.createdAt.lte = untilDate;
    }
    
    let status;
    switch (fileStatus) {
        case 'ready':
            status = 'ready';
            break;
        case 'pending':
            status = 'pending';
            break;
        case 'any':
            // status остаётся undefined — Prisma не фильтрует по этому полю
            break;
        default:
            throw new Error('Недопустимый статус записи');
    }
    const dbCount = await prisma.file.findMany({ 
        where: { ...dbWhere, status }, 
        select: { id: true, storageKey: true, status: true, createdAt: true }
    });
    const uploadsStat = await countS3Objects('uploads/', sinceDate, untilDate);
    syncLogger.info(`За период from ${sinceDate} to ${untilDate}: в S3 — ${uploadsStat.filteredCount}, в БД — ${dbCount.length}`, {
        sinceDate,
        untilDate,
        uploadedS3: uploadsStat.filteredCount,
        createdPostgres: dbCount.length,
    });


    // Step 1: запись в БД есть, а файла в S3 нет — чистим БД
    let numberDeletedDBFiles = 0;
    const s3KeySet = new Set(uploadsStat.s3Keys);
    for (const file of dbCount) {
        if (s3KeySet.has(file.storageKey)) continue;
        try {
            const existed = await getS3FileInfo(file.storageKey); // перепроверяем напрямую, список мог немного отстать
            if (!existed.exist) {
                await prisma.file.delete({ where: { id: file.id } });
                numberDeletedDBFiles++;
                syncLogger.info(`Удалена запись без файла: ${file.storageKey}`, { deletedId: file.id, deletedKey: file.storageKey, source: 'postgres' });
            }
        } catch (err) {
            syncLogger.error(`Ошибка проверки в БД ${file.storageKey}`, { err, key: file.storageKey, source: 'postgres' });
        }
    }

    // Step 2: файл в S3 есть, а записи в БД нет — чистим S3
    let numberDeletedS3Files = 0;
    const dbKeySet = new Set(dbCount.map(f => f.storageKey));
    for (const key of uploadsStat.s3Keys) {
        if (dbKeySet.has(key)) continue;
        try {
            await deleteS3File(key);
            numberDeletedS3Files ++;
            syncLogger.info(`Удалён файл без записи в БД: ${key}`, { deletedKey: key, source: 's3' });
        } catch (err) {
            syncLogger.error(`Не удалось удалить файл ${key}`, { err, key, source: 's3' });
        }
    }
    
    syncLogger.info(`Полная синхронизация завершена, удалено: в S3 — ${numberDeletedS3Files}, в БД — ${numberDeletedDBFiles}`, { 
        deletedS3: numberDeletedS3Files, 
        deletedPostgres: numberDeletedDBFiles,
    });
    return { 
        sinceDate,
        untilDate,
        uploadedS3: uploadsStat.filteredCount,
        createdPostgres: dbCount.length,
        deletedS3: numberDeletedS3Files, 
        deletedPostgres: numberDeletedDBFiles 
    };
}

module.exports = { syncronizationDBToS3, fullSyncronizationDBToS3 }