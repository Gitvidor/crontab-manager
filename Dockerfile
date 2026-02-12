# Dockerfile - Crontab Manager Web 应用
# 基于 Python 3.11，使用 gunicorn 生产部署

FROM python:3.11-slim

# 安装系统依赖（cron、at 命令支持）
RUN apt-get update && apt-get install -y --no-install-recommends \
    cron \
    at \
    curl \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 安装 Python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

# 复制启动脚本
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# 复制应用代码
COPY . .

# 创建必要目录
RUN mkdir -p /app/log /app/config /app/backups

# 暴露端口
EXPOSE 5100

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:5100/ || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
