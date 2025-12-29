#!/bin/bash
# stop.sh - 停止Crontab Web服务
# 通过端口5000查找并终止进程

PORT=5000

# 通过端口查找进程
PID=$(lsof -ti :$PORT 2>/dev/null)

if [ -n "$PID" ]; then
    echo "停止进程 PID: $PID"
    kill $PID 2>/dev/null
    sleep 1
    # 如果还在运行，强制终止
    if lsof -ti :$PORT > /dev/null 2>&1; then
        kill -9 $PID 2>/dev/null
    fi
    echo "已停止"
else
    echo "服务未运行"
fi
