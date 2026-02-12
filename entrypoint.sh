#!/bin/bash
# entrypoint.sh - 容器启动入口脚本
# 功能：启动 cron/atd 守护进程，然后启动 gunicorn
set -e

# 启动 cron 守护进程
echo "[entrypoint] 启动 cron 守护进程..."
service cron start

# 创建必要目录
mkdir -p /app/log /app/config /app/backups

echo "[entrypoint] 启动 gunicorn..."
exec gunicorn \
    --bind "0.0.0.0:${PORT:-5100}" \
    --workers "${WORKERS:-2}" \
    --threads "${THREADS:-2}" \
    --reload \
    app:app
