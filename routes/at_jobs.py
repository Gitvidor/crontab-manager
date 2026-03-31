# routes/at_jobs.py - At 任务、模板、历史路由
# 功能: At 一次性任务 CRUD、模板管理、执行历史查询

import re
from datetime import datetime
from flask import Blueprint, request
from flask_login import login_required, current_user

from core import config
from core.auth import require_role, require_machine_access
from core.crontab import get_machine_executor, get_machine_params, log_action
from core.at_jobs import (
    parse_atq_output, extract_command_from_at_content,
    generate_history_id, wrap_command_for_history,
    load_at_history, save_at_history, mark_history_cancelled,
    load_templates, save_templates, generate_template_id,
    _at_history_lock,
)
from core.response import api_success, api_error

bp = Blueprint('at_jobs', __name__)


# ===== At Jobs =====


@bp.route('/api/at_jobs')
@bp.route('/api/at_jobs/<machine_id>/<linux_user>')
@login_required
@require_machine_access
def list_at_jobs(machine_id=None, linux_user=None):
    """列出所有 at 任务"""
    if machine_id is None:
        machine_id, linux_user = get_machine_params()
    try:
        executor = get_machine_executor(machine_id)
        returncode, stdout, stderr = executor.run_command('atq')
        if returncode != 0 and 'no atd running' in stderr.lower():
            return api_error('atd 服务未运行，请执行: systemctl start atd')
        jobs = parse_atq_output(stdout)
        return api_success(jobs=jobs)
    except Exception as e:
        return api_error(str(e))


@bp.route('/api/at_jobs', methods=['POST'])
@bp.route('/api/at_jobs/<machine_id>/<linux_user>', methods=['POST'])
@require_role('editor', 'admin')
@require_machine_access
def create_at_job(machine_id=None, linux_user=None):
    """创建新 at 任务"""
    if machine_id is None:
        machine_id, linux_user = get_machine_params()
    command = request.json.get('command', '').strip()
    time_spec = request.json.get('time_spec', '').strip()
    template_name = request.json.get('template_name')

    if not command:
        return api_error('请输入要执行的命令')
    if not time_spec:
        return api_error('请指定执行时间')
    if not re.match(r'^[a-zA-Z0-9\s:+\-/]+$', time_spec):
        return api_error('时间格式包含非法字符')

    try:
        executor = get_machine_executor(machine_id)
        history_id = generate_history_id()
        wrapped_cmd = wrap_command_for_history(command, history_id)

        escaped_cmd = wrapped_cmd.replace("'", "'\\''")
        at_cmd = f"cd /tmp && printf '%s\\n' '{escaped_cmd}' | at {time_spec} 2>&1"
        returncode, stdout, stderr = executor.run_command(at_cmd)

        output = stdout + stderr
        match = re.search(r'job\s+(\d+)\s+at\s+(.+)', output)
        if match:
            job_id = match.group(1)
            scheduled_time = match.group(2).strip()

            with _at_history_lock:
                data = load_at_history()
                record = {
                    'id': history_id, 'job_id': job_id, 'command': command,
                    'time_spec': time_spec, 'scheduled_time': scheduled_time,
                    'status': 'pending',
                    'created_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    'created_by': current_user.id,
                    'executed_at': None, 'exit_code': None,
                    'machine_id': machine_id, 'template_name': template_name
                }
                data['history'].append(record)
                if machine_id not in data['pending']:
                    data['pending'][machine_id] = {}
                data['pending'][machine_id][job_id] = history_id
                save_at_history(data)

            log_action('create_at_job', {
                'job_id': job_id, 'command': command[:100],
                'time_spec': time_spec, 'machine': machine_id
            })
            return api_success(job_id=job_id, scheduled_time=scheduled_time, history_id=history_id)

        if 'no atd running' in output.lower() or 'cannot open' in output.lower():
            return api_error('atd 服务未运行，请执行: systemctl start atd')
        return api_error(output or '创建任务失败')
    except Exception as e:
        return api_error(str(e))


@bp.route('/api/at_job/<job_id>')
@bp.route('/api/at_job/<job_id>/<machine_id>/<linux_user>')
@login_required
@require_machine_access
def get_at_job_detail(job_id, machine_id=None, linux_user=None):
    """获取 at 任务详情"""
    if machine_id is None:
        machine_id, _ = get_machine_params()
    if not job_id.isdigit():
        return api_error('无效的任务 ID')

    try:
        executor = get_machine_executor(machine_id)
        returncode, stdout, stderr = executor.run_command(f'at -c {job_id}')
        if returncode != 0:
            return api_error(stderr or '任务不存在')

        command = extract_command_from_at_content(stdout)
        return api_success(job_id=job_id, command=command, raw_content=stdout)
    except Exception as e:
        return api_error(str(e))


@bp.route('/api/at_job/<job_id>', methods=['DELETE'])
@bp.route('/api/at_job/<job_id>/<machine_id>/<linux_user>', methods=['DELETE'])
@require_role('editor', 'admin')
@require_machine_access
def delete_at_job(job_id, machine_id=None, linux_user=None):
    """删除 at 任务"""
    if machine_id is None:
        machine_id, _ = get_machine_params()
    if not job_id.isdigit():
        return api_error('无效的任务 ID')

    try:
        executor = get_machine_executor(machine_id)
        returncode, stdout, stderr = executor.run_command(f'atrm {job_id}')
        if returncode != 0:
            return api_error(stderr or '删除失败')

        mark_history_cancelled(job_id, machine_id)
        log_action('delete_at_job', {'job_id': job_id, 'machine': machine_id})
        return api_success(message=f'任务 {job_id} 已删除')
    except Exception as e:
        return api_error(str(e))


# ===== At Templates =====


@bp.route('/api/at_templates')
@login_required
def list_at_templates():
    """获取所有模板"""
    data = load_templates()
    return api_success(templates=data.get('templates', []))


@bp.route('/api/at_templates', methods=['POST'])
@require_role('editor', 'admin')
def create_at_template():
    """创建新模板"""
    name = request.json.get('name', '').strip()
    command = request.json.get('command', '').strip()
    default_time = request.json.get('default_time', 'now + 5 minutes').strip()

    if not name:
        return api_error('请输入模板名称')
    if not command:
        return api_error('请输入命令')

    data = load_templates()
    template = {
        'id': generate_template_id(),
        'name': name, 'command': command,
        'default_time': default_time,
        'created_at': datetime.now().isoformat(),
        'created_by': current_user.id
    }
    data['templates'].append(template)
    save_templates(data)
    log_action('create_at_template', {'name': name})
    return api_success(template=template)


@bp.route('/api/at_template/<template_id>', methods=['PUT'])
@require_role('editor', 'admin')
def update_at_template(template_id):
    """更新模板"""
    data = load_templates()
    for tpl in data['templates']:
        if tpl['id'] == template_id:
            tpl['name'] = request.json.get('name', tpl['name']).strip()
            tpl['command'] = request.json.get('command', tpl['command']).strip()
            tpl['default_time'] = request.json.get('default_time', tpl['default_time']).strip()
            save_templates(data)
            log_action('update_at_template', {'id': template_id, 'name': tpl['name']})
            return api_success(template=tpl)
    return api_error('模板不存在', 404)


@bp.route('/api/at_template/<template_id>', methods=['DELETE'])
@require_role('editor', 'admin')
def delete_at_template(template_id):
    """删除模板"""
    data = load_templates()
    original_len = len(data['templates'])
    data['templates'] = [t for t in data['templates'] if t['id'] != template_id]
    if len(data['templates']) == original_len:
        return api_error('模板不存在', 404)
    save_templates(data)
    log_action('delete_at_template', {'id': template_id})
    return api_success(message='模板已删除')


# ===== At History =====


@bp.route('/api/at_history')
@bp.route('/api/at_history/<machine_id>/<linux_user>')
@login_required
@require_machine_access
def list_at_history(machine_id=None, linux_user=None):
    """获取历史记录列表（支持分页和过滤）"""
    if machine_id is None:
        machine_id, linux_user = get_machine_params()

    data = load_at_history()
    history = data.get('history', [])
    history = [r for r in history if r.get('machine_id') == machine_id]

    status = request.args.get('status')
    if status and status in ('pending', 'executed', 'cancelled'):
        history = [r for r in history if r.get('status') == status]

    history = sorted(history, key=lambda x: x.get('created_at', ''), reverse=True)

    page = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 20))
    total = len(history)
    start = (page - 1) * per_page
    end = start + per_page
    history = history[start:end]

    return api_success(
        history=history, total=total,
        page=page, per_page=per_page,
        total_pages=(total + per_page - 1) // per_page
    )


@bp.route('/api/at_history/<history_id>')
@login_required
def get_at_history_detail(history_id):
    """获取单条历史记录详情"""
    data = load_at_history()
    for record in data.get('history', []):
        if record['id'] == history_id:
            return api_success(record=record)
    return api_error('记录不存在', 404)


@bp.route('/api/at_history', methods=['DELETE'])
@require_role('admin')
def cleanup_at_history_api():
    """手动清理历史记录"""
    days = int(request.args.get('days', config.AT_HISTORY_RETENTION_DAYS))
    with _at_history_lock:
        data = load_at_history()
        cutoff = datetime.now().timestamp() - days * 86400
        original_len = len(data['history'])
        data['history'] = [
            r for r in data['history']
            if r.get('status') == 'pending' or
            datetime.strptime(r['created_at'], '%Y-%m-%d %H:%M:%S').timestamp() > cutoff
        ]
        deleted = original_len - len(data['history'])
        save_at_history(data)
    return api_success(deleted=deleted)
