#!/bin/bash
# start.sh - 启动Crontab Web服务
# 先停止旧进程，再后台启动新进程

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="${APP_DIR}/log"
mkdir -p "$LOG_DIR"
LOG_FILE="${LOG_DIR}/app.log"
PORT=5100

# 先停止旧进程
"${SCRIPT_DIR}/stop.sh"

# 启动服务
echo "启动 Crontab Web 服务..."
cd "$APP_DIR"
nohup python app.py > "$LOG_FILE" 2>&1 &

sleep 2

# 通过端口检查是否启动成功
PID=$(lsof -ti :$PORT 2>/dev/null)
if [ -n "$PID" ]; then
    echo "启动成功 PID: $PID"
    echo "访问地址: http://localhost:$PORT"
    echo "日志文件: $LOG_FILE"
else
    echo "启动失败，查看日志: $LOG_FILE"
    tail -20 "$LOG_FILE"
    exit 1
fi
