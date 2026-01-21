# Crontab Manager

可视化管理 Linux Crontab 定时任务的 Web 工具，支持多机器管理。

## 功能特性

### Cron Jobs 管理
- **可视化编辑** - 查看、编辑、启用/禁用定时任务
- **任务分组** - 支持任务分组管理和拖拽排序
- **批量操作** - 启用/禁用整个任务组
- **原始编辑** - 直接编辑 crontab 原始文件

### At Jobs 管理
- **一次性任务** - 创建指定时间执行的一次性任务
- **模板功能** - 保存常用命令为模板，快速创建任务
- **任务历史** - 查看已执行、待执行、已取消的任务

### 多机器管理
- **本地管理** - 管理本机 crontab
- **SSH 远程** - 通过 SSH 管理远程服务器
- **多用户** - 支持管理不同 Linux 用户的 crontab

### 日志与审计
- **Cron Logs** - 查看系统 cron 执行日志
- **Audit Logs** - 记录所有修改操作，支持过滤
- **版本历史** - 查看历史版本，支持 Diff 对比和回滚

### 其他
- **多用户认证** - Flask-Login 登录认证
- **自动备份** - 修改前自动备份，保留最近 20 个版本
- **响应式设计** - 适配桌面和移动设备

## 快速开始

### 安装依赖

```bash
pip install flask flask-login paramiko
```

### 启动服务

```bash
# 方式一：直接运行
python app.py

# 方式二：使用脚本
./script/start.sh
```

访问 http://localhost:5100

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
    "secret_key": "your-secret-key-change-in-production",
    "users": {
        "admin": "your_password"
    },
    "machines": {
        "local": {
            "name": "本机",
            "type": "local",
            "linux_users": ["root"]
        },
        "server-1": {
            "name": "生产服务器",
            "type": "ssh",
            "host": "example.com",
            "port": 22,
            "ssh_user": "root",
            "ssh_key": "/root/.ssh/id_rsa",
            "linux_users": ["root", "www"]
        }
    },
    "default_machine": "local"
}
```

### 环境变量

可通过环境变量覆盖配置：

```bash
export SECRET_KEY='your-secret-key'
export CRONTAB_USERS='{"admin": "password"}'
```

### 目录结构

```
crontab-manager/
├── app.py              # 主程序
├── config.json         # 配置文件
├── templates/
│   ├── index.html      # 主页面（含 CSS 和 JS）
│   └── login.html      # 登录页面
├── script/
│   ├── start.sh        # 启动脚本
│   └── stop.sh         # 停止脚本
├── log/                # 日志目录
│   ├── app.log         # 应用日志
│   └── audit.log       # 操作审计日志
└── backups/            # Crontab 备份目录
```

## 界面预览

| Tab | 功能 |
|-----|------|
| Cron Jobs | 可视化任务列表，支持分组、拖拽、编辑 |
| Cron History | 历史版本浏览，Diff 对比，一键回滚 |
| Cron Logs | 系统 cron 执行日志查看 |
| At Jobs | 一次性定时任务管理，支持模板 |
| Audit Logs | 操作审计日志，支持用户/操作过滤 |

## 技术栈

- **后端**: Flask + Flask-Login + Paramiko (SSH)
- **前端**: Vanilla JavaScript + CSS Variables
- **数据**: 直接操作系统 Crontab 文件

## 版本历史

- **v0.8.x** - Tab 命名优化，At Jobs 模板功能，界面样式优化
- **v0.7.x** - At Jobs 一次性任务管理功能
- **v0.5.0** - 代码结构优化，统一分页逻辑
- **v0.4.x** - UI 样式优化，合并主机用户选择器
- **v0.3.x** - 多机器管理，SSH 远程支持
- **v0.2.x** - Cron Logs、Audit Logs 功能
- **v0.1.x** - 基础任务管理功能

## License

MIT
