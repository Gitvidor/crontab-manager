# core/crontab.py - Crontab 解析、验证、保存核心逻辑
# 功能: parse_crontab, validate_cron_schedule, save_crontab, backup_crontab
# 分组规则: 注释行识别组名/任务名，空行分隔组
# 用法: from core.crontab import parse_crontab, validate_cron_schedule

import re
import os
import json
from datetime import datetime
from typing import Dict

from executor import CrontabExecutor, get_executor
from flask_login import current_user
from core import config

# 执行器缓存
_executors: Dict[str, CrontabExecutor] = {}


def get_machine_executor(machine_id: str) -> CrontabExecutor:
    """获取或创建机器执行器"""
    if machine_id not in _executors:
        if machine_id not in config.MACHINES:
            raise ValueError(f'Machine not found: {machine_id}')
        _executors[machine_id] = get_executor(config.MACHINES[machine_id])
    return _executors[machine_id]


def log_action(action, details=None):
    """记录操作日志"""
    log_entry = {
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "user": current_user.id if current_user.is_authenticated else "anonymous",
        "action": action,
        "details": details
    }
    with open(config.AUDIT_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(log_entry, ensure_ascii=False) + "\n")


# ===== 验证函数 =====


def validate_cron_field(value: str, min_val: int, max_val: int) -> bool:
    """验证单个 cron 字段的格式和范围"""
    if value == '*':
        return True
    if value.startswith('*/'):
        try:
            step = int(value[2:])
            return 1 <= step <= max_val
        except ValueError:
            return False
    for part in value.split(','):
        part = part.strip()
        if '-' in part:
            range_part = part.split('/')[0]
            try:
                start, end = range_part.split('-')
                start, end = int(start), int(end)
                if not (min_val <= start <= max_val and min_val <= end <= max_val):
                    return False
                if start > end:
                    return False
            except ValueError:
                return False
        else:
            try:
                num = int(part)
                if not (min_val <= num <= max_val):
                    return False
            except ValueError:
                return False
    return True


def validate_cron_schedule(schedule: str) -> tuple:
    """
    验证 cron 表达式格式和值范围
    返回 (是否有效, 错误信息)
    """
    parts = schedule.split()
    if len(parts) != 5:
        return False, "Cron expression must have 5 fields"

    fields = [
        ('minute', 0, 59),
        ('hour', 0, 23),
        ('day', 1, 31),
        ('month', 1, 12),
        ('weekday', 0, 7),
    ]

    for i, (name, min_val, max_val) in enumerate(fields):
        if not validate_cron_field(parts[i], min_val, max_val):
            return False, f"Invalid {name}: {parts[i]} (valid: {min_val}-{max_val})"
    return True, ""


def validate_crontab_line(line: str) -> tuple:
    """验证单行 crontab 内容"""
    line = line.strip()
    if not line or line.startswith('#'):
        return True, ""
    if re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', line):
        return True, ""
    parts = line.split(None, 5)
    if len(parts) < 6:
        return False, "Cron line must have schedule (5 fields) + command"
    schedule = ' '.join(parts[:5])
    command = parts[5]
    valid, error = validate_cron_schedule(schedule)
    if not valid:
        return False, error
    if not command.strip():
        return False, "Command cannot be empty"
    return True, ""


def validate_crontab_content(content: str) -> tuple:
    """验证整个 crontab 内容，返回 (是否有效, 错误列表)"""
    errors = []
    for i, line in enumerate(content.split('\n'), 1):
        if line.strip().startswith('#') and re.match(r'^#[\d*,/-]+\s+', line.strip()):
            uncommented = line.strip()[1:]
            valid, error = validate_crontab_line(uncommented)
            if not valid:
                errors.append(f"Line {i}: {error}")
        else:
            valid, error = validate_crontab_line(line)
            if not valid:
                errors.append(f"Line {i}: {error}")
    return len(errors) == 0, errors


# ===== Crontab 读写 =====


def get_crontab_raw(machine_id: str = 'local', linux_user: str = ''):
    """获取原始 crontab 内容"""
    executor = get_machine_executor(machine_id)
    return executor.get_crontab(linux_user)


def is_cron_task_line(line):
    """判断是否为任务行（生效或禁用的 cron 任务）"""
    if re.match(r'^[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+.+$', line):
        return True
    if re.match(r'^#[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+.+$', line):
        return True
    return False


def parse_crontab(machine_id: str = 'local', linux_user: str = ''):
    """
    解析 crontab，返回按注释分组的任务列表

    分组规则:
    1. 任务行 + 空行 + 注释行 → 开始新组
    2. 连续多行注释（≥2行）→ 开始新组
    组名: 1行注释=组名，多行注释=倒数第二行为组名
    任务名: 任务行上方的注释行（未被选为组名则作为任务名）
    """
    raw = get_crontab_raw(machine_id, linux_user)
    if not raw:
        return []

    groups = []
    lines = raw.split('\n')

    comment_buffer = []
    new_group_context = True
    current_group = {'id': 0, 'title': '', 'title_line': -1, 'tasks': []}
    task_id = 0
    last_non_empty_is_task = False
    comment_interrupted = False
    comment_after_task = False

    for i, line in enumerate(lines):
        line = line.rstrip()

        if not line:
            if last_non_empty_is_task:
                new_group_context = True
            elif len(comment_buffer) > 0 and comment_after_task:
                comment_interrupted = True
            continue

        if is_cron_task_line(line):
            start_new_group = new_group_context and len(comment_buffer) > 0

            if start_new_group:
                if current_group['tasks']:
                    groups.append(current_group)
                    current_group = {'id': len(groups), 'title': '', 'title_line': -1, 'tasks': []}

                if len(comment_buffer) == 1:
                    current_group['title'] = comment_buffer[0][1].lstrip('#').strip()
                    current_group['title_line'] = comment_buffer[0][0]
                    task_name = None
                    task_name_line = -1
                else:
                    current_group['title'] = comment_buffer[-2][1].lstrip('#').strip()
                    current_group['title_line'] = comment_buffer[-2][0]
                    task_name = comment_buffer[-1][1].lstrip('#').strip()
                    task_name_line = comment_buffer[-1][0]
            else:
                if len(comment_buffer) == 1:
                    task_name = comment_buffer[0][1].lstrip('#').strip()
                    task_name_line = comment_buffer[0][0]
                else:
                    task_name = None
                    task_name_line = -1

            disabled_match = re.match(
                r'^#([\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+)\s+(.+)$', line
            )
            if disabled_match:
                task = {
                    'id': task_id, 'line': i, 'raw': line, 'enabled': False,
                    'schedule': disabled_match.group(1), 'command': disabled_match.group(2)
                }
            else:
                cron_match = re.match(
                    r'^([\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+)\s+(.+)$', line
                )
                task = {
                    'id': task_id, 'line': i, 'raw': line, 'enabled': True,
                    'schedule': cron_match.group(1), 'command': cron_match.group(2)
                }

            if task_name:
                task['name'] = task_name
                task['name_line'] = task_name_line

            current_group['tasks'].append(task)
            task_id += 1
            comment_buffer = []
            new_group_context = False
            last_non_empty_is_task = True
            comment_interrupted = False
            comment_after_task = False

        elif line.startswith('#'):
            next_line = lines[i + 1].rstrip() if i + 1 < len(lines) else ''
            if last_non_empty_is_task and not next_line:
                new_group_context = True
                last_non_empty_is_task = False
                continue

            if comment_interrupted:
                comment_buffer = []
                comment_interrupted = False

            if len(comment_buffer) == 0:
                comment_after_task = last_non_empty_is_task

            comment_buffer.append((i, line))

            if len(comment_buffer) >= 2 and comment_after_task:
                new_group_context = True

            last_non_empty_is_task = False

    if current_group['tasks']:
        groups.append(current_group)

    return groups


def get_all_tasks(machine_id: str = 'local', linux_user: str = ''):
    """获取所有任务的扁平列表"""
    groups = parse_crontab(machine_id, linux_user)
    tasks = []
    for group in groups:
        tasks.extend(group['tasks'])
    return tasks


def find_task_by_id(task_id, tasks=None):
    """根据 ID 查找任务"""
    if tasks is None:
        tasks = get_all_tasks()
    return next((t for t in tasks if t['id'] == task_id), None)


# ===== 备份与保存 =====


def cleanup_duplicate_backups(backup_subdir: str = None):
    """清理连续且完全相同的备份"""
    target_dir = backup_subdir or config.BACKUP_DIR
    if not os.path.exists(target_dir):
        return
    backups = sorted([f for f in os.listdir(target_dir) if f.endswith('.bak')])
    if len(backups) < 2:
        return
    prev_content = None
    for bak in backups:
        filepath = os.path.join(target_dir, bak)
        with open(filepath, 'r') as f:
            content = f.read()
        if prev_content is not None and content == prev_content:
            os.remove(filepath)
        else:
            prev_content = content


def backup_crontab(username=None, machine_id: str = 'local', linux_user: str = ''):
    """备份当前 crontab"""
    if not linux_user:
        linux_user = config.DEFAULT_LINUX_USER
    current = get_crontab_raw(machine_id, linux_user)
    if current:
        backup_subdir = os.path.join(config.BACKUP_DIR, machine_id, linux_user)
        os.makedirs(backup_subdir, exist_ok=True)
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        safe_user = re.sub(r'[^a-zA-Z0-9_]', '', username or 'unknown')
        backup_file = os.path.join(backup_subdir, f'crontab_{timestamp}_{safe_user}.bak')
        with open(backup_file, 'w') as f:
            f.write(current)
        cleanup_duplicate_backups(backup_subdir)
        backups = sorted(os.listdir(backup_subdir), reverse=True)
        for old in backups[100:]:
            os.remove(os.path.join(backup_subdir, old))
        return backup_file
    return None


def save_crontab(content, username=None, machine_id: str = 'local', linux_user: str = ''):
    """保存 crontab 内容（自动备份）"""
    backup_crontab(username, machine_id, linux_user)
    content = re.sub(r'\n{3,}', '\n\n', content)
    executor = get_machine_executor(machine_id)
    return executor.save_crontab(content, linux_user)


def get_machine_params():
    """从请求中获取机器参数"""
    from flask import request
    if request.json:
        machine_id = request.json.get('machine_id', 'local')
        linux_user = request.json.get('linux_user', '')
    else:
        machine_id = request.args.get('machine_id', 'local')
        linux_user = request.args.get('linux_user', '')
    if not linux_user or linux_user == '_default_':
        linux_user = config.DEFAULT_LINUX_USER
    return machine_id, linux_user


# ===== Crontab 变化检测 =====


def check_single_crontab(machine_id: str, linux_user: str):
    """检测单个 crontab 是否变化"""
    if not linux_user:
        linux_user = config.DEFAULT_LINUX_USER
    current = get_crontab_raw(machine_id, linux_user)
    if not current:
        return False

    backup_subdir = os.path.join(config.BACKUP_DIR, machine_id, linux_user)
    if not os.path.exists(backup_subdir):
        backup_crontab('system', machine_id, linux_user)
        return True

    backups = sorted([f for f in os.listdir(backup_subdir) if f.endswith('.bak')], reverse=True)
    if not backups:
        backup_crontab('system', machine_id, linux_user)
        return True

    with open(os.path.join(backup_subdir, backups[0]), 'r') as f:
        last_backup = f.read()

    if current != last_backup:
        backup_crontab('system', machine_id, linux_user)
        log_action('external_change_detected', {
            'machine': machine_id,
            'linux_user': linux_user
        })
        return True
    return False
