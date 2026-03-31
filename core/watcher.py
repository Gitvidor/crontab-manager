# core/watcher.py - 后台监控线程
# 功能: crontab 变化检测线程 + at 历史检测线程

import time
import threading
from core import config
from core.crontab import check_single_crontab
from core.at_jobs import check_at_done_files, cleanup_at_history


def start_crontab_watcher():
    """启动后台线程定时检测 crontab 变化"""
    def watch_loop():
        while True:
            try:
                for machine_id, machine_config in config.MACHINES.items():
                    users = machine_config.get('linux_users', [config.DEFAULT_LINUX_USER])
                    for linux_user in users:
                        check_single_crontab(machine_id, linux_user)
            except Exception as e:
                print(f"[crontab-watch] Error: {e}")
            time.sleep(60)

    thread = threading.Thread(target=watch_loop, daemon=True, name='crontab-watcher')
    thread.start()
    print("[crontab-watch] Watcher thread started")


def start_at_history_watcher():
    """启动历史检测后台线程"""
    def watch_loop():
        cleanup_counter = 0
        while True:
            time.sleep(30)
            try:
                check_at_done_files()
                cleanup_counter += 1
                if cleanup_counter >= 120:
                    cleanup_at_history()
                    cleanup_counter = 0
            except Exception:
                pass

    thread = threading.Thread(target=watch_loop, daemon=True, name='at-history-watcher')
    thread.start()


def start_watchers():
    """启动所有后台监控线程"""
    start_crontab_watcher()
    start_at_history_watcher()
