#!/bin/sh
set -e

echo "Применяю миграции Prisma..."
npx prisma migrate deploy

echo "Запускаю приложение..."
exec pm2-runtime ecosystem.config.js