# app.py - Crontab Web 管理工具
# 功能: 通过 Web 界面查看、编辑、启用/禁用 crontab 任务
# 认证: Flask-Login 多用户认证 + 审计日志
# 启动: python app.py, 访问 http://localhost:5100

# ===== 配置和初始化 =====

from flask import Flask, render_template, request, jsonify, redirect, url_for
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
import subprocess
import re
import os
import json
from datetime import datetime

app = Flask(__name__)

# 加载配置文件
CONFIG_FILE = os.path.join(os.path.dirname(__file__), 'config.json')
if os.path.exists(CONFIG_FILE):
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        config = json.load(f)
else:
    config = {"secret_key": "change-me", "users": {"admin": "admin123"}}

app.secret_key = os.environ.get('SECRET_KEY', config.get('secret_key', 'change-me'))
USERS = json.loads(os.environ.get('CRONTAB_USERS', 'null')) or config.get('users', {})

# ===== 用户认证 =====
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'


class User(UserMixin):
    """用户类"""
    def __init__(self, username):
        self.id = username


@login_manager.user_loader
def load_user(user_id):
    if user_id in USERS:
        return User(user_id)
    return None


# 目录配置
BACKUP_DIR = os.path.join(os.path.dirname(__file__), 'backups')
LOG_DIR = os.path.join(os.path.dirname(__file__), 'log')
AUDIT_LOG = os.path.join(LOG_DIR, 'audit.log')
os.makedirs(BACKUP_DIR, exist_ok=True)
os.makedirs(LOG_DIR, exist_ok=True)

# ===== 工具函数 =====


def log_action(action, details=None):
    """记录操作日志"""
    log_entry = {
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "user": current_user.id if current_user.is_authenticated else "anonymous",
        "action": action,
        "details": details
    }
    with open(AUDIT_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(log_entry, ensure_ascii=False) + "\n")


def validate_cron_schedule(schedule):
    """验证 cron 表达式格式"""
    return bool(re.match(r'^[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+$', schedule))


def find_task_by_id(task_id, tasks=None):
    """根据 ID 查找任务"""
    if tasks is None:
        tasks = get_all_tasks()
    return next((t for t in tasks if t['id'] == task_id), None)


def is_cron_task_line(line):
    """判断是否为任务行（生效或禁用的 cron 任务）"""
    # 已生效的 cron 任务
    if re.match(r'^[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+.+$', line):
        return True
    # 已注释的 cron 任务（# + cron表达式）
    if re.match(r'^#[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+.+$', line):
        return True
    return False


def parse_crontab():
    """
    解析 crontab，返回按新规则分组的任务列表

    新组识别规则:
    1. 任务行 + 空行 + 注释行 → 开始新组
    2. 连续多行注释（≥2行）→ 开始新组

    组名识别: 1行注释=组名，多行注释=倒数第二行为组名
    任务名识别: 任务行上方的注释行，若未被选为组名则作为任务名
    """
    result = subprocess.run(['crontab', '-l'], capture_output=True, text=True)
    if result.returncode != 0:
        return []

    groups = []
    lines = result.stdout.split('\n')

    # 初始化状态
    comment_buffer = []  # [(line_num, text), ...]
    new_group_context = True  # 文件开头视同空行后
    current_group = {'id': 0, 'title': '', 'title_line': -1, 'tasks': []}
    task_id = 0
    last_non_empty_is_task = False  # 上一个非空行是否是任务行

    for i, line in enumerate(lines):
        line = line.rstrip()

        # 空行处理
        if not line:
            # 如果上一个非空行是任务行 → 设置 new_group_context
            if last_non_empty_is_task:
                new_group_context = True
            # 多个连续空行视为一个，不清空 comment_buffer
            continue

        # 判断是否为任务行
        if is_cron_task_line(line):
            # === 处理任务行 ===

            # 判断是否开始新组
            start_new_group = new_group_context and len(comment_buffer) > 0

            if start_new_group:
                # 如果当前组有任务，先保存
                if current_group['tasks']:
                    groups.append(current_group)
                    current_group = {'id': len(groups), 'title': '', 'title_line': -1, 'tasks': []}

                # 根据注释行数确定组名和任务名
                if len(comment_buffer) == 1:
                    # 单行注释 = 组名，任务无任务名
                    current_group['title'] = comment_buffer[0][1].lstrip('#').strip()
                    current_group['title_line'] = comment_buffer[0][0]
                    task_name = None
                    task_name_line = -1
                else:
                    # 多行注释: 倒数第二行 = 组名，最后一行 = 任务名
                    current_group['title'] = comment_buffer[-2][1].lstrip('#').strip()
                    current_group['title_line'] = comment_buffer[-2][0]
                    task_name = comment_buffer[-1][1].lstrip('#').strip()
                    task_name_line = comment_buffer[-1][0]
            else:
                # 不开始新组
                if len(comment_buffer) == 1:
                    # 有1行注释 → 该注释 = 任务名
                    task_name = comment_buffer[0][1].lstrip('#').strip()
                    task_name_line = comment_buffer[0][0]
                else:
                    task_name = None
                    task_name_line = -1

            # 解析任务行
            disabled_match = re.match(r'^#([\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+)\s+(.+)$', line)
            if disabled_match:
                # 被禁用的 cron 任务
                task = {
                    'id': task_id,
                    'line': i,
                    'raw': line,
                    'enabled': False,
                    'schedule': disabled_match.group(1),
                    'command': disabled_match.group(2)
                }
            else:
                # 已生效的 cron 任务
                cron_match = re.match(r'^([\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+\s+[\d*,/-]+)\s+(.+)$', line)
                task = {
                    'id': task_id,
                    'line': i,
                    'raw': line,
                    'enabled': True,
                    'schedule': cron_match.group(1),
                    'command': cron_match.group(2)
                }

            # 设置任务名
            if task_name:
                task['name'] = task_name
                task['name_line'] = task_name_line

            current_group['tasks'].append(task)
            task_id += 1

            # 重置状态
            comment_buffer = []
            new_group_context = False
            last_non_empty_is_task = True

        elif line.startswith('#'):
            # === 处理注释行 ===
            comment_buffer.append((i, line))

            # 如果连续注释达到2行，触发 new_group_context
            if len(comment_buffer) >= 2:
                new_group_context = True

            last_non_empty_is_task = False

    # 添加最后一个组
    if current_group['tasks']:
        groups.append(current_group)

    return groups


def get_all_tasks():
    """获取所有任务的扁平列表（用于ID查找）"""
    groups = parse_crontab()
    tasks = []
    for group in groups:
        tasks.extend(group['tasks'])
    return tasks


def get_crontab_raw():
    """获取原始crontab内容"""
    result = subprocess.run(['crontab', '-l'], capture_output=True, text=True)
    return result.stdout if result.returncode == 0 else ""


def cleanup_duplicate_backups():
    """清理连续且完全相同的备份，仅保留最早的一个"""
    backups = sorted([f for f in os.listdir(BACKUP_DIR) if f.endswith('.bak')])
    if len(backups) < 2:
        return
    prev_content = None
    for bak in backups:
        filepath = os.path.join(BACKUP_DIR, bak)
        with open(filepath, 'r') as f:
            content = f.read()
        if prev_content is not None and content == prev_content:
            os.remove(filepath)
        else:
            prev_content = content


def backup_crontab(username=None):
    """备份当前crontab，记录操作用户"""
    current = get_crontab_raw()
    if current:
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        # 清理用户名：只保留字母数字下划线
        safe_user = re.sub(r'[^a-zA-Z0-9_]', '', username or 'unknown')
        backup_file = os.path.join(BACKUP_DIR, f'crontab_{timestamp}_{safe_user}.bak')
        with open(backup_file, 'w') as f:
            f.write(current)
        # 清理连续相同的备份
        cleanup_duplicate_backups()
        # 只保留最近500个备份
        backups = sorted(os.listdir(BACKUP_DIR), reverse=True)
        for old in backups[500:]:
            os.remove(os.path.join(BACKUP_DIR, old))
        return backup_file
    return None


def save_crontab(content, username=None):
    """保存crontab内容（自动备份）"""
    backup_crontab(username)  # 保存前备份
    # 清理连续空行，保留单个空行
    content = re.sub(r'\n{3,}', '\n\n', content)
    process = subprocess.Popen(
        ['crontab', '-'],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    stdout, stderr = process.communicate(content)
    return process.returncode == 0, stderr


# ===== 认证路由 =====


@app.route('/login', methods=['GET', 'POST'])
def login():
    """登录页面"""
    if current_user.is_authenticated:
        return redirect('/')

    error = None
    if request.method == 'POST':
        username = request.form.get('username', '')
        password = request.form.get('password', '')
        if username in USERS and USERS[username] == password:
            login_user(User(username))
            log_action('login')
            next_page = request.args.get('next')
            return redirect(next_page or '/')
        error = 'Invalid username or password'
    return render_template('login.html', error=error)


@app.route('/logout')
@login_required
def logout():
    """登出"""
    log_action('logout')
    logout_user()
    return redirect('/login')


@app.route('/')
@login_required
def index():
    return render_template('index.html', username=current_user.id)


# ===== 查询 API =====


@app.route('/api/current_user')
@login_required
def get_current_user():
    """获取当前用户信息"""
    return jsonify({'username': current_user.id})


@app.route('/api/audit_logs')
@login_required
def get_audit_logs():
    """获取审计日志"""
    logs = []
    if os.path.exists(AUDIT_LOG):
        with open(AUDIT_LOG, "r", encoding="utf-8") as f:
            lines = f.readlines()[-100:]  # 最近 100 条
            for line in reversed(lines):
                try:
                    logs.append(json.loads(line.strip()))
                except json.JSONDecodeError:
                    continue
    return jsonify(logs)


@app.route('/api/cron_logs')
@login_required
def get_cron_logs():
    """获取系统cron执行日志"""
    logs = []
    cron_log_paths = [
        '/var/log/cron',           # RHEL/CentOS
        '/var/log/cron.log',       # Some systems
        '/var/log/syslog',         # Debian/Ubuntu (需过滤CRON)
    ]

    log_file = None
    for path in cron_log_paths:
        if os.path.exists(path):
            log_file = path
            break

    if not log_file:
        return jsonify({'logs': [], 'source': 'none', 'error': 'No cron log file found'})

    try:
        # 读取最近500行
        result = subprocess.run(
            ['tail', '-n', '500', log_file],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            return jsonify({'logs': [], 'source': log_file, 'error': result.stderr})

        lines = result.stdout.strip().split('\n')

        # 如果是syslog，过滤CRON相关行
        if 'syslog' in log_file:
            lines = [l for l in lines if 'CRON' in l or 'cron' in l.lower()]

        # 取最近200条并倒序
        logs = list(reversed(lines[-200:])) if lines else []

        return jsonify({'logs': logs, 'source': log_file, 'error': None})
    except subprocess.TimeoutExpired:
        return jsonify({'logs': [], 'source': log_file, 'error': 'Timeout reading log file'})
    except Exception as e:
        return jsonify({'logs': [], 'source': log_file, 'error': str(e)})


@app.route('/api/tasks')
@login_required
def get_tasks():
    """获取所有任务"""
    tasks = parse_crontab()
    return jsonify(tasks)


@app.route('/api/raw')
@login_required
def get_raw():
    """获取原始crontab"""
    return jsonify({'content': get_crontab_raw()})


@app.route('/api/save', methods=['POST'])
@login_required
def save():
    """保存原始crontab"""
    content = request.json.get('content', '')
    success, error = save_crontab(content, current_user.id)
    if success:
        log_action('save_raw', {'length': len(content)})
    return jsonify({'success': success, 'error': error})


@app.route('/api/backups')
@login_required
def get_backups():
    """获取所有备份列表，按时间倒序"""
    backups = sorted(
        [f for f in os.listdir(BACKUP_DIR) if f.endswith('.bak')],
        reverse=True
    )
    result = []
    for bak in backups:
        # 从文件名提取时间和用户：crontab_20251231_151544_username.bak
        name = bak.replace('crontab_', '').replace('.bak', '')
        parts = name.split('_')
        if len(parts) >= 3:
            # 新格式：时间_时间_用户名
            timestamp = f'{parts[0]}_{parts[1]}'
            username = '_'.join(parts[2:])  # 用户名可能包含下划线
        else:
            # 旧格式：时间_时间（无用户名）
            timestamp = name
            username = ''
        result.append({'filename': bak, 'timestamp': timestamp, 'username': username})
    return jsonify({'backups': result})


@app.route('/api/backup/<filename>')
@login_required
def get_backup_content(filename):
    """获取指定备份的内容"""
    # 安全检查：只允许 .bak 文件且不含路径分隔符
    if not filename.endswith('.bak') or '/' in filename or '\\' in filename:
        return jsonify({'error': 'Invalid filename'}), 400
    filepath = os.path.join(BACKUP_DIR, filename)
    if os.path.exists(filepath):
        with open(filepath, 'r') as f:
            return jsonify({'content': f.read()})
    return jsonify({'error': 'Not found'}), 404


@app.route('/api/restore/<filename>', methods=['POST'])
@login_required
def restore_backup(filename):
    """回滚到指定备份版本"""
    # 安全检查
    if not filename.endswith('.bak') or '/' in filename or '\\' in filename:
        return jsonify({'success': False, 'error': 'Invalid filename'}), 400
    filepath = os.path.join(BACKUP_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({'success': False, 'error': 'Backup not found'}), 404

    with open(filepath, 'r') as f:
        content = f.read()

    success, error = save_crontab(content, current_user.id)
    if success:
        log_action('restore_backup', {'filename': filename})
        return jsonify({'success': True})
    return jsonify({'success': False, 'error': error})


# ===== 任务操作 API =====


@app.route('/api/toggle/<int:task_id>', methods=['POST'])
@login_required
def toggle_task(task_id):
    """启用/禁用任务"""
    raw = get_crontab_raw()
    lines = raw.split('\n')
    tasks = get_all_tasks()
    action_detail = None

    for task in tasks:
        if task['id'] == task_id:
            line_num = task['line']
            if task['enabled']:
                lines[line_num] = '#' + lines[line_num]
                action_detail = {'task_id': task_id, 'action': 'disable', 'command': task['command'][:50]}
            else:
                lines[line_num] = lines[line_num].lstrip('#')
                action_detail = {'task_id': task_id, 'action': 'enable', 'command': task['command'][:50]}
            break

    new_content = '\n'.join(lines)
    success, error = save_crontab(new_content, current_user.id)
    if success and action_detail:
        log_action('toggle_task', action_detail)
    return jsonify({'success': success, 'error': error})


@app.route('/api/add', methods=['POST'])
@login_required
def add_task():
    """添加新任务"""
    schedule = request.json.get('schedule', '')
    command = request.json.get('command', '')

    if not schedule or not command:
        return jsonify({'success': False, 'error': 'Schedule and command cannot be empty'})

    if not validate_cron_schedule(schedule):
        return jsonify({'success': False, 'error': 'Invalid cron expression'})

    raw = get_crontab_raw()
    # 新任务默认禁用
    new_line = f"#{schedule} {command}"

    if raw and not raw.endswith('\n'):
        raw += '\n'
    raw += new_line + '\n'

    success, error = save_crontab(raw, current_user.id)
    if success:
        log_action('add_task', {'schedule': schedule, 'command': command[:50], 'enabled': False})
    return jsonify({'success': success, 'error': error})


@app.route('/api/update/<int:task_id>', methods=['POST'])
@login_required
def update_task(task_id):
    """更新任务"""
    schedule = request.json.get('schedule', '')
    command = request.json.get('command', '')

    if not schedule or not command:
        return jsonify({'success': False, 'error': 'Schedule and command cannot be empty'})

    if not validate_cron_schedule(schedule):
        return jsonify({'success': False, 'error': 'Invalid cron expression'})

    raw = get_crontab_raw()
    lines = raw.split('\n')
    tasks = get_all_tasks()
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
    success, error = save_crontab(new_content, current_user.id)
    if success and old_task:
        log_action('update_task', {
            'task_id': task_id,
            'old_schedule': old_task['schedule'],
            'new_schedule': schedule,
            'command': command[:50]
        })
    return jsonify({'success': success, 'error': error})


@app.route('/api/update_task_name/<int:task_id>', methods=['POST'])
@login_required
def update_task_name(task_id):
    """更新任务名称"""
    new_name = request.json.get('name', '').strip()

    raw = get_crontab_raw()
    lines = raw.split('\n')
    tasks = get_all_tasks()
    target_task = find_task_by_id(task_id, tasks)

    if not target_task:
        return jsonify({'success': False, 'error': 'Task not found'})

    old_name = target_task.get('name', '')
    task_line = target_task['line']

    # 如果任务已有名称行
    if 'name_line' in target_task:
        name_line = target_task['name_line']
        if new_name:
            # 更新名称行（新规则：单 # 注释）
            lines[name_line] = f'# {new_name}'
        else:
            # 删除名称行
            lines[name_line] = None
    else:
        # 任务没有名称行
        if new_name:
            # 在任务行前插入名称行（新规则：单 # 注释）
            lines.insert(task_line, f'# {new_name}')

    # 过滤掉 None
    new_lines = [l for l in lines if l is not None]
    new_content = '\n'.join(new_lines)
    success, error = save_crontab(new_content, current_user.id)

    if success:
        log_action('update_task_name', {
            'task_id': task_id,
            'old_name': old_name,
            'new_name': new_name
        })
    return jsonify({'success': success, 'error': error})


@app.route('/api/run/<int:task_id>', methods=['POST'])
@login_required
def run_task(task_id):
    """手动运行任务"""
    tasks = get_all_tasks()
    target_task = find_task_by_id(task_id, tasks)
    if not target_task:
        return jsonify({'success': False, 'error': 'Task not found'})

    command = target_task['command']
    try:
        # 后台运行命令，不等待结果
        result = subprocess.Popen(
            command,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True
        )
        log_action('run_task', {'task_id': task_id, 'command': command[:50], 'pid': result.pid})
        return jsonify({'success': True, 'pid': result.pid, 'command': command[:50]})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/delete/<int:task_id>', methods=['POST'])
@login_required
def delete_task(task_id):
    """删除任务，如果是组内最后一个任务则同时删除组标题"""
    raw = get_crontab_raw()
    lines = raw.split('\n')
    groups = parse_crontab()
    deleted_task = None
    deleted_group_title = None

    # 找到任务所在的组，并删除任务
    for group in groups:
        for task in group['tasks']:
            if task['id'] == task_id:
                deleted_task = task
                lines[task['line']] = None
                # 同时删除任务名行（如果有）
                if 'name_line' in task:
                    lines[task['name_line']] = None
                # 如果是组内最后一个任务，同时删除组标题
                if len(group['tasks']) == 1:
                    deleted_group_title = group['title'] or f'Group {group["id"]}'
                    if group['title_line'] >= 0:
                        lines[group['title_line']] = None
                break
        if deleted_task:
            break

    new_lines = [l for l in lines if l is not None]
    new_content = '\n'.join(new_lines)
    success, error = save_crontab(new_content, current_user.id)
    if success and deleted_task:
        details = {'task_id': task_id, 'command': deleted_task['command'][:50]}
        if deleted_group_title:
            details['group_deleted'] = deleted_group_title
        log_action('delete_task', details)
    return jsonify({'success': success, 'error': error})


# ===== 任务组操作 API =====


@app.route('/api/toggle_group/<int:group_id>', methods=['POST'])
@login_required
def toggle_group(group_id):
    """启用/禁用整个任务组"""
    enable = request.json.get('enable', True)
    raw = get_crontab_raw()
    lines = raw.split('\n')
    groups = parse_crontab()
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
    success, error = save_crontab(new_content, current_user.id)
    if success:
        log_action('toggle_group', {'group_id': group_id, 'title': group_title, 'enable': enable})
    return jsonify({'success': success, 'error': error})


@app.route('/api/update_group_title/<int:group_id>', methods=['POST'])
@login_required
def update_group_title(group_id):
    """更新任务组名称"""
    new_title = request.json.get('title', '').strip()
    if not new_title:
        return jsonify({'success': False, 'error': 'Group name cannot be empty'})

    raw = get_crontab_raw()
    lines = raw.split('\n')
    groups = parse_crontab()
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
        return jsonify({'success': False, 'error': 'Task group not found'})

    new_content = '\n'.join(lines)
    success, error = save_crontab(new_content, current_user.id)
    if success:
        log_action('update_group_title', {'group_id': group_id, 'old_title': old_title, 'new_title': new_title})
    return jsonify({'success': success, 'error': error})


@app.route('/api/add_to_group/<int:group_id>', methods=['POST'])
@login_required
def add_task_to_group(group_id):
    """在指定组内添加新任务"""
    schedule = request.json.get('schedule', '')
    command = request.json.get('command', '')
    name = request.json.get('name', '').strip()  # 可选的任务名
    enabled = request.json.get('enabled', False)  # 新任务默认禁用

    if not schedule or not command:
        return jsonify({'success': False, 'error': 'Schedule and command cannot be empty'})

    if not validate_cron_schedule(schedule):
        return jsonify({'success': False, 'error': 'Invalid cron expression'})

    raw = get_crontab_raw()
    lines = raw.split('\n')
    groups = parse_crontab()
    group_title = None

    for group in groups:
        if group['id'] == group_id:
            group_title = group['title']
            if group['tasks']:
                last_task_line = group['tasks'][-1]['line']
                # 构建新行（任务名行 + 任务行）
                new_lines_to_insert = []
                if name:
                    new_lines_to_insert.append(f"# {name}")
                task_line = f"{schedule} {command}"
                if not enabled:
                    task_line = '#' + task_line
                new_lines_to_insert.append(task_line)
                # 逆序插入以保持顺序
                for i, line in enumerate(new_lines_to_insert):
                    lines.insert(last_task_line + 1 + i, line)
            break
    else:
        return jsonify({'success': False, 'error': 'Task group not found'})

    new_content = '\n'.join(lines)
    success, error = save_crontab(new_content, current_user.id)
    if success:
        details = {'group_id': group_id, 'group_title': group_title, 'schedule': schedule, 'command': command[:50]}
        if name:
            details['name'] = name
        log_action('add_to_group', details)
    return jsonify({'success': success, 'error': error})


@app.route('/api/create_group', methods=['POST'])
@login_required
def create_group():
    """创建新的任务组（仅包含组名称）"""
    title = request.json.get('title', '').strip()
    if not title:
        return jsonify({'success': False, 'error': 'Group name cannot be empty'})

    raw = get_crontab_raw()

    if raw and not raw.endswith('\n'):
        raw += '\n'
    if raw.strip():
        raw += '\n'
    raw += f"# {title}\n"
    raw += "#* * * * * echo 'placeholder - please edit'\n"

    success, error = save_crontab(raw, current_user.id)
    if success:
        log_action('create_group', {'title': title})
    return jsonify({'success': success, 'error': error})


@app.route('/api/delete_group/<int:group_id>', methods=['POST'])
@login_required
def delete_group(group_id):
    """删除整个任务组"""
    raw = get_crontab_raw()
    lines = raw.split('\n')
    groups = parse_crontab()
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
        return jsonify({'success': False, 'error': 'Task group not found'})

    new_lines = [l for l in lines if l is not None]
    new_content = '\n'.join(new_lines)
    success, error = save_crontab(new_content, current_user.id)
    if success:
        log_action('delete_group', {'group_id': group_id, 'title': deleted_title})
    return jsonify({'success': success, 'error': error})


# ===== 排序 API =====


@app.route('/api/reorder_groups', methods=['POST'])
@login_required
def reorder_groups():
    """重新排序任务组"""
    from_id = request.json.get('from_id')
    to_id = request.json.get('to_id')
    insert_before = request.json.get('insert_before', True)  # 默认插入到目标之前

    if from_id is None or to_id is None:
        return jsonify({'success': False, 'error': 'Invalid parameters'})

    raw = get_crontab_raw()
    lines = raw.split('\n')
    groups = parse_crontab()

    # 找到两个组
    from_group = None
    to_group = None
    for g in groups:
        if g['id'] == from_id:
            from_group = g
        if g['id'] == to_id:
            to_group = g

    if not from_group or not to_group:
        return jsonify({'success': False, 'error': 'Group not found'})

    # 收集 from_group 的所有行（包括标题和任务）
    from_lines = []
    if from_group['title_line'] >= 0:
        from_lines.append((from_group['title_line'], lines[from_group['title_line']]))
    for task in from_group['tasks']:
        from_lines.append((task['line'], lines[task['line']]))
    from_lines.sort(key=lambda x: x[0])

    # 标记要移动的行为 None
    for line_num, _ in from_lines:
        lines[line_num] = None

    # 找到 to_group 的插入位置
    if insert_before:
        # 插入到 to_group 之前
        if to_group['title_line'] >= 0:
            insert_pos = to_group['title_line']
        elif to_group['tasks']:
            insert_pos = to_group['tasks'][0]['line']
        else:
            insert_pos = 0
    else:
        # 插入到 to_group 之后
        if to_group['tasks']:
            insert_pos = to_group['tasks'][-1]['line'] + 1
        elif to_group['title_line'] >= 0:
            insert_pos = to_group['title_line'] + 1
        else:
            insert_pos = len(lines)

    # 调整插入位置（因为移除了一些行）
    removed_before = sum(1 for ln, _ in from_lines if ln < insert_pos)
    insert_pos -= removed_before

    # 过滤掉标记为 None 的行
    new_lines = [l for l in lines if l is not None]

    # 确保插入位置不超出范围
    insert_pos = min(insert_pos, len(new_lines))

    # 在目标位置插入 from_group 的行
    for i, (_, content) in enumerate(from_lines):
        new_lines.insert(insert_pos + i, content)

    # 确保组之间有空行分隔
    # 在插入的组前后添加空行（如果需要）
    insert_end = insert_pos + len(from_lines)

    # 在组后添加空行（如果后面有内容且不是空行）
    if insert_end < len(new_lines) and new_lines[insert_end].strip():
        new_lines.insert(insert_end, '')

    # 在组前添加空行（如果前面有内容且不是空行）
    if insert_pos > 0 and new_lines[insert_pos - 1].strip():
        new_lines.insert(insert_pos, '')

    new_content = '\n'.join(new_lines)
    success, error = save_crontab(new_content, current_user.id)
    if success:
        log_action('reorder_group', {
            'group_id': from_id,
            'title': from_group.get('title', ''),
            'to_group_id': to_id
        })
    return jsonify({'success': success, 'error': error})


@app.route('/api/move_task_to_end', methods=['POST'])
@login_required
def move_task_to_end():
    """将任务移动到指定组的末尾"""
    task_id = request.json.get('task_id')
    from_group_id = request.json.get('from_group_id')
    to_group_id = request.json.get('to_group_id')

    if None in [task_id, from_group_id, to_group_id]:
        return jsonify({'success': False, 'error': 'Invalid parameters'})

    raw = get_crontab_raw()
    lines = raw.split('\n')
    tasks = get_all_tasks()
    groups = parse_crontab()

    # 找到要移动的任务
    from_task = None
    for t in tasks:
        if t['id'] == task_id:
            from_task = t
            break

    if not from_task:
        return jsonify({'success': False, 'error': 'Task not found'})

    # 找到目标组
    to_group = None
    for g in groups:
        if g['id'] == to_group_id:
            to_group = g
            break

    if not to_group:
        return jsonify({'success': False, 'error': 'Target group not found'})

    # 获取要移动的行内容
    from_line = from_task['line']
    content = lines[from_line]

    # 移除原位置的行
    lines[from_line] = None

    # 过滤掉标记为 None 的行
    new_lines = [l for l in lines if l is not None]

    # 计算目标组的末尾位置
    # 需要重新解析，因为行号可能已经变化
    if to_group['tasks']:
        # 找到目标组最后一个任务的原始行号
        last_task_line = to_group['tasks'][-1]['line']
        # 计算移除后的新位置
        if from_line < last_task_line:
            insert_pos = last_task_line  # 移除了前面的行，位置减1后再+1等于原位置
        else:
            insert_pos = last_task_line + 1
        insert_pos = min(insert_pos, len(new_lines))
    else:
        # 目标组没有任务，插入到标题行后面
        if to_group['title_line'] >= 0:
            insert_pos = to_group['title_line']
            if from_line < to_group['title_line']:
                insert_pos -= 1
            insert_pos += 1
        else:
            insert_pos = len(new_lines)

    # 在目标位置插入
    new_lines.insert(insert_pos, content)

    new_content = '\n'.join(new_lines)
    success, error = save_crontab(new_content, current_user.id)
    if success:
        log_action('move_task_to_end', {
            'task_id': task_id,
            'from_group': from_group_id,
            'to_group': to_group_id,
            'command': from_task['command'][:50]
        })
    return jsonify({'success': success, 'error': error})


@app.route('/api/reorder_tasks', methods=['POST'])
@login_required
def reorder_tasks():
    """重新排序任务（组内或跨组）"""
    from_task_id = request.json.get('from_task_id')
    from_group_id = request.json.get('from_group_id')
    to_task_id = request.json.get('to_task_id')
    to_group_id = request.json.get('to_group_id')
    insert_before = request.json.get('insert_before', True)  # 默认插入到目标之前

    if None in [from_task_id, from_group_id, to_task_id, to_group_id]:
        return jsonify({'success': False, 'error': 'Invalid parameters'})

    raw = get_crontab_raw()
    lines = raw.split('\n')
    tasks = get_all_tasks()

    # 找到两个任务
    from_task = None
    to_task = None
    for t in tasks:
        if t['id'] == from_task_id:
            from_task = t
        if t['id'] == to_task_id:
            to_task = t

    if not from_task or not to_task:
        return jsonify({'success': False, 'error': 'Task not found'})

    # 获取要移动的行内容（包括任务名行）
    from_line = from_task['line']
    to_line = to_task['line']
    task_content = lines[from_line]

    # 检查是否有任务名行需要一起移动
    lines_to_move = []
    lines_to_remove = [from_line]
    if 'name_line' in from_task:
        name_line = from_task['name_line']
        lines_to_move.append(lines[name_line])
        lines_to_remove.append(name_line)
    lines_to_move.append(task_content)

    # 移除原位置的行（标记为 None）
    for ln in lines_to_remove:
        lines[ln] = None

    # 确定目标参考行（如果目标任务有任务名行且是插入到之前，需要用任务名行作为参考）
    if insert_before and 'name_line' in to_task:
        target_line = to_task['name_line']
    else:
        target_line = to_line

    # 计算需要移除的行数（用于调整目标位置）
    removed_before_target = sum(1 for ln in lines_to_remove if ln < target_line)

    # 计算目标位置
    if insert_before:
        insert_pos = target_line - removed_before_target
    else:
        insert_pos = target_line - removed_before_target + 1

    # 过滤掉标记为 None 的行
    new_lines = [l for l in lines if l is not None]

    # 调整插入位置确保不越界
    insert_pos = max(0, min(insert_pos, len(new_lines)))

    # 在目标位置插入所有要移动的行
    for i, content in enumerate(lines_to_move):
        new_lines.insert(insert_pos + i, content)

    new_content = '\n'.join(new_lines)
    success, error = save_crontab(new_content, current_user.id)
    if success:
        log_action('reorder_task', {
            'task_id': from_task_id,
            'from_group': from_group_id,
            'to_group': to_group_id,
            'command': from_task['command'][:50]
        })
    return jsonify({'success': success, 'error': error})


if __name__ == '__main__':
    import os
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    app.run(host='0.0.0.0', port=5100, debug=debug)
