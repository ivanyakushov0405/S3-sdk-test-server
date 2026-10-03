const { abortIncompleteMultipartUploads } = require('../S3Client');
const { logger } = require('../logger');
//logger.info(`Отменена незавершённая загрузка: ${upload.Key}`, { abortedId: upload.Key });
//abortIncompleteMultipartUploads('backups/').then(() => logger.info('[S3-abort-multipart] backups/ Нет незавершенных загрузок'));
//cleanupIncompleteMultipartUploads('uploads/').then(() => logger.info('[S3-abort-multipart] uploads/ Нет незавершенных загрузок'));

async function cleanupIncompleteMultipartUploads(jobName) {
    const cleanupIncompleteUploadsLogger = logger.child({ type: 'job', job: jobName });
    cleanupIncompleteUploadsLogger.info('Запуск...')
    let abortedCount = 0;
    try {
        abortedCount = await abortIncompleteMultipartUploads();
    } catch (err) {
        cleanupIncompleteUploadsLogger.error('Ошибка в процессе отмена загрузок', { err });
    }
    cleanupIncompleteUploadsLogger.info(`Очистка заверешена, отмененно: ${abortedCount}`)
    return abortedCount;
}

module.exports = cleanupIncompleteMultipartUploads;