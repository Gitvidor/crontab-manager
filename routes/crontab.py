# routes/crontab.py - Crontab 任务管理路由
# 功能: 任务 CRUD、组操作、拖拽排序、原始编辑

from flask import Blueprint, request
from flask_login import login_required, current_user

from core import config
from core.auth import require_role, require_machine_access
from core.crontab import (
    parse_crontab, get_all_tasks, find_task_by_id,
    get_crontab_raw, save_crontab, get_machine_params,
    validate_cron_schedule, validate_crontab_content,
    get_machine_executor, log_action,
)
from core.response import api_success, api_error

bp = Blueprint('crontab', __name__)


# ===== 查询 =====


@bp.route('/api/tasks')
@bp.route('/api/tasks/<machine_id>/<linux_user>')
@login_required
def get_tasks(machine_id='local', linux_user=''):
    """获取所有任务（分组）"""
    if not linux_user or linux_user == '_default_':
        linux_user = config.DEFAULT_LINUX_USER
    tasks = parse_crontab(machine_id, linux_user)
    return api_success(groups=tasks)


@bp.route('/api/raw')
@bp.route('/api/raw/<machine_id>/<linux_user>')
@login_required
def get_raw(machine_id='local', linux_user=''):
    """获取原始 crontab"""
    if not linux_user or linux_user == '_default_':
        linux_user = config.DEFAULT_LINUX_USER
    return api_success(
        content=get_crontab_raw(machine_id, linux_user),
        machine_id=machine_id,
        linux_user=linux_user
    )


@bp.route('/api/save', methods=['POST'])
@bp.route('/api/save/<machine_id>/<linux_user>', methods=['POST'])
@require_role('editor', 'admin')
@require_machine_access
def save(machine_id=None, linux_user=None):
    """保存原始 crontab"""
    if machine_id is None:
        machine_id = request.json.get('machine_id', 'local')
    if linux_user is None:
        linux_user = request.json.get('linux_user', '')
    if not linux_user or linux_user == '_default_':
        linux_user = config.DEFAULT_LINUX_USER
    content = request.json.get('content', '')

    valid, errors = validate_crontab_content(content)
    if not valid:
        return api_error('; '.join(errors[:5]))

    success, error = save_crontab(content, current_user.id, machine_id, linux_user)
    if success:
        log_action('save_raw', {'machine': machine_id, 'linux_user': linux_user, 'length': len(content)})
    return api_success() if success else api_error(error)


# ===== 任务操作 =====


@bp.route('/api/toggle/<int:task_id>', methods=['POST'])
@require_role('editor', 'admin')
@require_machine_access
def toggle_task(task_id):
    """启用/禁用任务"""
    machine_id, linux_user = get_machine_params()
    raw = get_crontab_raw(machine_id, linux_user)
    lines = raw.split('\n')
    tasks = get_all_tasks(machine_id, linux_user)
    action_detail = None

    for task in tasks:
        if task['id'] == task_id:
            line_num = task['line']
            if task['enabled']:
                lines[line_num] = '#' + lines[line_num]
                action_detail = {'task_id': task_id, 'action': 'disable', 'command': task['command'][:50], 'machine': machine_id}
            else:
                lines[line_num] = lines[line_num].lstrip('#')
                action_detail = {'task_id': task_id, 'action': 'enable', 'command': task['command'][:50], 'machine': machine_id}
            break

    new_content = '\n'.join(lines)
    success, error = save_crontab(new_content, current_user.id, machine_id, linux_user)
    if success and action_detail:
        log_action('toggle_task', action_detail)
    return api_success() if success else api_error(error)


@bp.route('/api/add', methods=['POST'])
@require_role('editor', 'admin')
@require_machine_access
def add_task():
    """添加新任务"""
    machine_id, linux_user = get_machine_params()
    schedule = request.json.get('schedule', '')
    command = request.json.get('command', '')

    if not schedule or not command:
        return api_error('Schedule and command cannot be empty')

    valid, error = validate_cron_schedule(schedule)
    if not valid:
        return api_error(error)

    raw = get_crontab_raw(machine_id, linux_user)
    new_line = f"#{schedule} {command}"
    if raw and not raw.endswith('\n'):
        raw += '\n'
    raw += new_line + '\n'

    success, error = save_crontab(raw, current_user.id, machine_id, linux_user)
    if success:
        log_action('add_task', {'schedule': schedule, 'command': command[:50], 'enabled': False, 'machine': machine_id})
    return api_success() if success else api_error(error)


@bp.route('/api/update/<int:task_id>', methods=['POST'])
@require_role('editor', 'admin')
@require_machine_access
def update_task(task_id):
    """更新任务"""
    machine_id, linux_user = get_machine_params()
    schedule = request.json.get('schedule', '')
    command = request.json.get('command', '')

    if not schedule or not command:
        return api_error('Schedule and command cannot be empty')

    valid, error = validate_cron_schedule(schedule)
    if not valid:
        return api_error(error)

    raw = get_crontab_raw(machine_id, linux_user)
    lines = raw.split('\n')
    tasks = get_all_tasks(machine_id, linux_user)
    old_task = None

    for task in tasks:
        if task['id'] == task_id:
            old_task = task
            line_num = task['line']
            new_line = f"{schedule} {command}"
            if not task['enabled']:
                new_line = '#' + new_line
            lines[line_num] = new_line
            break

    new_content = '\n'.join(lines)
    success, error = save_crontab(new_content, current_user.id, machine_id, linux_user)
    if success and old_task:
        log_action('update_task', {
            'task_id': task_id, 'old_schedule': old_task['schedule'],
            'new_schedule': schedule, 'command': command[:50], 'machine': machine_id
        })
    return api_success() if success else api_error(error)


@bp.route('/api/update_task_name/<int:task_id>', methods=['POST'])
@require_role('editor', 'admin')
@require_machine_access
def update_task_name(task_id):
    """更新任务名称"""
    machine_id, linux_user = get_machine_params()
    new_name = request.json.get('name', '').strip()

    raw = get_crontab_raw(machine_id, linux_user)
    lines = raw.split('\n')
    tasks = get_all_tasks(machine_id, linux_user)
    target_task = find_task_by_id(task_id, tasks)

    if not target_task:
        return api_error('Task not found')

    old_name = target_task.get('name', '')
    task_line = target_task['line']

    if 'name_line' in target_task:
        name_line = target_task['name_line']
        if new_name:
            lines[name_line] = f'# {new_name}'
        else:
            lines[name_line] = None
    else:
        if new_name:
            lines.insert(task_line, f'# {new_name}')

    new_lines = [l for l in lines if l is not None]
    new_content = '\n'.join(new_lines)
    success, error = save_crontab(new_content, current_user.id, machine_id, linux_user)
    if success:
        log_action('update_task_name', {
            'task_id': task_id, 'old_name': old_name,
            'new_name': new_name, 'machine': machine_id
        })
    return api_success() if success else api_error(error)


@bp.route('/api/run/<int:task_id>', methods=['POST'])
@require_role('editor', 'admin')
@require_machine_access
def run_task(task_id):
    """手动运行任务"""
    machine_id, linux_user = get_machine_params()
    tasks = get_all_tasks(machine_id, linux_user)
    target_task = find_task_by_id(task_id, tasks)
    if not target_task:
        return api_error('Task not found')

    command = target_task['command']
    try:
        executor = get_machine_executor(machine_id)
        returncode, stdout, stderr = executor.run_command(command)
        log_action('run_task', {'task_id': task_id, 'command': command[:50], 'machine': machine_id, 'returncode': returncode})
        return api_success(returncode=returncode, stdout=stdout, stderr=stderr, command=command[:50])
    except Exception as e:
        return api_error(str(e))


@bp.route('/api/delete/<int:task_id>', methods=['POST'])
@require_role('editor', 'admin')
@require_machine_access
def delete_task(task_id):
    """删除任务"""
    machine_id, linux_user = get_machine_params()
    raw = get_crontab_raw(machine_id, linux_user)
    lines = raw.split('\n')
    groups = parse_crontab(machine_id, linux_user)
    deleted_task = None
    deleted_group_title = None

    for group in groups:
        for task in group['tasks']:
            if task['id'] == task_id:
                deleted_task = task
                lines[task['line']] = None
                if 'name_line' in task:
                    lines[task['name_line']] = None
                if len(group['tasks']) == 1:
                    deleted_group_title = group['title'] or f'Group {group["id"]}'
                    if group['title_line'] >= 0:
                        lines[group['title_line']] = None
                break
        if deleted_task:
            break

    new_lines = [l for l in lines if l is not None]
    new_content = '\n'.join(new_lines)
    success, error = save_crontab(new_content, current_user.id, machine_id, linux_user)
    if success and deleted_task:
        details = {'task_id': task_id, 'command': deleted_task['command'][:50], 'machine': machine_id}
        if deleted_group_title:
            details['group_deleted'] = deleted_group_title
        log_action('delete_task', details)
    return api_success() if success else api_error(error)


# ===== 组操作 =====


@bp.route('/api/toggle_group/<int:group_id>', methods=['POST'])
@require_role('editor', 'admin')
@require_machine_access
def toggle_group(group_id):
    """启用/禁用整个任务组"""
    machine_id, linux_user = get_machine_params()
    enable = request.json.get('enable', True)
    raw = get_crontab_raw(machine_id, linux_user)
    lines = raw.split('\n')
    groups = parse_crontab(machine_id, linux_user)
    group_title = None

    for group in groups:
        if group['id'] == group_id:
            group_title = group['title']
            for task in group['tasks']:
                line_num = task['line']
                if enable and not task['enabled']:
                    lines[line_num] = lines[line_num].lstrip('#')
                elif not enable and task['enabled']:
                    lines[line_num] = '#' + lines[line_num]
            break

    new_content = '\n'.join(lines)
    success, error = save_crontab(new_content, current_user.id, machine_id, linux_user)
    if success:
        log_action('toggle_group', {'group_id': group_id, 'title': group_title, 'enable': enable, 'machine': machine_id})
    return api_success() if success else api_error(error)


@bp.route('/api/update_group_title/<int:group_id>', methods=['POST'])
@require_role('editor', 'admin')
@require_machine_access
def update_group_title(group_id):
    """更新任务组名称"""
    machine_id, linux_user = get_machine_params()
    new_title = request.json.get('title', '').strip()
    if not new_title:
        return api_error('Group name cannot be empty')

    raw = get_crontab_raw(machine_id, linux_user)
    lines = raw.split('\n')
    groups = parse_crontab(machine_id, linux_user)
    old_title = None

    for group in groups:
        if group['id'] == group_id:
            old_title = group['title']
            if group['title_line'] >= 0:
                lines[group['title_line']] = f"# {new_title}"
            else:
                if group['tasks']:
                    first_task_line = group['tasks'][0]['line']
                    lines.insert(first_task_line, f"# {new_title}")
            break
    else:
        return api_error('Task group not found')

    new_content = '\n'.join(lines)
    success, error = save_crontab(new_content, current_user.id, machine_id, linux_user)
    if success:
        log_action('update_group_title', {'group_id': group_id, 'old_title': old_title, 'new_title': new_title, 'machine': machine_id})
    return api_success() if success else api_error(error)


@bp.route('/api/add_to_group/<int:group_id>', methods=['POST'])
@require_role('editor', 'admin')
@require_machine_access
def add_task_to_group(group_id):
    """在指定组内添加新任务"""
    machine_id, linux_user = get_machine_params()
    schedule = request.json.get('schedule', '')
    command = request.json.get('command', '')
    name = request.json.get('name', '').strip()
    enabled = request.json.get('enabled', False)

    if not schedule or not command:
        return api_error('Schedule and command cannot be empty')

    valid, error = validate_cron_schedule(schedule)
    if not valid:
        return api_error(error)

    raw = get_crontab_raw(machine_id, linux_user)
    lines = raw.split('\n')
    groups = parse_crontab(machine_id, linux_user)
    group_title = None

    for group in groups:
        if group['id'] == group_id:
            group_title = group['title']
            if group['tasks']:
                last_task_line = group['tasks'][-1]['line']
                new_lines_to_insert = []
                if name:
                    new_lines_to_insert.append(f"# {name}")
                task_line = f"{schedule} {command}"
                if not enabled:
                    task_line = '#' + task_line
                new_lines_to_insert.append(task_line)
                for i, line in enumerate(new_lines_to_insert):
                    lines.insert(last_task_line + 1 + i, line)
            break
    else:
        return api_error('Task group not found')

    new_content = '\n'.join(lines)
    success, error = save_crontab(new_content, current_user.id, machine_id, linux_user)
    if success:
        details = {'group_id': group_id, 'group_title': group_title, 'schedule': schedule, 'command': command[:50], 'machine': machine_id}
        if name:
            details['name'] = name
        log_action('add_to_group', details)
    return api_success() if success else api_error(error)


@bp.route('/api/create_group', methods=['POST'])
@require_role('editor', 'admin')
@require_machine_access
def create_group():
    """创建新的任务组"""
    machine_id, linux_user = get_machine_params()
    title = request.json.get('title', '').strip()
    if not title:
        return api_error('Group name cannot be empty')

    raw = get_crontab_raw(machine_id, linux_user)
    if raw and not raw.endswith('\n'):
        raw += '\n'
    if raw.strip():
        raw += '\n'
    raw += f"# {title}\n"
    raw += "#* * * * * echo 'placeholder - please edit'\n"

    success, error = save_crontab(raw, current_user.id, machine_id, linux_user)
    if success:
        log_action('create_group', {'title': title, 'machine': machine_id})
    return api_success() if success else api_error(error)


@bp.route('/api/delete_group/<int:group_id>', methods=['POST'])
@require_role('editor', 'admin')
@require_machine_access
def delete_group(group_id):
    """删除整个任务组"""
    machine_id, linux_user = get_machine_params()
    raw = get_crontab_raw(machine_id, linux_user)
    lines = raw.split('\n')
    groups = parse_crontab(machine_id, linux_user)
    deleted_title = None

    for group in groups:
        if group['id'] == group_id:
            deleted_title = group['title']
            lines_to_delete = set()
            if group['title_line'] >= 0:
                lines_to_delete.add(group['title_line'])
            for task in group['tasks']:
                lines_to_delete.add(task['line'])
            for i in lines_to_delete:
                lines[i] = None
            break
    else:
        return api_error('Task group not found')

    new_lines = [l for l in lines if l is not None]
    new_content = '\n'.join(new_lines)
    success, error = save_crontab(new_content, current_user.id, machine_id, linux_user)
    if success:
        log_action('delete_group', {'group_id': group_id, 'title': deleted_title, 'machine': machine_id})
    return api_success() if success else api_error(error)


# ===== 排序 =====


@bp.route('/api/reorder_groups', methods=['POST'])
@require_role('editor', 'admin')
@require_machine_access
def reorder_groups():
    """重新排序任务组"""
    machine_id, linux_user = get_machine_params()
    from_id = request.json.get('from_id')
    to_id = request.json.get('to_id')
    insert_before = request.json.get('insert_before', True)

    if from_id is None or to_id is None:
        return api_error('Invalid parameters')

    raw = get_crontab_raw(machine_id, linux_user)
    lines = raw.split('\n')
    groups = parse_crontab(machine_id, linux_user)

    from_group = None
    to_group = None
    for g in groups:
        if g['id'] == from_id:
            from_group = g
        if g['id'] == to_id:
            to_group = g

    if not from_group or not to_group:
        return api_error('Group not found')

    from_lines = []
    if from_group['title_line'] >= 0:
        from_lines.append((from_group['title_line'], lines[from_group['title_line']]))
    for task in from_group['tasks']:
        from_lines.append((task['line'], lines[task['line']]))
    from_lines.sort(key=lambda x: x[0])

    for line_num, _ in from_lines:
        lines[line_num] = None

    if insert_before:
        if to_group['title_line'] >= 0:
            insert_pos = to_group['title_line']
        elif to_group['tasks']:
            insert_pos = to_group['tasks'][0]['line']
        else:
            insert_pos = 0
    else:
        if to_group['tasks']:
            insert_pos = to_group['tasks'][-1]['line'] + 1
        elif to_group['title_line'] >= 0:
            insert_pos = to_group['title_line'] + 1
        else:
            insert_pos = len(lines)

    removed_before = sum(1 for ln, _ in from_lines if ln < insert_pos)
    insert_pos -= removed_before
    new_lines = [l for l in lines if l is not None]
    insert_pos = min(insert_pos, len(new_lines))

    for i, (_, content) in enumerate(from_lines):
        new_lines.insert(insert_pos + i, content)

    insert_end = insert_pos + len(from_lines)
    if insert_end < len(new_lines) and new_lines[insert_end].strip():
        new_lines.insert(insert_end, '')
    if insert_pos > 0 and new_lines[insert_pos - 1].strip():
        new_lines.insert(insert_pos, '')

    new_content = '\n'.join(new_lines)
    success, error = save_crontab(new_content, current_user.id, machine_id, linux_user)
    if success:
        log_action('reorder_group', {
            'group_id': from_id, 'title': from_group.get('title', ''),
            'to_group_id': to_id, 'machine': machine_id
        })
    return api_success() if success else api_error(error)


@bp.route('/api/move_task_to_end', methods=['POST'])
@require_role('editor', 'admin')
@require_machine_access
def move_task_to_end():
    """将任务移动到指定组的末尾"""
    machine_id, linux_user = get_machine_params()
    task_id = request.json.get('task_id')
    from_group_id = request.json.get('from_group_id')
    to_group_id = request.json.get('to_group_id')

    if None in [task_id, from_group_id, to_group_id]:
        return api_error('Invalid parameters')

    raw = get_crontab_raw(machine_id, linux_user)
    lines = raw.split('\n')
    tasks = get_all_tasks(machine_id, linux_user)
    groups = parse_crontab(machine_id, linux_user)

    from_task = None
    for t in tasks:
        if t['id'] == task_id:
            from_task = t
            break

    if not from_task:
        return api_error('Task not found')

    to_group = None
    for g in groups:
        if g['id'] == to_group_id:
            to_group = g
            break

    if not to_group:
        return api_error('Target group not found')

    from_line = from_task['line']
    content = lines[from_line]

    if from_group_id != to_group_id:
        for g in groups:
            if g['id'] == from_group_id:
                if len(g['tasks']) == 1 and g['title_line'] >= 0:
                    lines[g['title_line']] = None
                break

    lines[from_line] = None
    new_lines = [l for l in lines if l is not None]

    if to_group['tasks']:
        last_task_line = to_group['tasks'][-1]['line']
        if from_line < last_task_line:
            insert_pos = last_task_line
        else:
            insert_pos = last_task_line + 1
        insert_pos = min(insert_pos, len(new_lines))
    else:
        if to_group['title_line'] >= 0:
            insert_pos = to_group['title_line']
            if from_line < to_group['title_line']:
                insert_pos -= 1
            insert_pos += 1
        else:
            insert_pos = len(new_lines)

    new_lines.insert(insert_pos, content)
    new_content = '\n'.join(new_lines)
    success, error = save_crontab(new_content, current_user.id, machine_id, linux_user)
    if success:
        log_action('move_task_to_end', {
            'task_id': task_id, 'from_group': from_group_id,
            'to_group': to_group_id, 'command': from_task['command'][:50], 'machine': machine_id
        })
    return api_success() if success else api_error(error)


@bp.route('/api/reorder_tasks', methods=['POST'])
@require_role('editor', 'admin')
@require_machine_access
def reorder_tasks():
    """重新排序任务（组内或跨组）"""
    machine_id, linux_user = get_machine_params()
    from_task_id = request.json.get('from_task_id')
    from_group_id = request.json.get('from_group_id')
    to_task_id = request.json.get('to_task_id')
    to_group_id = request.json.get('to_group_id')
    insert_before = request.json.get('insert_before', True)

    if None in [from_task_id, from_group_id, to_task_id, to_group_id]:
        return api_error('Invalid parameters')

    raw = get_crontab_raw(machine_id, linux_user)
    lines = raw.split('\n')
    tasks = get_all_tasks(machine_id, linux_user)
    groups = parse_crontab(machine_id, linux_user)

    from_task = None
    to_task = None
    for t in tasks:
        if t['id'] == from_task_id:
            from_task = t
        if t['id'] == to_task_id:
            to_task = t

    if not from_task or not to_task:
        return api_error('Task not found')

    from_line = from_task['line']
    to_line = to_task['line']
    task_content = lines[from_line]

    lines_to_move = []
    lines_to_remove = [from_line]
    if 'name_line' in from_task:
        name_line = from_task['name_line']
        lines_to_move.append(lines[name_line])
        lines_to_remove.append(name_line)
    lines_to_move.append(task_content)

    if from_group_id != to_group_id:
        for g in groups:
            if g['id'] == from_group_id:
                if len(g['tasks']) == 1 and g['title_line'] >= 0:
                    lines_to_remove.append(g['title_line'])
                break

    for ln in lines_to_remove:
        lines[ln] = None

    if insert_before and 'name_line' in to_task:
        target_line = to_task['name_line']
    else:
        target_line = to_line

    removed_before_target = sum(1 for ln in lines_to_remove if ln < target_line)

    if insert_before:
        insert_pos = target_line - removed_before_target
    else:
        insert_pos = target_line - removed_before_target + 1

    new_lines = [l for l in lines if l is not None]
    insert_pos = max(0, min(insert_pos, len(new_lines)))

    for i, content in enumerate(lines_to_move):
        new_lines.insert(insert_pos + i, content)

    new_content = '\n'.join(new_lines)
    success, error = save_crontab(new_content, current_user.id, machine_id, linux_user)
    if success:
        log_action('reorder_task', {
            'task_id': from_task_id, 'from_group': from_group_id,
            'to_group': to_group_id, 'command': from_task['command'][:50],
            'machine': machine_id, 'linux_user': linux_user
        })
    return api_success() if success else api_error(error)
