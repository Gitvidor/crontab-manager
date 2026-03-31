# routes/auth.py - 认证与用户管理路由
# 功能: 登录/登出、SSO 预留、用户 CRUD（仅 admin）

from flask import Blueprint, render_template, request, redirect, url_for, abort
from flask_login import login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash

from core import config
from core.auth import (
    build_user, verify_password, require_role, count_admin_users
)
from core.crontab import log_action
from core.response import api_success, api_error

bp = Blueprint('auth', __name__)


# ===== 认证路由 =====


@bp.route('/login', methods=['GET', 'POST'])
def login():
    """登录页面"""
    if not config.AUTH_ENABLED:
        return redirect('/')
    if current_user.is_authenticated:
        return redirect('/')
    error = None
    if request.method == 'POST':
        username = request.form.get('username', '')
        password = request.form.get('password', '')
        if username in config.USERS and verify_password(config.USERS[username]['password'], password):
            login_user(build_user(username))
            log_action('login')
            next_page = request.args.get('next')
            return redirect(next_page or '/')
        error = 'Invalid username or password'
    return render_template('login.html', error=error)


@bp.route('/logout')
@login_required
def logout():
    """登出"""
    if not config.AUTH_ENABLED:
        return redirect('/')
    log_action('logout')
    logout_user()
    return redirect('/login')


# ===== SSO 预留接口 =====


@bp.route('/auth/login')
def sso_login():
    """SSO 登录入口（预留）"""
    if not config.AUTH_CONFIG.get('sso', {}).get('enabled'):
        return redirect('/login')
    return redirect('/login')


@bp.route('/auth/callback')
def sso_callback():
    """SSO 回调（预留）"""
    if not config.AUTH_CONFIG.get('sso', {}).get('enabled'):
        abort(404)
    return redirect('/login')


# ===== 用户管理 API =====


@bp.route('/api/users')
@require_role('admin')
def get_users():
    """获取所有用户列表"""
    users = []
    for username, user_config in config.USERS.items():
        users.append({
            'username': username,
            'role': user_config.get('role', 'viewer'),
            'machines': user_config.get('machines', ['*'])
        })
    return api_success(users=users)


@bp.route('/api/users', methods=['POST'])
@require_role('admin')
def create_user():
    """创建新用户"""
    data = request.json
    username = data.get('username', '').strip()
    password = data.get('password', '')
    role = data.get('role', 'viewer')
    machines = data.get('machines', ['*'])

    if not username or not password:
        return api_error('Username and password required')
    if username in config.USERS:
        return api_error('User already exists')
    if role not in ('viewer', 'editor', 'admin'):
        return api_error('Invalid role')

    config.USERS[username] = {
        'password': generate_password_hash(password),
        'role': role,
        'machines': machines
    }
    config.save_config()
    log_action('create_user', {'username': username, 'role': role})
    return api_success()


@bp.route('/api/users/<username>', methods=['PUT'])
@require_role('admin')
def update_user(username):
    """更新用户"""
    if username not in config.USERS:
        return api_error('User not found', 404)

    data = request.json
    user_config = config.USERS[username]
    next_role = data.get('role', user_config.get('role'))

    if data.get('password'):
        user_config['password'] = generate_password_hash(data['password'])

    if 'role' in data:
        if data['role'] not in ('viewer', 'editor', 'admin'):
            return api_error('Invalid role')
        if user_config.get('role') == 'admin' and data['role'] != 'admin' and count_admin_users() <= 1:
            return api_error('Cannot demote last admin')
        if not config.AUTH_ENABLED and username == config.AUTH_BYPASS_USERNAME and data['role'] != 'admin':
            return api_error('Cannot demote auth bypass user while auth is disabled')
        user_config['role'] = data['role']

    if 'machines' in data:
        user_config['machines'] = data['machines']

    config.save_config()
    log_action('update_user', {'username': username, 'role': next_role})
    return api_success()


@bp.route('/api/users/<username>', methods=['DELETE'])
@require_role('admin')
def delete_user(username):
    """删除用户"""
    if username not in config.USERS:
        return api_error('User not found', 404)
    if username == current_user.id:
        return api_error('Cannot delete yourself')
    if config.USERS[username].get('role') == 'admin' and count_admin_users() <= 1:
        return api_error('Cannot delete last admin')

    del config.USERS[username]
    config.save_config()
    log_action('delete_user', {'username': username})
    return api_success()


@bp.route('/api/current_user')
@login_required
def get_current_user():
    """获取当前用户信息"""
    return api_success(
        username=current_user.id,
        role=current_user.role,
        machines=current_user.machines,
        can_edit=current_user.can_edit(),
        can_admin=current_user.can_admin()
    )
