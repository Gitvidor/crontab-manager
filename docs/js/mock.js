// mock.js - Mock API 层，拦截所有 API 调用返回演示数据
// 必须在 app.js 之前加载

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
                id: "g1",
                title: "系统维护",
                tasks: [
                    { id: "t1", name: "清理临时文件", minute: "0", hour: "3", day: "*", month: "*", weekday: "*", command: "/usr/local/bin/cleanup.sh", enabled: true },
                    { id: "t2", name: "系统日志轮转", minute: "0", hour: "0", day: "*", month: "*", weekday: "0", command: "/usr/sbin/logrotate /etc/logrotate.conf", enabled: true },
                    { id: "t3", name: "磁盘空间检查", minute: "*/30", hour: "*", day: "*", month: "*", weekday: "*", command: "/scripts/check-disk.sh", enabled: false }
                ]
            },
            {
                id: "g2",
                title: "数据备份",
                tasks: [
                    { id: "t4", name: "数据库备份", minute: "0", hour: "2", day: "*", month: "*", weekday: "*", command: "/backup/mysql-backup.sh", enabled: true },
                    { id: "t5", name: "文件备份", minute: "0", hour: "4", day: "*", month: "*", weekday: "*", command: "rsync -avz /data /backup/", enabled: true }
                ]
            },
            {
                id: "g3",
                title: "监控任务",
                tasks: [
                    { id: "t6", name: "服务健康检查", minute: "*/5", hour: "*", day: "*", month: "*", weekday: "*", command: "/monitor/health-check.sh", enabled: true },
                    { id: "t7", name: "性能数据采集", minute: "*", hour: "*", day: "*", month: "*", weekday: "*", command: "/monitor/collect-metrics.sh", enabled: true },
                    { id: "t8", name: "告警通知", minute: "*/10", hour: "*", day: "*", month: "*", weekday: "*", command: "/monitor/send-alerts.py", enabled: true }
                ]
            },
            {
                id: "g4",
                title: "应用任务",
                tasks: [
                    { id: "t9", name: "缓存预热", minute: "0", hour: "6", day: "*", month: "*", weekday: "*", command: "/app/warm-cache.sh", enabled: true },
                    { id: "t10", name: "报表生成", minute: "0", hour: "8", day: "*", month: "*", weekday: "1-5", command: "/app/generate-reports.py", enabled: false },
                    { id: "t11", name: "数据同步", minute: "0", hour: "*/2", day: "*", month: "*", weekday: "*", command: "/app/sync-data.sh", enabled: true }
                ]
            }
        ],

        atJobs: [
            { id: 1, job_id: "101", command: "echo 'Task completed' | mail -s 'Notification' admin@example.com", scheduled_time: "2024-01-28 15:30:00", status: "pending" },
            { id: 2, job_id: "102", command: "/scripts/one-time-migration.sh", scheduled_time: "2024-01-28 02:00:00", executed_time: "2024-01-28 02:00:01", status: "executed" },
            { id: 3, job_id: "103", command: "systemctl restart nginx", scheduled_time: "2024-01-27 23:00:00", status: "cancelled" }
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

        cronLogs: [
            { time: "Jan 28 14:30:01", host: "localhost", user: "(root)", command: "/monitor/health-check.sh" },
            { time: "Jan 28 14:25:01", host: "localhost", user: "(root)", command: "/monitor/collect-metrics.sh" },
            { time: "Jan 28 14:20:01", host: "localhost", user: "(root)", command: "/monitor/collect-metrics.sh" },
            { time: "Jan 28 14:15:01", host: "localhost", user: "(root)", command: "/monitor/health-check.sh" },
            { time: "Jan 28 14:10:01", host: "localhost", user: "(root)", command: "/monitor/send-alerts.py" }
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

    // API 路由处理
    const API_HANDLERS = {
        // 机器列表
        'GET /api/machines': () => ({
            machines: MOCK_DATA.machines,
            current: 'local',
            current_linux_user: 'root'
        }),

        // 任务列表
        'GET /api/crontab': () => ({
            groups: deepClone(MOCK_DATA.groups),
            raw: MOCK_DATA.rawCrontab
        }),

        // 切换任务状态
        'POST /api/toggle': (body) => {
            const group = MOCK_DATA.groups.find(g => g.id === body.group_id);
            if (group) {
                const task = group.tasks.find(t => t.id === body.task_id);
                if (task) task.enabled = !task.enabled;
            }
            return { success: true };
        },

        // 切换整组状态
        'POST /api/toggle_group': (body) => {
            const group = MOCK_DATA.groups.find(g => g.id === body.group_id);
            if (group) {
                const enable = body.enable;
                group.tasks.forEach(t => t.enabled = enable);
            }
            return { success: true };
        },

        // 删除任务
        'DELETE /api/task': () => ({ success: true }),

        // 编辑任务
        'POST /api/edit_task': () => ({ success: true }),

        // 创建任务
        'POST /api/create_task': () => ({ success: true, task_id: 'new-' + Date.now() }),

        // 创建组
        'POST /api/create_group': () => ({ success: true, group_id: 'new-g-' + Date.now() }),

        // 删除组
        'DELETE /api/delete_group': () => ({ success: true }),

        // 运行任务
        'POST /api/run_task': () => ({ success: true, message: 'Task started (demo mode)' }),

        // 历史版本
        'GET /api/history': () => ({
            backups: MOCK_DATA.history,
            current: MOCK_DATA.rawCrontab
        }),

        // 备份内容
        'GET /api/backup': () => ({
            content: MOCK_DATA.rawCrontab.replace('cleanup.sh', 'old-cleanup.sh')
        }),

        // 回滚
        'POST /api/rollback': () => ({ success: true }),

        // 保存原始内容
        'POST /api/save_raw': () => ({ success: true }),

        // At Jobs
        'GET /api/at/jobs': () => ({
            jobs: deepClone(MOCK_DATA.atJobs),
            templates: deepClone(MOCK_DATA.templates)
        }),

        'POST /api/at/create': () => ({ success: true, job_id: 'new-at-' + Date.now() }),

        'DELETE /api/at/cancel': () => ({ success: true }),

        'POST /api/at/cleanup': () => ({ success: true, deleted: 2 }),

        'POST /api/at/template': () => ({ success: true }),

        'DELETE /api/at/template': () => ({ success: true }),

        // 审计日志
        'GET /api/logs': () => ({
            logs: MOCK_DATA.auditLogs,
            total: MOCK_DATA.auditLogs.length,
            page: 1,
            per_page: 50
        }),

        // Cron 日志
        'GET /api/cron_logs': () => ({
            logs: MOCK_DATA.cronLogs,
            source: '/var/log/syslog',
            total: MOCK_DATA.cronLogs.length
        }),

        // 用户管理
        'GET /api/users': () => ({
            users: MOCK_DATA.users
        }),

        'POST /api/users': () => ({ success: true }),

        'DELETE /api/users': () => ({ success: true }),

        // 机器切换
        'POST /api/switch_machine': () => ({ success: true }),

        // 连接测试
        'GET /api/test_connection': () => ({ success: true, message: 'Connected' }),

        // 重新排序
        'POST /api/reorder': () => ({ success: true })
    };

    // 拦截 fetch
    const originalFetch = window.fetch;
    window.fetch = function(url, options = {}) {
        const method = (options.method || 'GET').toUpperCase();
        const path = url.split('?')[0];

        // 查找匹配的处理器
        let handler = API_HANDLERS[`${method} ${path}`];

        // 尝试模糊匹配（用于带 ID 的路由）
        if (!handler) {
            for (const key of Object.keys(API_HANDLERS)) {
                const [m, p] = key.split(' ');
                if (m === method && path.startsWith(p.replace(/\/\d+$/, ''))) {
                    handler = API_HANDLERS[key];
                    break;
                }
            }
        }

        if (handler) {
            // 解析请求体
            let body = {};
            if (options.body) {
                try {
                    body = JSON.parse(options.body);
                } catch (e) {
                    // FormData 或其他格式
                }
            }

            // 返回 mock 响应
            const result = handler(body, path);
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve(result),
                text: () => Promise.resolve(JSON.stringify(result))
            });
        }

        // 未匹配的请求，返回空成功响应
        console.log('[Mock] Unhandled:', method, path);
        return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ success: true }),
            text: () => Promise.resolve('{}')
        });
    };

    // 显示 demo 提示
    window.addEventListener('DOMContentLoaded', function() {
        setTimeout(function() {
            if (typeof showMessage === 'function') {
                showMessage('Demo mode - changes will not be saved', 'info');
            }
        }, 1000);
    });

    console.log('[Mock] API mock layer initialized');
})();
