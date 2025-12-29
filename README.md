# Crontab Manager

可视化管理 Linux Crontab 定时任务的 Web 工具。

## 功能特性

- **可视化管理** - 查看、编辑、启用/禁用定时任务
- **任务分组** - 支持任务分组管理和拖拽排序
- **多用户认证** - Flask-Login 登录认证
- **操作日志** - 记录所有修改操作，支持审计
- **自动备份** - 修改前自动备份，保留最近 20 个

## 快速开始

### 安装依赖

```bash
pip install flask flask-login
```

### 启动服务

```bash
# 方式一：直接运行
python app.py

# 方式二：使用脚本
./script/start.sh
```

访问 http://localhost:5000

### 默认账号

- 用户名：`admin`
- 密码：`admin123`

## 配置

### 配置文件

复制示例配置文件并修改：

```bash
cp config.example.json config.json
```

编辑 `config.json`：

```json
{
    "secret_key": "your-secret-key",
    "users": {
        "admin": "your_password"
    }
}
```

也可通过环境变量覆盖：

```bash
export SECRET_KEY='your-secret-key'
export CRONTAB_USERS='{"admin": "password"}'
```

### 目录结构

```
crontab-manager/
├── app.py              # 主程序
├── templates/
│   ├── index.html      # 主页面
│   └── login.html      # 登录页面
├── script/
│   ├── start.sh        # 启动脚本
│   └── stop.sh         # 停止脚本
├── log/                # 日志目录
│   ├── app.log         # 应用日志
│   └── audit.log       # 操作审计日志
└── backups/            # Crontab 备份目录
```

## 技术栈

- **后端**: Flask + Flask-Login
- **前端**: Vanilla JavaScript + CSS Variables
- **数据**: 直接操作系统 Crontab 文件

## License

MIT
