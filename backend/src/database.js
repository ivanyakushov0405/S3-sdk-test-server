const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client'); 

const { createClient } = require('redis');

const { logger } = require('./logger');

// Инициализация пула и адаптера для Prisma 7
const databaseUrl = `postgresql://${process.env.PG_USER}:${process.env.PG_PASSWORD}@${process.env.PG_HOST}:${process.env.PG_PORT}/${process.env.PG_NAME}?schema=public&connection_limit=5`;

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Инициализация redis
const redis = createClient({
  url: process.env.REDIS_URL
});
redis.on('error', err => {
  logger.error('Redis Client Error', { err })
  process.exit(1);
});

redis.on('connect', () => logger.info('Redis connected'));


module.exports = { prisma, redis };
