/**
 * mock.js - Crontab Manager Demo 数据模拟层
 *
 * 功能：拦截 fetch API，返回模拟数据，支持交互操作
 * 注意：必须在 app.js 之前加载
 */

(function() {
    'use strict';

    // ==================== 模拟数据（可交互状态） ====================

    const state = {
        groups: [
            {
                id: 1, title: "系统维护",
                tasks: [
                    { id: 1, name: "清理临时文件", schedule: "0 3 * * *", command: "/usr/local/bin/cleanup.sh", enabled: true },
                    { id: 2, name: "系统日志轮转", schedule: "0 0 * * 0", command: "/usr/sbin/logrotate /etc/logrotate.conf", enabled: true },
                    { id: 3, name: "磁盘空间检查", schedule: "*/30 * * * *", command: "/scripts/check-disk.sh", enabled: false }
                ]
            },
            {
                id: 2, title: "数据备份",
                tasks: [
                    { id: 4, name: "数据库备份", schedule: "0 2 * * *", command: "/backup/mysql-backup.sh", enabled: true },
                    { id: 5, name: "文件备份", schedule: "0 4 * * *", command: "rsync -avz /data /backup/", enabled: true }
                ]
            },
            {
                id: 3, title: "监控任务",
                tasks: [
                    { id: 6, name: "服务健康检查", schedule: "*/5 * * * *", command: "/monitor/health-check.sh", enabled: true },
                    { id: 7, name: "性能数据采集", schedule: "* * * * *", command: "/monitor/collect-metrics.sh", enabled: true },
                    { id: 8, name: "告警通知", schedule: "*/10 * * * *", command: "/monitor/send-alerts.py", enabled: true }
                ]
            },
            {
                id: 4, title: "应用任务",
                tasks: [
                    { id: 9, name: "缓存预热", schedule: "0 6 * * *", command: "/app/warm-cache.sh", enabled: true },
                    { id: 10, name: "报表生成", schedule: "0 8 * * 1-5", command: "/app/generate-reports.py", enabled: false },
                    { id: 11, name: "数据同步", schedule: "0 */2 * * *", command: "/app/sync-data.sh", enabled: true }
                ]
            }
        ],

        atJobsPending: [
            { job_id: "101", command: "echo 'Done' | mail admin@example.com", datetime: "2024-01-28 15:30:00", queue: "a" },
            { job_id: "102", command: "/scripts/send-report.sh", datetime: "2024-01-28 18:00:00", queue: "a" }
        ],

        atJobsHistory: [
            { id: "h1", command: "/scripts/migration.sh", scheduled_time: "2024-01-28 02:00:00", executed_at: "2024-01-28 02:00:01", status: "executed" },
            { id: "h2", command: "systemctl restart nginx", scheduled_time: "2024-01-27 23:00:00", executed_at: null, status: "cancelled" },
            { id: "h3", command: "/backup/full-backup.sh", scheduled_time: "2024-01-27 03:00:00", executed_at: "2024-01-27 03:00:02", status: "executed" }
        ],

        templates: [
            { id: 1, name: "发送通知", command: "echo 'Done' | mail admin@example.com", default_time: { mode: "relative", value: 5, unit: "minutes" } },
            { id: 2, name: "重启服务", command: "systemctl restart nginx", default_time: { mode: "relative", value: 1, unit: "hours" } }
        ],

        nextId: { task: 100, group: 100, template: 100, atJob: 200 }
    };

    // 静态数据（只读）
    const staticData = {
        machines: {
            local: { name: "本机", type: "local", linux_users: ["root", "www-data"] },
            "prod-server": { name: "生产服务器", type: "ssh", linux_users: ["root", "deploy"] }
        },

        cronLogs: [
            "Jan 28 14:30:01 localhost CRON[12345]: (root) CMD (/monitor/health-check.sh)",
            "Jan 28 14:25:01 localhost CRON[12340]: (root) CMD (/monitor/collect-metrics.sh)",
            "Jan 28 14:20:01 localhost CRON[12335]: (root) CMD (/monitor/collect-metrics.sh)",
            "Jan 28 14:15:01 localhost CRON[12330]: (root) CMD (/monitor/health-check.sh)",
            "Jan 28 14:10:01 localhost CRON[12325]: (root) CMD (/monitor/send-alerts.py)",
            "Jan 28 14:05:01 localhost CRON[12320]: (root) CMD (/backup/mysql-backup.sh)",
            "Jan 28 14:00:01 localhost CRON[12315]: (root) CMD (/app/sync-data.sh)"
        ],

        auditLogs: [
            { time: "2024-01-28 14:32:15", user: "admin", action: "edit_task", details: "Modified: 数据库备份" },
            { time: "2024-01-28 14:30:00", user: "admin", action: "toggle_task", details: "Disabled: 报表生成" },
            { time: "2024-01-28 14:25:33", user: "editor", action: "create_task", details: "Created: 性能数据采集" },
            { time: "2024-01-28 14:20:00", user: "admin", action: "create_group", details: "Created group: 监控任务" },
            { time: "2024-01-28 14:15:00", user: "admin", action: "login", details: "User logged in" }
        ],

        users: [
            { username: "admin", role: "admin", machines: ["*"] },
            { username: "editor", role: "editor", machines: ["local"] },
            { username: "viewer", role: "viewer", machines: ["*"] }
        ],

        history: [
            { filename: "crontab_20240128_143000.bak", time: "2024-01-28 14:30:00", size: 1024 },
            { filename: "crontab_20240128_142500.bak", time: "2024-01-28 14:25:00", size: 980 },
            { filename: "crontab_20240128_142000.bak", time: "2024-01-28 14:20:00", size: 920 }
        ]
    };

    // ==================== 工具函数 ====================

    const clone = obj => JSON.parse(JSON.stringify(obj));
    const findTask = (taskId) => {
        for (const g of state.groups) {
            const t = g.tasks.find(t => t.id === taskId);
            if (t) return { group: g, task: t };
        }
        return null;
    };

    // 生成 raw crontab 内容
    function generateRawCrontab() {
        return state.groups.map(g => {
            const lines = [`# ${g.title}`];
            g.tasks.forEach(t => {
                if (t.name) lines.push(`# ${t.name}`);
                lines.push((t.enabled ? '' : '#') + t.schedule + ' ' + t.command);
            });
            return lines.join('\n');
        }).join('\n\n') + '\n';
    }

    // ==================== API 路由处理 ====================

    const routes = {
        // 机器管理
        'GET /api/machines': () => ({
            machines: staticData.machines,
            current: 'local',
            current_linux_user: 'root'
        }),

        'GET /api/machine/*/status': () => ({ success: true, connected: true }),

        // Cron 任务
        'GET /api/tasks/*': () => clone(state.groups),

        'POST /api/toggle/*': (body, path) => {
            const taskId = parseInt(path.split('/').pop());
            const found = findTask(taskId);
            if (found) found.task.enabled = !found.task.enabled;
            return { success: true };
        },

        'POST /api/toggle_group/*': (body) => {
            const group = state.groups.find(g => g.id === body.group_id);
            if (group) group.tasks.forEach(t => t.enabled = body.enable);
            return { success: true };
        },

        'POST /api/update/*': (body, path) => {
            const taskId = parseInt(path.split('/')[3]);
            const found = findTask(taskId);
            if (found) Object.assign(found.task, body);
            return { success: true };
        },

        'POST /api/update_task_name/*': (body, path) => {
            const taskId = parseInt(path.split('/')[3]);
            const found = findTask(taskId);
            if (found) found.task.name = body.name;
            return { success: true };
        },

        'POST /api/update_group_title/*': (body, path) => {
            const groupId = parseInt(path.split('/')[3]);
            const group = state.groups.find(g => g.id === groupId);
            if (group) group.title = body.title;
            return { success: true };
        },

        'DELETE /api/delete/*': (body, path) => {
            const taskId = parseInt(path.split('/').pop());
            for (const g of state.groups) {
                const idx = g.tasks.findIndex(t => t.id === taskId);
                if (idx >= 0) { g.tasks.splice(idx, 1); break; }
            }
            return { success: true };
        },

        'DELETE /api/delete_group/*': (body, path) => {
            const groupId = parseInt(path.split('/').pop());
            const idx = state.groups.findIndex(g => g.id === groupId);
            if (idx >= 0) state.groups.splice(idx, 1);
            return { success: true };
        },

        'POST /api/add_to_group/*': (body, path) => {
            const groupId = parseInt(path.split('/').pop());
            const group = state.groups.find(g => g.id === groupId);
            const newId = state.nextId.task++;
            if (group) {
                group.tasks.push({
                    id: newId,
                    name: body.name || '',
                    schedule: `${body.minute} ${body.hour} ${body.day} ${body.month} ${body.weekday}`,
                    command: body.command,
                    enabled: true
                });
            }
            return { success: true, task_id: newId };
        },

        'POST /api/create_group': (body) => {
            const newId = state.nextId.group++;
            state.groups.push({ id: newId, title: body.title || 'New Group', tasks: [] });
            return { success: true, group_id: newId };
        },

        'POST /api/run/*': () => ({ success: true, message: 'Task started (demo)' }),
        'POST /api/reorder_groups': () => ({ success: true }),
        'POST /api/reorder_tasks': () => ({ success: true }),
        'POST /api/move_task_to_end': () => ({ success: true }),

        // Cron History
        'GET /api/backups/*': () => ({ backups: staticData.history, current: generateRawCrontab() }),
        'GET /api/backup/*': () => ({ content: generateRawCrontab() }),
        'GET /api/raw/*': () => ({ content: generateRawCrontab() }),
        'POST /api/save': () => ({ success: true }),
        'POST /api/restore/*': () => ({ success: true }),

        // At Jobs
        'GET /api/at_jobs/*': () => ({ success: true, jobs: clone(state.atJobsPending) }),
        'GET /api/at_history/*': () => ({ success: true, history: clone(state.atJobsHistory), total_pages: 1, page: 1 }),

        'POST /api/at_create/*': (body) => {
            const newId = state.nextId.atJob++;
            state.atJobsPending.push({
                job_id: String(newId),
                command: body.command,
                datetime: body.datetime,
                queue: 'a'
            });
            return { success: true, job_id: newId };
        },

        'DELETE /api/at_cancel/*': (body, path) => {
            const jobId = path.split('/').pop();
            const idx = state.atJobsPending.findIndex(j => j.job_id === jobId);
            if (idx >= 0) {
                const job = state.atJobsPending.splice(idx, 1)[0];
                state.atJobsHistory.unshift({
                    id: 'h' + job.job_id,
                    command: job.command,
                    scheduled_time: job.datetime,
                    executed_at: null,
                    status: 'cancelled'
                });
            }
            return { success: true };
        },

        'POST /api/at_cleanup/*': () => {
            const count = state.atJobsHistory.length;
            state.atJobsHistory = [];
            return { success: true, deleted: count };
        },

        // Templates
        'GET /api/at_templates': () => ({ success: true, templates: clone(state.templates) }),

        'POST /api/at_templates': (body) => {
            const newId = state.nextId.template++;
            state.templates.push({
                id: newId,
                name: body.name,
                command: body.command,
                default_time: body.default_time
            });
            return { success: true, id: newId };
        },

        'PUT /api/at_templates/*': (body, path) => {
            const id = parseInt(path.split('/').pop());
            const tpl = state.templates.find(t => t.id === id);
            if (tpl) Object.assign(tpl, body);
            return { success: true };
        },

        'DELETE /api/at_templates/*': (body, path) => {
            const id = parseInt(path.split('/').pop());
            const idx = state.templates.findIndex(t => t.id === id);
            if (idx >= 0) state.templates.splice(idx, 1);
            return { success: true };
        },

        // Logs
        'GET /api/cron_logs/*': () => ({
            logs: staticData.cronLogs,
            source: '/var/log/syslog',
            total: staticData.cronLogs.length
        }),

        'GET /api/audit_logs/*': () => ({
            logs: staticData.auditLogs,
            total: staticData.auditLogs.length,
            page: 1,
            per_page: 50
        }),

        // Users
        'GET /api/users': () => ({ users: staticData.users }),
        'POST /api/users': () => ({ success: true }),
        'PUT /api/users/*': () => ({ success: true }),
        'DELETE /api/users/*': () => ({ success: true })
    };

    // ==================== Fetch 拦截 ====================

    function mockFetch(url, options = {}) {
        const method = (options.method || 'GET').toUpperCase();
        const path = url.split('?')[0];
        let body = {};

        if (options.body) {
            try { body = JSON.parse(options.body); } catch (e) {}
        }

        // 路由匹配
        let handler = routes[`${method} ${path}`];

        if (!handler) {
            // 通配符匹配
            for (const [route, fn] of Object.entries(routes)) {
                const [m, p] = route.split(' ');
                if (m !== method) continue;

                // 将 * 转换为正则
                const pattern = new RegExp('^' + p.replace(/\*/g, '[^/]+') + '$');
                if (pattern.test(path)) {
                    handler = fn;
                    break;
                }
            }
        }

        const result = handler ? handler(body, path) : { success: true };

        console.log('[Mock]', method, path, handler ? '✓' : '(default)');

        return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(result),
            text: () => Promise.resolve(JSON.stringify(result))
        });
    }

    // 立即替换 fetch
    window.fetch = mockFetch;

    // 页面加载提示
    window.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            if (typeof showMessage === 'function') {
                showMessage('Demo 模式 - 数据刷新后重置', 'info');
            }
        }, 1000);
    });

    console.log('[Mock] Demo API layer ready');
})();
