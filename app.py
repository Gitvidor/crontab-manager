# app.py - Crontab Web 管理工具（入口文件）
# 功能: 创建 Flask 应用、注册蓝图、启动后台线程
# 架构: core/ 核心逻辑 + routes/ 路由蓝图
# 启动: python app.py, 访问 http://localhost:5100

import os
from flask import Flask

app = Flask(__name__)

# 初始化配置
from core.config import init_app
init_app(app)

# 初始化认证
from core.auth import init_auth
init_auth(app)

# 注册路由蓝图
from routes import register_blueprints
register_blueprints(app)

# 启动后台监控线程
from core.watcher import start_watchers
start_watchers()

if __name__ == '__main__':
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    app.run(host='0.0.0.0', port=5100, debug=debug)
