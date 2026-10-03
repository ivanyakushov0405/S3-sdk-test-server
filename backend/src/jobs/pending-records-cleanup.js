const { prisma } = require('../database');
const { getS3FileInfo } = require('../S3Client');
const { logger } = require('../logger');
const pLimit = require('p-limit');


const limit = pLimit(10);
const stalingLimit = parseInt(process.env.CLEANUPPENDING_PERIOD_MS); // 10мин
async function cleanupPendingFiles(jobName) {
    const cleanupLogger = logger.child({ type: 'job', job: jobName });
    cleanupLogger.info('Запуск...');
    
    let restored = 0, deleted = 0, errors = 0;

    const staleFiles = await prisma.file.findMany({
        where: {
            status: 'pending',
            createdAt: { lt: new Date(Date.now() - stalingLimit) }
        },
    });
    if (staleFiles.length === 0) {
        cleanupLogger.info(`Нет просроченных записей`);
        return;
    }
    cleanupLogger.info(`Найдено ${staleFiles.length} просроченных записей, начинаю очистку...`);

    await Promise.all(
        staleFiles.map(file => limit(async () => {
            try {
                const existed = await getS3FileInfo(file.storageKey);
                if (existed.exist) {
                    await prisma.file.update({
                        where: { id: file.id },
                        data: { status: 'ready', sizeBytes: existed.size, mimetype: existed.mimetype },
                    });
                    restored++;
                    cleanupLogger.info(`Восстановлена запись: ${file.storageKey}`);
                } else {
                    await prisma.file.delete({ where: { id: file.id } });
                    deleted++;
                    cleanupLogger.info(`Удалена запись без файла: ${file.storageKey}`);
                }
                
            } catch (err) {
                errors++;
                cleanupLogger.error(`Ошибка в проверке ${file.storageKey}:`, { err });
            }
        }))
    );
    
    cleanupLogger.info('Очистка завершена', { restored, deleted, errors, total: staleFiles.length });
    return { restored, deleted, errors, total: staleFiles.length };
}

module.exports = cleanupPendingFiles;