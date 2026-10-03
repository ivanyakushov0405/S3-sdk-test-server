require('dotenv').config();
const cron = require('node-cron');
const { redis } = require('../database');
const { logger } = require('../logger');

const cleanupIncompleteMultipartUploads = require('../jobs/incomplete-uploads-cleanup');
const { syncronizationDBToS3 } = require('../jobs/syncronization-postgres-s3');
const cleanupPendingFiles = require('../jobs/pending-records-cleanup');
const postgresBackupToS3 = require('../jobs/postgres-backup');
const cronLock = require('../utils/cron-lock');


process.on('unhandledRejection', (reason) => logger.error('Unhandled Rejection', { reason }));
process.on('uncaughtException', (err) => { logger.error('Uncaught Exception', { err }); process.exit(1); });

//конфиг джобов
const cronJobs = {
    CLEANUPPENDING: {
        name: 'cleanup',
        slot: 'slot1',
        ttl: 60,
        fn: cleanupPendingFiles,
    },
    SYNCRONIZATION_DB_S3: {
        name: 'sync',
        slot: 'slot2',
        ttl: 300,
        fn: syncronizationDBToS3,
    },
    PG_BACKUP: {
        name: 'pg_basebackup',
        slot: 'slot3',
        ttl: 3600,
        fn: postgresBackupToS3,
    },
    ABORTUPLOADS: {
        name: 'abort',
        slot: 'slot4',
        ttl: 1000,
        fn: cleanupIncompleteMultipartUploads,
    }
}

async function jobWraper(job) {
    const start = Date.now();
    let stat = {};
    try {
        stat = await cronLock(job);
    } catch (err) {
        logger.error(`Cron job: ${job.name} упал`, { err });
    } finally {
        const duration = Date.now() - start;
        logger.info(`Cron job: ${job.name} statistics`, { type: 'jobStatistics', jobName: job.name, durationMs: duration, stat })
    }
}

async function start() {
    await redis.connect();
    cron.schedule(
        process.env.CLEANUPPENDING_FREQUENCY,
        () => jobWraper(cronJobs.CLEANUPPENDING),
        { timezone: 'Europe/Moscow' }
    );// раз в 10мин

    cron.schedule(
        process.env.SYNCRONIZATION_DB_S3_FREQUENCY, 
        () => jobWraper(cronJobs.SYNCRONIZATION_DB_S3), 
        { timezone: 'Europe/Moscow' }
    );//каждый день в 2 утра по мск

    cron.schedule(
        process.env.PG_BACKUP_FREQUENCY,
        () => jobWraper(cronJobs.PG_BACKUP), 
        { timezone: 'Europe/Moscow' }
    );//каждый день в 4 утра по мск

    cron.schedule(
        process.env.ABORTUPLOADS_FREQUENCY,
        () => jobWraper(cronJobs.ABORTUPLOADS),
        { timezone: 'Europe/Moscow' }
    ); //раз в час

    logger.info('CronjobsWorker started');
}

start().catch((err) => {
    logger.error('Не удалось запустить CronjobsWorker', { err });
    process.exit(1);
});