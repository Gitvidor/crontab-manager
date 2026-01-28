# Dockerfile - Crontab Manager Web 应用
# 基于 Python 3.11，使用 gunicorn 生产部署

FROM python:3.11-slim

# 安装系统依赖（cron、at 命令支持）
RUN apt-get update && apt-get install -y --no-install-recommends \
    cron \
    at \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 安装 Python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

# 复制应用代码
COPY . .

# 创建必要目录
RUN mkdir -p /app/log /app/config

# 暴露端口
EXPOSE 5100

# 启动命令
CMD ["gunicorn", "--bind", "0.0.0.0:5100", "--workers", "2", "--threads", "2", "app:app"]
