// mock.js - Mock API 层，拦截所有 API 调用返回演示数据
// 必须在 app.js 之前加载，且立即执行

// 立即覆盖 fetch（在 app.js 保存 nativeFetch 之前）
(function() {
    'use strict';

    // ========== Mock 数据 ==========
    const MOCK_DATA = {
        machines: {
            local: { name: "本机", type: "local", linux_users: ["root", "www-data"] },
            "prod-server": { name: "生产服务器", type: "ssh", linux_users: ["root", "deploy"] }
        },

        groups: [
            {
                id: 1,
                title: "系统维护",
                tasks: [
                    { id: 1, name: "清理临时文件", schedule: "0 3 * * *", command: "/usr/local/bin/cleanup.sh", enabled: true },
                    { id: 2, name: "系统日志轮转", schedule: "0 0 * * 0", command: "/usr/sbin/logrotate /etc/logrotate.conf", enabled: true },
                    { id: 3, name: "磁盘空间检查", schedule: "*/30 * * * *", command: "/scripts/check-disk.sh", enabled: false }
                ]
            },
            {
                id: 2,
                title: "数据备份",
                tasks: [
                    { id: 4, name: "数据库备份", schedule: "0 2 * * *", command: "/backup/mysql-backup.sh", enabled: true },
                    { id: 5, name: "文件备份", schedule: "0 4 * * *", command: "rsync -avz /data /backup/", enabled: true }
                ]
            },
            {
                id: 3,
                title: "监控任务",
                tasks: [
                    { id: 6, name: "服务健康检查", schedule: "*/5 * * * *", command: "/monitor/health-check.sh", enabled: true },
                    { id: 7, name: "性能数据采集", schedule: "* * * * *", command: "/monitor/collect-metrics.sh", enabled: true },
                    { id: 8, name: "告警通知", schedule: "*/10 * * * *", command: "/monitor/send-alerts.py", enabled: true }
                ]
            },
            {
                id: 4,
                title: "应用任务",
                tasks: [
                    { id: 9, name: "缓存预热", schedule: "0 6 * * *", command: "/app/warm-cache.sh", enabled: true },
                    { id: 10, name: "报表生成", schedule: "0 8 * * 1-5", command: "/app/generate-reports.py", enabled: false },
                    { id: 11, name: "数据同步", schedule: "0 */2 * * *", command: "/app/sync-data.sh", enabled: true }
                ]
            }
        ],

        // pending at jobs (for /api/at_jobs)
        atJobsPending: [
            { job_id: "101", command: "echo 'Task completed' | mail -s 'Notification' admin@example.com", datetime: "2024-01-28 15:30:00", queue: "a" },
            { job_id: "102", command: "/scripts/send-report.sh", datetime: "2024-01-28 18:00:00", queue: "a" }
        ],
        // history at jobs (for /api/at_history)
        atJobsHistory: [
            { id: "h1", command: "/scripts/one-time-migration.sh", scheduled_time: "2024-01-28 02:00:00", executed_at: "2024-01-28 02:00:01", status: "executed" },
            { id: "h2", command: "systemctl restart nginx", scheduled_time: "2024-01-27 23:00:00", executed_at: null, status: "cancelled" },
            { id: "h3", command: "/backup/full-backup.sh", scheduled_time: "2024-01-27 03:00:00", executed_at: "2024-01-27 03:00:02", status: "executed" }
        ],

        templates: [
            { id: "tpl1", name: "发送通知", command: "echo 'Done' | mail admin@example.com", time_mode: "relative", time_value: 5, time_unit: "minutes" },
            { id: "tpl2", name: "重启服务", command: "systemctl restart nginx", time_mode: "relative", time_value: 1, time_unit: "hours" }
        ],

        auditLogs: [
            { time: "2024-01-28 14:32:15", user: "admin", action: "edit_task", details: "Modified task: 数据库备份", machine: "local", linux_user: "root" },
            { time: "2024-01-28 14:30:00", user: "admin", action: "toggle_task", details: "Disabled task: 报表生成", machine: "local", linux_user: "root" },
            { time: "2024-01-28 14:25:33", user: "editor", action: "create_task", details: "Created task: 性能数据采集", machine: "local", linux_user: "root" },
            { time: "2024-01-28 14:20:00", user: "admin", action: "create_group", details: "Created group: 监控任务", machine: "local", linux_user: "root" },
            { time: "2024-01-28 14:15:00", user: "admin", action: "login", details: "User logged in", machine: "-", linux_user: "-" }
        ],

        // Cron logs 是字符串数组
        cronLogs: [
            "Jan 28 14:30:01 localhost CRON[12345]: (root) CMD (/monitor/health-check.sh)",
            "Jan 28 14:25:01 localhost CRON[12340]: (root) CMD (/monitor/collect-metrics.sh)",
            "Jan 28 14:20:01 localhost CRON[12335]: (root) CMD (/monitor/collect-metrics.sh)",
            "Jan 28 14:15:01 localhost CRON[12330]: (root) CMD (/monitor/health-check.sh)",
            "Jan 28 14:10:01 localhost CRON[12325]: (root) CMD (/monitor/send-alerts.py)",
            "Jan 28 14:05:01 localhost CRON[12320]: (root) CMD (/backup/mysql-backup.sh)",
            "Jan 28 14:00:01 localhost CRON[12315]: (root) CMD (/app/sync-data.sh)",
            "Jan 28 13:55:01 localhost CRON[12310]: (root) CMD (/monitor/health-check.sh)",
            "Jan 28 13:50:01 localhost CRON[12305]: (root) CMD (/monitor/collect-metrics.sh)"
        ],

        history: [
            { filename: "crontab_20240128_143000.bak", time: "2024-01-28 14:30:00", size: 1024 },
            { filename: "crontab_20240128_142500.bak", time: "2024-01-28 14:25:00", size: 980 },
            { filename: "crontab_20240128_142000.bak", time: "2024-01-28 14:20:00", size: 920 }
        ],

        users: [
            { username: "admin", role: "admin", machines: ["*"] },
            { username: "editor", role: "editor", machines: ["local"] },
            { username: "viewer", role: "viewer", machines: ["*"] }
        ],

        rawCrontab: `# 系统维护
# 清理临时文件
0 3 * * * /usr/local/bin/cleanup.sh
# 系统日志轮转
0 0 * * 0 /usr/sbin/logrotate /etc/logrotate.conf
# 磁盘空间检查
#*/30 * * * * /scripts/check-disk.sh

# 数据备份
# 数据库备份
0 2 * * * /backup/mysql-backup.sh
# 文件备份
0 4 * * * rsync -avz /data /backup/

# 监控任务
# 服务健康检查
*/5 * * * * /monitor/health-check.sh
# 性能数据采集
* * * * * /monitor/collect-metrics.sh
# 告警通知
*/10 * * * * /monitor/send-alerts.py

# 应用任务
# 缓存预热
0 6 * * * /app/warm-cache.sh
# 报表生成
#0 8 * * 1-5 /app/generate-reports.py
# 数据同步
0 */2 * * * /app/sync-data.sh
`
    };

    // 深拷贝
    function deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    // Mock fetch 函数
    function mockFetch(url, options = {}) {
        const method = (options.method || 'GET').toUpperCase();
        const path = url.split('?')[0];

        console.log('[Mock]', method, path);

        // 处理各种 API 路径
        let result = null;

        // /api/machines
        if (path === '/api/machines') {
            result = {
                machines: MOCK_DATA.machines,
                current: 'local',
                current_linux_user: 'root'
            };
        }
        // /api/tasks/{machine}/{user} - 直接返回 groups 数组
        else if (path.match(/^\/api\/tasks\//)) {
            result = deepClone(MOCK_DATA.groups);
        }
        // /api/backups/{machine}/{user}
        else if (path.match(/^\/api\/backups\//)) {
            result = {
                backups: MOCK_DATA.history,
                current: MOCK_DATA.rawCrontab
            };
        }
        // /api/backup/{machine}/{user}/{filename}
        else if (path.match(/^\/api\/backup\//)) {
            result = {
                content: MOCK_DATA.rawCrontab.replace('cleanup.sh', 'old-cleanup.sh')
            };
        }
        // /api/raw/{machine}/{user}
        else if (path.match(/^\/api\/raw\//)) {
            result = {
                content: MOCK_DATA.rawCrontab
            };
        }
        // /api/toggle/{taskId}
        else if (path.match(/^\/api\/toggle\//)) {
            result = { success: true };
        }
        // /api/toggle_group/{groupId}
        else if (path.match(/^\/api\/toggle_group\//)) {
            result = { success: true };
        }
        // /api/delete/{taskId}
        else if (path.match(/^\/api\/delete\//)) {
            result = { success: true };
        }
        // /api/delete_group/{groupId}
        else if (path.match(/^\/api\/delete_group\//)) {
            result = { success: true };
        }
        // /api/update/{taskId}
        else if (path.match(/^\/api\/update\//)) {
            result = { success: true };
        }
        // /api/update_task_name/{taskId}
        else if (path.match(/^\/api\/update_task_name\//)) {
            result = { success: true };
        }
        // /api/update_group_title/{groupId}
        else if (path.match(/^\/api\/update_group_title\//)) {
            result = { success: true };
        }
        // /api/run/{taskId}
        else if (path.match(/^\/api\/run\//)) {
            result = { success: true, message: 'Task started (demo mode)' };
        }
        // /api/add_to_group/{groupId}
        else if (path.match(/^\/api\/add_to_group\//)) {
            result = { success: true, task_id: 'new-' + Date.now() };
        }
        // /api/create_group
        else if (path === '/api/create_group') {
            result = { success: true, group_id: 'new-g-' + Date.now() };
        }
        // /api/restore/{machine}/{user}/{filename}
        else if (path.match(/^\/api\/restore\//)) {
            result = { success: true };
        }
        // /api/save
        else if (path === '/api/save') {
            result = { success: true };
        }
        // /api/audit_logs/{machine}
        else if (path.match(/^\/api\/audit_logs\//)) {
            result = {
                logs: MOCK_DATA.auditLogs,
                total: MOCK_DATA.auditLogs.length,
                page: 1,
                per_page: 50
            };
        }
        // /api/cron_logs/{machine}
        else if (path.match(/^\/api\/cron_logs\//)) {
            result = {
                logs: MOCK_DATA.cronLogs,
                source: '/var/log/syslog',
                total: MOCK_DATA.cronLogs.length
            };
        }
        // /api/at_jobs/{machine}/{user} - pending jobs
        else if (path.match(/^\/api\/at_jobs\//)) {
            result = {
                success: true,
                jobs: deepClone(MOCK_DATA.atJobsPending)
            };
        }
        // /api/at_history/{machine}/{user} - history jobs
        else if (path.match(/^\/api\/at_history\//)) {
            result = {
                success: true,
                history: deepClone(MOCK_DATA.atJobsHistory),
                total_pages: 1,
                page: 1
            };
        }
        // /api/at_templates (no machine/user path)
        else if (path === '/api/at_templates' || path.match(/^\/api\/at_templates\//)) {
            result = {
                success: true,
                templates: deepClone(MOCK_DATA.templates)
            };
        }
        // /api/at/create
        else if (path.match(/^\/api\/at\/create/) || path.match(/^\/api\/at_create\//)) {
            result = { success: true, job_id: 'new-at-' + Date.now() };
        }
        // /api/at/cancel or /api/at_cancel
        else if (path.match(/^\/api\/at\/cancel/) || path.match(/^\/api\/at_cancel\//)) {
            result = { success: true };
        }
        // /api/at_cleanup
        else if (path.match(/^\/api\/at_cleanup\//)) {
            result = { success: true, deleted: 2 };
        }
        // /api/at_template (save/delete)
        else if (path.match(/^\/api\/at_template/)) {
            result = { success: true };
        }
        // /api/users
        else if (path === '/api/users') {
            result = { users: MOCK_DATA.users };
        }
        // /api/users/{username}
        else if (path.match(/^\/api\/users\//)) {
            result = { success: true };
        }
        // /api/machine/{machine}/status
        else if (path.match(/^\/api\/machine\/.*\/status/)) {
            result = { success: true, connected: true };
        }
        // /api/reorder_groups
        else if (path === '/api/reorder_groups') {
            result = { success: true };
        }
        // /api/reorder_tasks
        else if (path === '/api/reorder_tasks') {
            result = { success: true };
        }
        // /api/move_task_to_end
        else if (path === '/api/move_task_to_end') {
            result = { success: true };
        }
        // 默认响应
        else {
            console.log('[Mock] Unhandled:', method, path);
            result = { success: true };
        }

        // 返回 Promise
        return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(result),
            text: () => Promise.resolve(JSON.stringify(result))
        });
    }

    // 立即覆盖 window.fetch
    window.fetch = mockFetch;

    console.log('[Mock] API mock layer initialized - fetch replaced');

    // 页面加载后显示提示
    window.addEventListener('DOMContentLoaded', function() {
        setTimeout(function() {
            if (typeof showMessage === 'function') {
                showMessage('Demo mode - changes will not be saved', 'info');
            }
        }, 1500);
    });
})();
