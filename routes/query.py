# routes/query.py - 通用查询路由
# 功能: 机器列表、Cron 日志、审计日志、备份管理

import os
import json
from flask import Blueprint, render_template, request
from flask_login import login_required, current_user

from core import config
from core.auth import require_role, require_machine_access
from core.crontab import get_machine_executor, get_crontab_raw, save_crontab, log_action
from core.response import api_success, api_error

bp = Blueprint('query', __name__)


@bp.route('/')
@login_required
def index():
    return render_template('index.html',
                           username=current_user.id,
                           user_role=current_user.role,
                           user_machines=current_user.machines)


# ===== 机器管理 =====


@bp.route('/api/machines')
@login_required
def get_machines():
    """获取当前用户可访问的机器列表"""
    machines = []
    for mid, mconfig in config.MACHINES.items():
        if not current_user.can_access_machine(mid):
            continue
        machines.append({
            'id': mid,
            'name': mconfig.get('name', mid),
            'type': mconfig.get('type', 'local'),
            'linux_users': mconfig.get('linux_users', ['']),
            'host': mconfig.get('host', 'localhost')
        })
    default = config.DEFAULT_MACHINE if current_user.can_access_machine(config.DEFAULT_MACHINE) else (machines[0]['id'] if machines else 'local')
    return api_success(machines=machines, default=default)


@bp.route('/api/machine/<machine_id>/status')
@login_required
def get_machine_status(machine_id):
    """测试机器连接状态"""
    if machine_id not in config.MACHINES:
        return api_error('Machine not found', 404)
    try:
        executor = get_machine_executor(machine_id)
        ok, msg = executor.test_connection()
        return api_success(message=msg, machine_id=machine_id) if ok else api_error(msg)
    except Exception as e:
        return api_error(str(e))


# ===== 日志 =====


@bp.route('/api/cron_logs')
@bp.route('/api/cron_logs/<machine_id>')
@login_required
def get_cron_logs(machine_id='local'):
    """获取系统 cron 执行日志"""
    cron_log_paths = [
        '/var/log/cron',
        '/var/log/cron.log',
        '/var/log/syslog',
    ]

    try:
        executor = get_machine_executor(machine_id)
        machine_name = config.MACHINES.get(machine_id, {}).get('name', machine_id)

        log_file = None
        for path in cron_log_paths:
            returncode, stdout, stderr = executor.run_command(f'test -f {path} && echo exists')
            if 'exists' in stdout:
                log_file = path
                break

        if not log_file:
            return api_success(logs=[], source=f'{machine_name}: none', error='No cron log file found')

        returncode, stdout, stderr = executor.run_command(f'tail -n 500 {log_file}')
        if returncode != 0:
            return api_success(logs=[], source=f'{machine_name}: {log_file}', error=stderr)

        lines = stdout.strip().split('\n')
        if 'syslog' in log_file:
            lines = [l for l in lines if 'CRON' in l or 'cron' in l.lower()]

        logs = list(reversed(lines[-200:])) if lines and lines[0] else []
        return api_success(logs=logs, source=f'{machine_name}: {log_file}', error=None)
    except Exception as e:
        return api_success(logs=[], source=machine_id, error=str(e))


@bp.route('/api/audit_logs')
@bp.route('/api/audit_logs/<machine_id>')
@login_required
def get_audit_logs(machine_id=None):
    """获取审计日志"""
    logs = []
    if os.path.exists(config.AUDIT_LOG):
        with open(config.AUDIT_LOG, "r", encoding="utf-8") as f:
            lines = f.readlines()[-500:]
            for line in reversed(lines):
                try:
                    log = json.loads(line.strip())
                    if machine_id:
                        log_machine = log.get('details', {}).get('machine', 'local') if log.get('details') else 'local'
                        if log_machine != machine_id:
                            continue
                    logs.append(log)
                    if len(logs) >= 500:
                        break
                except json.JSONDecodeError:
                    continue
    return api_success(path=os.path.abspath(config.AUDIT_LOG), logs=logs)


# ===== 备份管理 =====


@bp.route('/api/backups')
@bp.route('/api/backups/<machine_id>/<linux_user>')
@login_required
def get_backups(machine_id='local', linux_user=''):
    """获取所有备份列表"""
    if not linux_user or linux_user == '_default_':
        linux_user = config.DEFAULT_LINUX_USER
    backup_subdir = os.path.join(config.BACKUP_DIR, machine_id, linux_user)

    if not os.path.exists(backup_subdir):
        return api_success(backups=[])

    backups = sorted(
        [f for f in os.listdir(backup_subdir) if f.endswith('.bak')],
        reverse=True
    )
    result = []
    for bak in backups:
        name = bak.replace('crontab_', '').replace('.bak', '')
        parts = name.split('_')
        if len(parts) >= 3:
            timestamp = f'{parts[0]}_{parts[1]}'
            username = '_'.join(parts[2:])
        else:
            timestamp = name
            username = ''
        result.append({'filename': bak, 'timestamp': timestamp, 'username': username})
    return api_success(backups=result)


@bp.route('/api/backup/<filename>')
@bp.route('/api/backup/<machine_id>/<linux_user>/<filename>')
@login_required
def get_backup_content(filename, machine_id='local', linux_user=''):
    """获取指定备份的内容"""
    if not linux_user or linux_user == '_default_':
        linux_user = config.DEFAULT_LINUX_USER
    if not filename.endswith('.bak') or '/' in filename or '\\' in filename:
        return api_error('Invalid filename')

    filepath = os.path.join(config.BACKUP_DIR, machine_id, linux_user, filename)
    if os.path.exists(filepath):
        with open(filepath, 'r') as f:
            return api_success(content=f.read())
    return api_error('Not found', 404)


@bp.route('/api/restore/<filename>', methods=['POST'])
@bp.route('/api/restore/<machine_id>/<linux_user>/<filename>', methods=['POST'])
@require_role('editor', 'admin')
@require_machine_access
def restore_backup(filename, machine_id='local', linux_user=''):
    """回滚到指定备份版本"""
    if not linux_user or linux_user == '_default_':
        linux_user = config.DEFAULT_LINUX_USER
    if not filename.endswith('.bak') or '/' in filename or '\\' in filename:
        return api_error('Invalid filename')

    filepath = os.path.join(config.BACKUP_DIR, machine_id, linux_user, filename)
    if not os.path.exists(filepath):
        return api_error('Backup not found', 404)

    with open(filepath, 'r') as f:
        content = f.read()

    success, error = save_crontab(content, current_user.id, machine_id, linux_user)
    if success:
        log_action('restore_backup', {'machine': machine_id, 'linux_user': linux_user, 'filename': filename})
    return api_success() if success else api_error(error)
