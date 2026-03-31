# core/auth.py - 用户认证与权限控制
# 功能: User 模型、login_manager、权限装饰器
# 导出: User, build_user, require_role, require_machine_access, login_manager

from flask import request
from flask_login import LoginManager, UserMixin, login_required, current_user
from werkzeug.security import check_password_hash
from functools import wraps
from core import config
from core.response import api_error

login_manager = LoginManager()
login_manager.login_view = 'auth.login'


class User(UserMixin):
    """用户类（支持角色和机器权限）"""
    def __init__(self, username, role='viewer', machines=None, auth_type='local'):
        self.id = username
        self.role = role
        self.machines = machines or ['*']
        self.auth_type = auth_type

    def can_view(self):
        return True

    def can_edit(self):
        return self.role in ('editor', 'admin')

    def can_admin(self):
        return self.role == 'admin'

    def can_access_machine(self, machine_id):
        return '*' in self.machines or machine_id in self.machines


def build_user(username):
    """按配置构造用户对象"""
    if username not in config.USERS:
        return None
    user_config = config.USERS[username]
    return User(
        username,
        role=user_config.get('role', 'viewer'),
        machines=user_config.get('machines', ['*'])
    )


def count_admin_users():
    """统计当前管理员数量"""
    return sum(1 for uc in config.USERS.values() if uc.get('role') == 'admin')


def verify_password(stored, provided):
    """验证密码（兼容旧版纯文本和新版哈希）"""
    if stored.startswith('pbkdf2:') or stored.startswith('scrypt:'):
        return check_password_hash(stored, provided)
    return stored == provided


# ===== 权限装饰器 =====

def require_role(*roles):
    """要求指定角色的装饰器"""
    def decorator(f):
        @wraps(f)
        @login_required
        def decorated(*args, **kwargs):
            if current_user.role not in roles:
                return api_error('Permission denied', 403)
            return f(*args, **kwargs)
        return decorated
    return decorator


def require_machine_access(f):
    """要求机器访问权限的装饰器"""
    @wraps(f)
    @login_required
    def decorated(*args, **kwargs):
        machine_id = kwargs.get('machine_id')
        if not machine_id and request.json:
            machine_id = request.json.get('machine_id', 'local')
        if not machine_id:
            machine_id = request.args.get('machine_id', 'local')
        if not machine_id:
            machine_id = 'local'
        if not current_user.can_access_machine(machine_id):
            return api_error('No access to this machine', 403)
        return f(*args, **kwargs)
    return decorated


# ===== Flask-Login 回调 =====

@login_manager.user_loader
def load_user(user_id):
    return build_user(user_id)


@login_manager.request_loader
def load_user_from_request(_request):
    """免登录模式下，为每个请求注入配置用户"""
    if config.AUTH_ENABLED:
        return None
    return build_user(config.AUTH_BYPASS_USERNAME)


@login_manager.unauthorized_handler
def handle_unauthorized():
    from flask import redirect, url_for
    if not config.AUTH_ENABLED:
        return redirect('/')
    return redirect(url_for('auth.login', next=request.url))


def init_auth(app):
    """初始化认证系统"""
    login_manager.init_app(app)
