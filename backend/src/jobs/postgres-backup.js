const { spawn } = require('child_process');
const iconv = require('iconv-lite');
const { uploadMultipartS3File } = require('../S3Client')
const { logger } = require('../logger');



async function postgresBackupToS3(jobName) {
    const postgresBackupLogger = logger.child({ type: 'job', job: jobName });
    postgresBackupLogger.info('Запуск...');
    let mb = 0, stderrLines = 0, uploadTimeMs = 0;
    // запускаем pg_basebackup через chil_process 
    // примечание pg_basebackup должен быть в PATH
    // Linux: rpm -ql postgresql18-server
    //        echo 'export PATH=$PATH:/usr/pgsql-18/bin' >> ~/.bashrc
    //        source ~/.bashrc
    //        which pg_basebackup
    //tar -tzf test-backup.tar.gz | head -20
    //tar -xzf test-backup.tar.gz -C /tmp/pg_restore_test это восстановление
    const pgBackup = spawn('pg_basebackup', [
        '-D', '-',              // писать в stdout
        '-F', 't',              // tar-формат (обязателен для stdout)
        '-X', 'none',         // fetch - скачать WAL-логи после завершения копирования данных; none нескачивать; stream пораллельно стримить(нельзя делать вместе с "-D -"")
        '-z',                   // gzip-сжатие
        '-h', process.env.PG_HOST,
        '-p', process.env.PG_PORT,
        '-U', process.env.PG_USER,
    ], {
        env: { ...process.env, PGPASSWORD: process.env.PG_PASSWORD },
    });
    
    // читаем stderr
    let errorMessage = '';
    pgBackup.stderr.on('data', (data) => {
        const text = iconv.decode(data, 'windows-1251').trim();
        errorMessage += text + ' ';
        stderrLines++;
        postgresBackupLogger.warn(`pg_basebackup stderr ${text}`);
    });

    //создаем multipart
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const key = `backups/postgres/cluster-${process.env.PG_NAME}-${timestamp}.tar.gz`;
    const start = Date.now();
    const upload = uploadMultipartS3File(key, pgBackup.stdout, 'application/octet-stream', 4, 10);

    // задаем промис на pgBackup
    const processExit = new Promise((resolve, reject) => {
        pgBackup.on('error', (err) => {
            pgBackup.stdout.destroy();
            reject(new Error(`Не удалось запустить pg_basebackup: ${err.message}`));
        });
        pgBackup.on('close', (code) => {
            if (code !== 0) {
                postgresBackupLogger.error(`pg_basebackup завершился с кодом ${code}`, { code, stderr: errorMessage });
                pgBackup.stdout.destroy(new Error(`pg_basebackup failed with code ${code}`));
                reject(new Error(`pg_basebackup завершился с кодом ${code}. Ошибка: ${errorMessage}`));
            } else {
                if (errorMessage) {
                    postgresBackupLogger.debug('pg_basebackup stderr output (не ошибка)', { stderr: errorMessage });
                }
                resolve();
            }
        });
    });

    // логирум прогресс загрузки
    let lastLogTime = 0;
    upload.on('httpUploadProgress', (progress) => {
        const now = Date.now();
        if (now - lastLogTime > 10_000) { // не чаще раза в 10 секунд
            lastLogTime = now;
            mb = (progress.loaded / 1024 / 1024).toFixed(2);
            const percentStr = progress.total ? ` (${Math.floor((progress.loaded / progress.total) * 100)}%)` : '';
            postgresBackupLogger.info(`Загружено: ${mb} МБ${percentStr}`, { loadedMB: mb });
        }
    });

    try {
        //дожидаемся promise и от upload и от processExit
        await Promise.all([upload.done(), processExit]);
        uploadTimeMs = Date.now() - start;
        postgresBackupLogger.info(`Бэкап загружен: ${key}`, { key });
    } catch (err) {
        postgresBackupLogger.error('Бэкап не завершён (ошибка загрузки или процесса)', { err });
        try {
            await upload.abort(); //корректно отменяет multipart-сессию в S3 если один из промизов заrejectил
        } catch (abortErr) {
            postgresBackupLogger.error('Не удалось отменить upload:', { abortErr });
        }
        throw err; //прокидываем дальше чтобы cron обработал ошибку
    }
    return { totalUploaded: mb, stderrLines, uploadTimeMs }
}

module.exports = postgresBackupToS3;