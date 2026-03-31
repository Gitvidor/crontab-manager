# core/at_jobs.py - At 任务历史与模板管理
# 功能: At 任务历史记录的 CRUD、模板管理、完成检测
# 数据: at_history.json (历史), templates.json (模板)

import os
import json
import re
import secrets
import threading
from datetime import datetime

from core import config

_at_history_lock = threading.Lock()


# ===== 模板管理 =====


def load_templates():
    """加载模板文件"""
    if os.path.exists(config.TEMPLATES_FILE):
        with open(config.TEMPLATES_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {"version": 1, "templates": []}


def save_templates(data):
    """保存模板文件"""
    with open(config.TEMPLATES_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def generate_template_id():
    """生成唯一模板 ID"""
    timestamp = int(datetime.now().timestamp())
    random_part = secrets.token_hex(3)
    return f"tpl_{timestamp}_{random_part}"


# ===== 历史记录管理 =====


def generate_history_id():
    """生成唯一历史记录 ID"""
    timestamp = int(datetime.now().timestamp())
    random_part = secrets.token_hex(3)
    return f"ath_{timestamp}_{random_part}"


def load_at_history():
    """加载历史数据"""
    if os.path.exists(config.AT_HISTORY_FILE):
        try:
            with open(config.AT_HISTORY_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {"version": 1, "history": [], "pending": {}}


def save_at_history(data):
    """保存历史数据"""
    with open(config.AT_HISTORY_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def mark_history_executed(history_id: str, exit_code: int = None):
    """标记历史记录为已执行"""
    with _at_history_lock:
        data = load_at_history()
        for record in data['history']:
            if record['id'] == history_id:
                record['status'] = 'executed'
                record['executed_at'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                record['exit_code'] = exit_code
                machine_id = record.get('machine_id', 'local')
                job_id = record.get('job_id')
                if machine_id in data['pending'] and job_id in data['pending'][machine_id]:
                    del data['pending'][machine_id][job_id]
                save_at_history(data)
                return True
        return False


def mark_history_cancelled(job_id: str, machine_id: str):
    """标记历史记录为已取消"""
    with _at_history_lock:
        data = load_at_history()
        if machine_id in data['pending'] and job_id in data['pending'][machine_id]:
            history_id = data['pending'][machine_id][job_id]
            for record in data['history']:
                if record['id'] == history_id:
                    record['status'] = 'cancelled'
                    record['executed_at'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                    break
            del data['pending'][machine_id][job_id]
            save_at_history(data)
            return True
        return False


def wrap_command_for_history(command: str, history_id: str) -> str:
    """包装命令以捕获退出码"""
    done_file = f"{config.AT_DONE_PREFIX}{history_id}"
    return f"({command}; echo $? > {done_file}) 2>&1"


def cleanup_at_history():
    """清理过期历史记录"""
    with _at_history_lock:
        data = load_at_history()
        cutoff = datetime.now().timestamp() - config.AT_HISTORY_RETENTION_DAYS * 86400
        original_len = len(data['history'])
        data['history'] = [
            r for r in data['history']
            if datetime.strptime(r['created_at'], '%Y-%m-%d %H:%M:%S').timestamp() > cutoff
        ]
        if len(data['history']) < original_len:
            save_at_history(data)
            return original_len - len(data['history'])
        return 0


def check_at_done_files():
    """检查完成标记文件并更新历史状态"""
    from core.crontab import get_machine_executor

    with _at_history_lock:
        data = load_at_history()
        updated = False
        for machine_id, pending_jobs in list(data['pending'].items()):
            try:
                executor = get_machine_executor(machine_id)
                for job_id, history_id in list(pending_jobs.items()):
                    done_file = f"{config.AT_DONE_PREFIX}{history_id}"
                    returncode, stdout, _ = executor.run_command(
                        f'cat {done_file} 2>/dev/null && rm -f {done_file}'
                    )
                    if returncode == 0 and stdout.strip():
                        try:
                            exit_code = int(stdout.strip())
                        except ValueError:
                            exit_code = None
                        for record in data['history']:
                            if record['id'] == history_id:
                                record['status'] = 'executed'
                                record['executed_at'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                                record['exit_code'] = exit_code
                                break
                        del pending_jobs[job_id]
                        updated = True
            except Exception:
                pass
        if updated:
            save_at_history(data)


def parse_atq_output(output: str) -> list:
    """解析 atq 命令输出"""
    jobs = []
    for line in output.strip().split('\n'):
        if not line.strip():
            continue
        parts = line.split()
        if len(parts) >= 8:
            job_id = parts[0]
            weekday, month, day, time_str, year = parts[1:6]
            queue = parts[6]
            user = parts[7]
            try:
                dt_str = f"{weekday} {month} {day} {time_str} {year}"
                dt = datetime.strptime(dt_str, '%a %b %d %H:%M:%S %Y')
                formatted_dt = dt.strftime('%Y-%m-%d %H:%M:%S')
            except ValueError:
                formatted_dt = f"{year}-{month}-{day} {time_str}"
            jobs.append({
                'job_id': job_id,
                'datetime': formatted_dt,
                'queue': queue,
                'user': user
            })
    return jobs


def extract_command_from_at_content(content: str) -> str:
    """从 at -c 输出中提取实际命令"""
    lines = content.strip().split('\n')
    command_lines = []
    for line in reversed(lines):
        if line.startswith('${') or not line.strip():
            continue
        command_lines.insert(0, line)
        if line.startswith('cd '):
            break
        if len(command_lines) >= 5:
            break
    return '\n'.join(command_lines) if command_lines else content[-500:]
