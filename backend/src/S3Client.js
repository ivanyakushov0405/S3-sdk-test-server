const { randomUUID } = require('crypto');

const { S3Client } = require('@aws-sdk/client-s3');
const { 
    HeadObjectCommand,
    PutObjectCommand, 
    GetObjectCommand, 
    DeleteObjectCommand, 
    ListObjectsV2Command,
    ListMultipartUploadsCommand, 
    AbortMultipartUploadCommand 
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Upload } = require('@aws-sdk/lib-storage');

const { formatsForS3 } = require('./logger');

const s3Client = new S3Client({
    region: process.env.S3_REGION,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
    logger: formatsForS3,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    maxAttempts: 5, // вместо дефолтных 3
    retryMode: 'adaptive',
});

const bucketName = process.env.S3_BUCKET;

function getStorageKey(directory, name) {
    const ext = name.split('.').pop();
    const storageKey = `${directory}/${Date.now()}-${randomUUID()}.${ext}`;
    return storageKey;
};
async function getS3FileInfo(key) {
    const command = new HeadObjectCommand({ Bucket: bucketName, Key: key });
    try {
        const response = await s3Client.send(command);
        return {
            exist: true,
            size: response.ContentLength,
            mimetype: response.ContentType,
        };
    } catch (err) {
        if (err.name === 'NotFound') {
            return {
                exist: false,
            };
        } else {
            throw new Error(`getS3FileInfo error: ${err.message}`);
        }
    }  
}

async function uploadS3File(buffer, key, mimetype) {
    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: mimetype,
    });

    await s3Client.send(command);
};

function uploadMultipartS3File(key, fileStream, mimeType, queueSize = 1, partSizeMB = 5) {
    if (partSizeMB < 5) throw new Error('uploadMultipartS3File error, partSize can not be less then 5MB');
    const upload = new Upload({
        client: s3Client,
        params: {
            Bucket: bucketName,
            Key: key,
            Body: fileStream,
            ContentType: mimeType, //для .dump application/octet-stream
        },
        queueSize, // Количество параллельных частей
        partSize: partSizeMB * 1024 * 1024,// Размер части (минимум 5MB для S3)
    });
    return upload;
};
async function abortIncompleteMultipartUploads(prefix = '', olderThanMs = 24 * 60 * 60 * 1000) {
    const response = await s3Client.send(new ListMultipartUploadsCommand({
        Bucket: bucketName,
        Prefix: prefix,
    }));
    let aborted = 0;
    const now = Date.now()
    for (const upload of response.Uploads || []) {
        const initiatedAt = new Date(upload.Initiated).getTime();
        const ageMs = now - initiatedAt;

        if (ageMs < olderThanMs) {
            continue; // слишком молодой upload, возможно активно грузится прямо сейчас - пропускаем!
        }
        await s3Client.send(new AbortMultipartUploadCommand({
            Bucket: bucketName,
            Key: upload.Key,
            UploadId: upload.UploadId,
        }));
        aborted++;
    }
    return aborted;
}


async function deleteS3File(key) {
    const command = new DeleteObjectCommand({ Bucket: bucketName, Key: key });
    await s3Client.send(command);
};
async function getS3UploadUrl(key, mimetype) {
    const command = new PutObjectCommand({ 
        Bucket: bucketName, 
        Key: key, 
        ContentType: mimetype 
    });
    const url = await getSignedUrl(s3Client, command, { expiresIn: 300 });
    return url;
};
async function getS3DownloadUrl(key) {
    const command = new GetObjectCommand({ 
        Bucket: bucketName, 
        Key: key,
    });
    const url = await getSignedUrl(s3Client, command, { expiresIn: 300 });
    return url;
}

/**
 * Считает объекты в S3 с заданным префиксом.
 * @param {string} prefix - префикс для фильтрации (например, 'uploads/')
 * @param {Date|null} sinceDate - если задан, s3Keys будет содержать только объекты новее этой даты
 * @param {Date|null} untilDate - если задан, s3Keys будет содержать только объекты до этой даты
 * @returns {{s3Keys: string[], s3TotalCount: number}} s3Keys — отфильтрованные по дате ключи (пусто, если sinceDate или untilDate не задан); s3TotalCount — общее число объектов по префиксу
 */
async function countS3Objects(prefix = '', sinceDate = null, untilDate = null) {
    let s3TotalCount = 0;
    const s3Keys = [];
    let continuationToken = undefined;

    do {
        const command = new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: prefix,
            ContinuationToken: continuationToken,
        });

        const response = await s3Client.send(command);

        for (const obj of response.Contents || []) {
            const inRange =
                (!sinceDate || obj.LastModified >= sinceDate) &&
                (!untilDate || obj.LastModified <= untilDate);

            if (inRange) {
                s3Keys.push(obj.Key);
            }
        }

        s3TotalCount += response.Contents?.length || 0;
        continuationToken = response.NextContinuationToken;

    } while (continuationToken);

    return { s3Keys, s3TotalCount, filteredCount: s3Keys.length };
}

module.exports = { getS3FileInfo, getStorageKey, uploadS3File, uploadMultipartS3File, deleteS3File, getS3UploadUrl, getS3DownloadUrl, countS3Objects, abortIncompleteMultipartUploads };