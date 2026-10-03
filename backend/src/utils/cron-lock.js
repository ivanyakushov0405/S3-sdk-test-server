const { randomUUID } = require('crypto');
const { redis } = require('../database');
const { logger } = require('../logger');

const RELEASE_LOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

async function cronLock(job) {
    const lockToken = randomUUID();
    const key = `cron-lock:${job.slot}`;
    const acquired = await redis.set(key, lockToken, { EX: job.ttl, NX: true });
    if (!acquired) {
        logger.warn(`cron-lock:${job.name} уже занят, пропускаем ${job.fn.name}`, { type: 'job', job: 'cron-lock', skippedJob: job.name });
        const isSkipped = true;
        return isSkipped;
    }
    try {
        return await job.fn(job.name);
    } finally {
        await redis.eval(RELEASE_LOCK_SCRIPT, { keys: [key], arguments: [lockToken] });
        // не атомарно
        // const currentToken = await redis.get(`cron-lock:${jobName}`);
        // if (currentToken === lockToken) {
        //     await redis.del(`cron-lock:${jobName}`);
        // }
    }
}

module.exports = cronLock