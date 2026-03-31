# core/config.py - 配置加载与全局状态
# 功能: 加载 config.json、环境变量覆盖、规范化用户配置
# 导出: USERS, MACHINES, AUTH_ENABLED, AUTH_CONFIG 等全局状态
# 用法: from core import config; config.USERS

import os
import json

# ===== 路径常量 =====
BASE_DIR = os.path.dirname(os.path.dirname(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, 'config', 'config.json')
TEMPLATES_FILE = os.path.join(BASE_DIR, 'config', 'templates.json')
AT_HISTORY_FILE = os.path.join(BASE_DIR, 'log', 'at_history.json')
BACKUP_DIR = os.path.join(BASE_DIR, 'backups')
LOG_DIR = os.path.join(BASE_DIR, 'log')
AUDIT_LOG = os.path.join(LOG_DIR, 'audit.log')
AT_DONE_PREFIX = '/tmp/.at_done_'
AT_HISTORY_RETENTION_DAYS = 90
DEFAULT_LINUX_USER = 'root'

# ===== 加载配置文件 =====
if os.path.exists(CONFIG_FILE):
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        config = json.load(f)
else:
    config = {
        "secret_key": "change-me",
        "users": {"admin": "admin123"},
        "auth": {"enabled": True, "bypass_username": "admin", "sso": {"enabled": False}}
    }


def parse_bool(value):
    """解析布尔配置，非法值直接报错"""
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in ('1', 'true', 'yes', 'on'):
        return True
    if text in ('0', 'false', 'no', 'off'):
        return False
    raise ValueError(f'Invalid boolean value: {value}')


# ===== 规范化用户配置 =====
_raw_users = json.loads(os.environ.get('CRONTAB_USERS', 'null')) or config.get('users', {})
USERS = {}
for _username, _user_config in _raw_users.items():
    if isinstance(_user_config, str):
        USERS[_username] = {'password': _user_config, 'role': 'admin', 'machines': ['*']}
    else:
        USERS[_username] = {
            'password': _user_config.get('password', ''),
            'role': _user_config.get('role', 'viewer'),
            'machines': _user_config.get('machines', ['*'])
        }

# ===== 认证配置 =====
_raw_auth_config = config.get('auth') or {}
AUTH_CONFIG = {
    'type': _raw_auth_config.get('type', 'local'),
    'enabled': _raw_auth_config.get('enabled', True),
    'bypass_username': _raw_auth_config.get('bypass_username'),
    'sso': _raw_auth_config.get('sso', {'enabled': False})
}
if 'CRONTAB_AUTH_ENABLED' in os.environ:
    AUTH_CONFIG['enabled'] = os.environ['CRONTAB_AUTH_ENABLED']
if os.environ.get('CRONTAB_AUTH_BYPASS_USERNAME'):
    AUTH_CONFIG['bypass_username'] = os.environ['CRONTAB_AUTH_BYPASS_USERNAME']
AUTH_ENABLED = parse_bool(AUTH_CONFIG.get('enabled', True))


def resolve_auth_bypass_username():
    """解析免登录模式下使用的用户，优先显式配置，否则回退到首个 admin"""
    configured_username = AUTH_CONFIG.get('bypass_username')
    if configured_username:
        if configured_username not in USERS:
            raise ValueError(f'Auth bypass user not found: {configured_username}')
        return configured_username
    for username, user_config in USERS.items():
        if user_config.get('role') == 'admin':
            return username
    if USERS:
        return next(iter(USERS))
    raise ValueError('Authentication is disabled but no users are configured')


AUTH_BYPASS_USERNAME = resolve_auth_bypass_username() if not AUTH_ENABLED else None

# ===== 机器配置 =====
MACHINES = config.get('machines', {
    'local': {'name': '本机', 'type': 'local', 'linux_users': ['root']}
})
DEFAULT_MACHINE = config.get('default_machine', 'local')

# ===== 确保目录存在 =====
os.makedirs(BACKUP_DIR, exist_ok=True)
os.makedirs(LOG_DIR, exist_ok=True)


def save_config():
    """保存配置文件（用户变更后调用）"""
    config['users'] = USERS
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=4)


def init_app(app):
    """初始化 Flask app 配置"""
    app.secret_key = os.environ.get('SECRET_KEY', config.get('secret_key', 'change-me'))
