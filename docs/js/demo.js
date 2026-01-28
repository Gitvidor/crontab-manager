// demo.js - Crontab Manager 静态演示版本
// 使用 Mock 数据模拟后端 API

// ========== Mock 数据 ==========
const MOCK_MACHINES = {
    local: { name: "本机", type: "local", linux_users: ["root", "www-data"] },
    "prod-server": { name: "生产服务器", type: "ssh", linux_users: ["root", "deploy"] }
};

const MOCK_GROUPS = [
    {
        title: "系统维护",
        tasks: [
            { name: "清理临时文件", schedule: "0 3 * * *", command: "/usr/local/bin/cleanup.sh", enabled: true },
            { name: "系统日志轮转", schedule: "0 0 * * 0", command: "/usr/sbin/logrotate /etc/logrotate.conf", enabled: true },
            { name: "磁盘空间检查", schedule: "*/30 * * * *", command: "/scripts/check-disk.sh", enabled: false }
        ]
    },
    {
        title: "数据备份",
        tasks: [
            { name: "数据库备份", schedule: "0 2 * * *", command: "/backup/mysql-backup.sh", enabled: true },
            { name: "文件备份", schedule: "0 4 * * *", command: "rsync -avz /data /backup/", enabled: true }
        ]
    },
    {
        title: "监控任务",
        tasks: [
            { name: "服务健康检查", schedule: "*/5 * * * *", command: "/monitor/health-check.sh", enabled: true },
            { name: "性能数据采集", schedule: "* * * * *", command: "/monitor/collect-metrics.sh", enabled: true },
            { name: "告警通知", schedule: "*/10 * * * *", command: "/monitor/send-alerts.py", enabled: true }
        ]
    },
    {
        title: "应用任务",
        tasks: [
            { name: "缓存预热", schedule: "0 6 * * *", command: "/app/warm-cache.sh", enabled: true },
            { name: "报表生成", schedule: "0 8 * * 1-5", command: "/app/generate-reports.py", enabled: false },
            { name: "数据同步", schedule: "0 */2 * * *", command: "/app/sync-data.sh", enabled: true }
        ]
    }
];

const MOCK_AT_JOBS = [
    { id: 1, command: "echo 'Task completed' | mail -s 'Notification' admin@example.com", scheduled: "2024-01-28 15:30:00", status: "pending" },
    { id: 2, command: "/scripts/one-time-migration.sh", scheduled: "2024-01-28 02:00:00", executed: "2024-01-28 02:00:01", status: "executed" },
    { id: 3, command: "systemctl restart nginx", scheduled: "2024-01-27 23:00:00", status: "cancelled" }
];

const MOCK_AUDIT_LOGS = [
    { time: "2024-01-28 14:32:15", user: "admin", action: "edit_task", details: "Modified task: 数据库备份" },
    { time: "2024-01-28 14:30:00", user: "admin", action: "toggle_task", details: "Disabled task: 报表生成" },
    { time: "2024-01-28 14:25:33", user: "editor", action: "create_task", details: "Created task: 性能数据采集" },
    { time: "2024-01-28 14:20:00", user: "admin", action: "create_group", details: "Created group: 监控任务" },
    { time: "2024-01-28 14:15:00", user: "admin", action: "login", details: "User logged in" }
];

const MOCK_CRON_LOGS = [
    { time: "Jan 28 14:30:01", host: "localhost", details: "CRON[12345]: (root) CMD (/monitor/health-check.sh)" },
    { time: "Jan 28 14:25:01", host: "localhost", details: "CRON[12340]: (root) CMD (/monitor/collect-metrics.sh)" },
    { time: "Jan 28 14:20:01", host: "localhost", details: "CRON[12335]: (root) CMD (/monitor/collect-metrics.sh)" },
    { time: "Jan 28 14:15:01", host: "localhost", details: "CRON[12330]: (root) CMD (/monitor/health-check.sh)" },
    { time: "Jan 28 14:10:01", host: "localhost", details: "CRON[12325]: (root) CMD (/monitor/send-alerts.py)" }
];

const MOCK_HISTORY = [
    { filename: "crontab_20240128_143000.bak", time: "2024-01-28 14:30:00" },
    { filename: "crontab_20240128_142500.bak", time: "2024-01-28 14:25:00" },
    { filename: "crontab_20240128_142000.bak", time: "2024-01-28 14:20:00" }
];

const MOCK_TEMPLATES = [
    { id: 1, name: "发送通知", command: "echo 'Done' | mail admin@example.com", time_mode: "relative", time_value: 5, time_unit: "minutes" },
    { id: 2, name: "重启服务", command: "systemctl restart nginx", time_mode: "relative", time_value: 1, time_unit: "hours" }
];

const MOCK_USERS = [
    { username: "admin", role: "admin", machines: ["*"] },
    { username: "editor", role: "editor", machines: ["local"] },
    { username: "viewer", role: "viewer", machines: ["*"] }
];

// ========== 全局变量 ==========
let groups = [];
let machines = MOCK_MACHINES;
let currentMachine = 'local';
let currentLinuxUser = 'root';
let currentTab = 'list';
let currentFilter = 'all';
let atCurrentFilter = 'pending';
let taskCurrentPage = 1;
let caseSensitive = false;
let collapsedGroups = new Set();

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', function() {
    initMachineSelector();
    loadTasks();
    initTabs();
    showMessage('Demo mode - changes will not be saved', 'info');
});

// ========== 机器选择器 ==========
function initMachineSelector() {
    const select = document.getElementById('machineSelect');
    select.innerHTML = '';

    for (const [key, machine] of Object.entries(machines)) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = machine.name;

        machine.linux_users.forEach(user => {
            const option = document.createElement('option');
            option.value = `${key}|${user}`;
            option.textContent = `${user}@${machine.name}`;
            if (key === currentMachine && user === currentLinuxUser) {
                option.selected = true;
            }
            optgroup.appendChild(option);
        });

        select.appendChild(optgroup);
    }
}

function switchMachine(value) {
    const [machine, user] = value.split('|');
    currentMachine = machine;
    currentLinuxUser = user;
    loadTasks();
    showMessage(`Switched to ${user}@${machines[machine].name}`, 'success');
}

// ========== Tab 切换 ==========
function initTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabName = this.textContent.toLowerCase().replace(' ', '');
        });
    });
}

function switchTab(tab) {
    currentTab = tab;

    // 更新 tab 按钮状态
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const tabs = ['list', 'history', 'cron', 'atjobs', 'logs', 'settings'];
    const tabNames = ['Cron Jobs', 'Cron History', 'Cron Logs', 'At Jobs', 'Audit Logs', 'Settings'];
    const idx = tabs.indexOf(tab);
    if (idx >= 0 && idx < 5) {
        document.querySelectorAll('.tab')[idx].classList.add('active');
    }

    // 隐藏所有面板
    document.getElementById('taskList').classList.remove('active');
    document.getElementById('taskPagination').style.display = 'none';
    document.querySelector('.collapse-controls').style.display = 'none';
    document.getElementById('newGroupForm').style.display = 'none';
    document.getElementById('historyView').style.display = 'none';
    document.getElementById('cronLogs').style.display = 'none';
    document.getElementById('atJobsPanel').style.display = 'none';
    document.getElementById('auditLogs').style.display = 'none';
    document.getElementById('settingsPanel').style.display = 'none';

    // 显示对应面板
    switch(tab) {
        case 'list':
            document.getElementById('taskList').classList.add('active');
            document.getElementById('taskPagination').style.display = 'flex';
            document.querySelector('.collapse-controls').style.display = 'flex';
            loadTasks();
            break;
        case 'history':
            document.getElementById('historyView').style.display = 'block';
            loadHistory();
            break;
        case 'cron':
            document.getElementById('cronLogs').style.display = 'block';
            loadCronLogs();
            break;
        case 'atjobs':
            document.getElementById('atJobsPanel').style.display = 'block';
            loadAtJobs();
            break;
        case 'logs':
            document.getElementById('auditLogs').style.display = 'block';
            loadAuditLogs();
            break;
        case 'settings':
            document.getElementById('settingsPanel').style.display = 'block';
            loadUsers();
            break;
    }
}

// ========== Cron Jobs 列表 ==========
function loadTasks() {
    groups = JSON.parse(JSON.stringify(MOCK_GROUPS)); // 深拷贝
    renderTasks();
    updateFilterCounts();
}

function renderTasks() {
    const container = document.getElementById('taskList');
    const searchTerm = document.getElementById('searchBox').value.toLowerCase();

    let html = '';
    let taskIndex = 0;

    groups.forEach((group, groupIndex) => {
        const isCollapsed = collapsedGroups.has(groupIndex);
        const filteredTasks = group.tasks.filter(task => {
            // 过滤器
            if (currentFilter === 'active' && !task.enabled) return false;
            if (currentFilter === 'paused' && task.enabled) return false;
            // 搜索
            if (searchTerm) {
                const text = `${task.name} ${task.command} ${group.title}`.toLowerCase();
                if (!text.includes(searchTerm)) return false;
            }
            return true;
        });

        if (filteredTasks.length === 0 && searchTerm) return;

        html += `
            <div class="task-group" data-group="${groupIndex}">
                <div class="group-header" onclick="toggleGroup(${groupIndex})">
                    <span class="group-toggle ${isCollapsed ? 'collapsed' : ''}">${isCollapsed ? '▶' : '▼'}</span>
                    <span class="group-title">${escapeHtml(group.title)}</span>
                    <span class="group-count">${filteredTasks.length} tasks</span>
                    <div class="group-actions">
                        <button class="group-action-btn" onclick="event.stopPropagation(); editGroup(${groupIndex})" title="Edit">✏️</button>
                        <button class="group-action-btn" onclick="event.stopPropagation(); deleteGroup(${groupIndex})" title="Delete">🗑️</button>
                    </div>
                </div>
                <div class="group-tasks ${isCollapsed ? 'collapsed' : ''}">
        `;

        filteredTasks.forEach((task, ti) => {
            const schedule = parseSchedule(task.schedule);
            html += `
                <div class="task-item ${task.enabled ? '' : 'disabled'}" data-task="${ti}">
                    <div class="task-toggle">
                        <label class="switch">
                            <input type="checkbox" ${task.enabled ? 'checked' : ''} onchange="toggleTask(${groupIndex}, ${ti})">
                            <span class="slider"></span>
                        </label>
                    </div>
                    <div class="task-info">
                        <div class="task-name">${escapeHtml(task.name)}</div>
                        <div class="task-command">${escapeHtml(task.command)}</div>
                    </div>
                    <div class="task-schedule">
                        <code>${escapeHtml(task.schedule)}</code>
                        <span class="schedule-desc">${schedule}</span>
                    </div>
                    <div class="task-actions">
                        <button class="task-action-btn" onclick="editTask(${groupIndex}, ${ti})" title="Edit">✏️</button>
                        <button class="task-action-btn" onclick="deleteTask(${groupIndex}, ${ti})" title="Delete">🗑️</button>
                    </div>
                </div>
            `;
            taskIndex++;
        });

        html += '</div></div>';
    });

    if (!html) {
        html = '<div class="log-empty">No tasks found</div>';
    }

    container.innerHTML = html;
}

function parseSchedule(schedule) {
    const parts = schedule.split(' ');
    if (parts.length < 5) return schedule;

    const [min, hour, day, month, weekday] = parts;

    if (min === '*' && hour === '*') return 'Every minute';
    if (min.startsWith('*/')) return `Every ${min.slice(2)} minutes`;
    if (hour === '*') return `At minute ${min}`;
    if (day === '*' && month === '*' && weekday === '*') {
        return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }
    if (weekday === '0') return `Sundays at ${hour}:${min}`;
    if (weekday === '1-5') return `Weekdays at ${hour}:${min}`;

    return schedule;
}

function updateFilterCounts() {
    let all = 0, active = 0, paused = 0;
    groups.forEach(g => {
        g.tasks.forEach(t => {
            all++;
            if (t.enabled) active++;
            else paused++;
        });
    });

    document.getElementById('filterCountAll').textContent = all;
    document.getElementById('filterCountActive').textContent = active;
    document.getElementById('filterCountPaused').textContent = paused;
}

function setFilter(filter) {
    currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    renderTasks();
}

function toggleGroup(index) {
    if (collapsedGroups.has(index)) {
        collapsedGroups.delete(index);
    } else {
        collapsedGroups.add(index);
    }
    renderTasks();
}

function toggleAllGroups() {
    if (collapsedGroups.size === groups.length) {
        collapsedGroups.clear();
    } else {
        groups.forEach((_, i) => collapsedGroups.add(i));
    }
    renderTasks();
}

function toggleTask(groupIndex, taskIndex) {
    groups[groupIndex].tasks[taskIndex].enabled = !groups[groupIndex].tasks[taskIndex].enabled;
    renderTasks();
    updateFilterCounts();
    showMessage('Task toggled (demo mode)', 'success');
}

function filterTasks() {
    renderTasks();
}

function toggleCaseSensitive() {
    caseSensitive = !caseSensitive;
    document.getElementById('caseToggle').classList.toggle('active', caseSensitive);
    renderTasks();
}

// ========== Group 操作 ==========
function showNewGroupForm() {
    document.getElementById('newGroupForm').style.display = 'flex';
    document.getElementById('newGroupTitle').focus();
}

function hideNewGroupForm() {
    document.getElementById('newGroupForm').style.display = 'none';
    document.getElementById('newGroupTitle').value = '';
}

function createGroup() {
    const title = document.getElementById('newGroupTitle').value.trim();
    if (!title) {
        showMessage('Please enter a group name', 'error');
        return;
    }
    groups.push({ title, tasks: [] });
    hideNewGroupForm();
    renderTasks();
    showMessage('Group created (demo mode)', 'success');
}

function editGroup(index) {
    const newTitle = prompt('Enter new group name:', groups[index].title);
    if (newTitle && newTitle.trim()) {
        groups[index].title = newTitle.trim();
        renderTasks();
        showMessage('Group renamed (demo mode)', 'success');
    }
}

function deleteGroup(index) {
    if (confirm(`Delete group "${groups[index].title}" and all its tasks?`)) {
        groups.splice(index, 1);
        renderTasks();
        updateFilterCounts();
        showMessage('Group deleted (demo mode)', 'success');
    }
}

// ========== Task 操作 ==========
function editTask(groupIndex, taskIndex) {
    const task = groups[groupIndex].tasks[taskIndex];
    const newName = prompt('Task name:', task.name);
    if (newName !== null) {
        task.name = newName;
        renderTasks();
        showMessage('Task updated (demo mode)', 'success');
    }
}

function deleteTask(groupIndex, taskIndex) {
    if (confirm('Delete this task?')) {
        groups[groupIndex].tasks.splice(taskIndex, 1);
        renderTasks();
        updateFilterCounts();
        showMessage('Task deleted (demo mode)', 'success');
    }
}

// ========== History ==========
function loadHistory() {
    // 显示当前 crontab 内容
    let content = '';
    groups.forEach(g => {
        content += `# ${g.title}\n`;
        g.tasks.forEach(t => {
            const prefix = t.enabled ? '' : '#';
            if (t.name) content += `# ${t.name}\n`;
            content += `${prefix}${t.schedule} ${t.command}\n`;
        });
        content += '\n';
    });

    document.getElementById('rawContent').value = content;
    updateHighlight();

    // 显示历史列表
    let html = '';
    MOCK_HISTORY.forEach((h, i) => {
        html += `
            <div class="history-item">
                <span class="history-time">${h.time}</span>
                <span class="history-file">${h.filename}</span>
                <div class="history-actions">
                    <button class="history-btn" onclick="showDiff(${i})">Diff</button>
                    <button class="history-btn" onclick="restoreVersion(${i})">Restore</button>
                </div>
            </div>
        `;
    });
    document.getElementById('historyList').innerHTML = html || '<div class="log-empty">No history</div>';
}

function updateHighlight() {
    const content = document.getElementById('rawContent').value;
    const highlighted = content.split('\n').map(line => {
        if (line.startsWith('#')) {
            return `<span class="hl-comment">${escapeHtml(line)}</span>`;
        }
        return escapeHtml(line);
    }).join('\n');
    document.getElementById('codeHighlight').innerHTML = highlighted;
}

function syncHighlightScroll() {
    const textarea = document.getElementById('rawContent');
    const highlight = document.getElementById('codeHighlight');
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
}

function toggleEditMode() {
    const textarea = document.getElementById('rawContent');
    const btn = document.getElementById('editToggleBtn');
    const cancelBtn = document.getElementById('cancelEditBtn');

    if (textarea.readOnly) {
        textarea.readOnly = false;
        btn.textContent = 'Save';
        cancelBtn.style.display = 'inline-block';
    } else {
        textarea.readOnly = true;
        btn.textContent = 'Edit';
        cancelBtn.style.display = 'none';
        showMessage('Changes saved (demo mode)', 'success');
    }
}

function cancelEditMode() {
    document.getElementById('rawContent').readOnly = true;
    document.getElementById('editToggleBtn').textContent = 'Edit';
    document.getElementById('cancelEditBtn').style.display = 'none';
    loadHistory();
}

function toggleEditHelp() {
    const panel = document.getElementById('editHelpPanel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function showDiff(index) {
    document.getElementById('diffModal').style.display = 'flex';
    document.getElementById('diffBackupTime').textContent = MOCK_HISTORY[index].time;
    document.getElementById('diffBackup').innerHTML = '<span class="diff-del">- 0 3 * * * /old/cleanup.sh</span>\n<span class="diff-add">+ 0 3 * * * /usr/local/bin/cleanup.sh</span>';
    document.getElementById('diffCurrent').textContent = document.getElementById('rawContent').value;
}

function closeDiffModal() {
    document.getElementById('diffModal').style.display = 'none';
}

function restoreVersion(index) {
    if (confirm(`Restore to version from ${MOCK_HISTORY[index].time}?`)) {
        showMessage('Version restored (demo mode)', 'success');
    }
}

function navigateDiff(direction) {
    showMessage('Navigate diff (demo mode)', 'info');
}

// ========== Cron Logs ==========
function loadCronLogs() {
    let html = '';
    MOCK_CRON_LOGS.forEach(log => {
        html += `
            <div class="cron-log-item">
                <span class="cron-col-time">${log.time}</span>
                <span class="cron-col-host">${log.host}</span>
                <span class="cron-col-details">${escapeHtml(log.details)}</span>
            </div>
        `;
    });
    document.getElementById('cronLogList').innerHTML = html || '<div class="log-empty">No logs</div>';
}

function filterCronLogs() {
    const search = document.getElementById('cronSearch').value.toLowerCase();
    const items = document.querySelectorAll('#cronLogList .cron-log-item');
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(search) ? '' : 'none';
    });
}

// ========== At Jobs ==========
function loadAtJobs() {
    loadTemplates();
    renderAtJobs();
}

function loadTemplates() {
    let html = '';
    MOCK_TEMPLATES.forEach(t => {
        html += `<button class="template-btn" onclick="applyTemplate(${t.id})">${escapeHtml(t.name)}</button>`;
    });
    html += '<button class="template-btn template-add" onclick="showTemplateForm()">+ Add</button>';
    document.getElementById('atTemplateList').innerHTML = html;
}

function renderAtJobs() {
    const jobs = MOCK_AT_JOBS.filter(j => {
        if (atCurrentFilter === 'all') return true;
        return j.status === atCurrentFilter;
    });

    let html = '';
    jobs.forEach(job => {
        const statusClass = job.status === 'pending' ? 'status-pending' :
                           job.status === 'executed' ? 'status-executed' : 'status-cancelled';
        html += `
            <div class="at-job-item">
                <span class="at-col-status"><span class="at-status ${statusClass}">${job.status}</span></span>
                <span class="at-col-command">${escapeHtml(job.command)}</span>
                <span class="at-col-scheduled">${job.scheduled}</span>
                <span class="at-col-executed">${job.executed || '-'}</span>
                <span class="at-col-actions">
                    ${job.status === 'pending' ? '<button class="at-cancel-btn" onclick="cancelAtJob(' + job.id + ')">Cancel</button>' : ''}
                </span>
            </div>
        `;
    });

    document.getElementById('atJobList').innerHTML = html || '<div class="log-empty">No jobs</div>';
    updateAtFilterCounts();
}

function updateAtFilterCounts() {
    const counts = { all: 0, pending: 0, executed: 0, cancelled: 0 };
    MOCK_AT_JOBS.forEach(j => {
        counts.all++;
        counts[j.status]++;
    });

    document.getElementById('atFilterCountAll').textContent = counts.all;
    document.getElementById('atFilterCountPending').textContent = counts.pending;
    document.getElementById('atFilterCountExecuted').textContent = counts.executed;
    document.getElementById('atFilterCountCancelled').textContent = counts.cancelled;
}

function setAtFilter(filter) {
    atCurrentFilter = filter;
    document.querySelectorAll('.at-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    renderAtJobs();
}

function createAtJob() {
    showMessage('At job created (demo mode)', 'success');
}

function cancelAtJob(id) {
    const job = MOCK_AT_JOBS.find(j => j.id === id);
    if (job) {
        job.status = 'cancelled';
        renderAtJobs();
        showMessage('Job cancelled (demo mode)', 'success');
    }
}

function refreshAtPanel() {
    loadAtJobs();
    showMessage('Refreshed', 'success');
}

function cleanupAtHistory() {
    showMessage('History cleaned (demo mode)', 'success');
}

function showTemplateForm() {
    document.getElementById('templateForm').style.display = 'flex';
}

function hideTemplateForm() {
    document.getElementById('templateForm').style.display = 'none';
}

function saveTemplate() {
    hideTemplateForm();
    showMessage('Template saved (demo mode)', 'success');
}

function applyTemplate(id) {
    const template = MOCK_TEMPLATES.find(t => t.id === id);
    if (template) {
        document.getElementById('atCommand').value = template.command;
        showMessage(`Template "${template.name}" applied`, 'info');
    }
}

function toggleTemplateTimeMode() {}
function toggleAtTimeMode() {}
function deleteEditingTemplate() {}

// ========== Audit Logs ==========
function loadAuditLogs() {
    let html = '';
    MOCK_AUDIT_LOGS.forEach(log => {
        html += `
            <div class="log-item">
                <span class="log-col-time">${log.time}</span>
                <span class="log-col-user">${log.user}</span>
                <span class="log-col-action"><span class="action-badge action-${log.action}">${log.action}</span></span>
                <span class="log-col-details">${escapeHtml(log.details)}</span>
            </div>
        `;
    });
    document.getElementById('logList').innerHTML = html || '<div class="log-empty">No logs</div>';
}

function filterAuditLogs() {
    const search = document.getElementById('auditSearch').value.toLowerCase();
    const items = document.querySelectorAll('#logList .log-item');
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(search) ? '' : 'none';
    });
}

// ========== Settings ==========
function loadUsers() {
    let html = '';
    MOCK_USERS.forEach(user => {
        html += `
            <div class="user-item">
                <span class="user-col-name">${user.username}</span>
                <span class="user-col-role"><span class="role-badge role-${user.role}">${user.role}</span></span>
                <span class="user-col-machines">${user.machines.join(', ')}</span>
                <span class="user-col-actions">
                    <button class="user-action-btn" onclick="editUser('${user.username}')">Edit</button>
                    ${user.username !== 'admin' ? '<button class="user-action-btn danger" onclick="deleteUser(\'' + user.username + '\')">Delete</button>' : ''}
                </span>
            </div>
        `;
    });
    document.getElementById('userList').innerHTML = html;
}

function createUser() {
    showMessage('User created (demo mode)', 'success');
}

function editUser(username) {
    showMessage(`Edit user ${username} (demo mode)`, 'info');
}

function deleteUser(username) {
    if (confirm(`Delete user ${username}?`)) {
        showMessage('User deleted (demo mode)', 'success');
    }
}

// ========== 工具函数 ==========
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showMessage(text, type = 'info') {
    const msg = document.getElementById('message');
    msg.textContent = text;
    msg.className = `message ${type} show`;
    setTimeout(() => msg.classList.remove('show'), 3000);
}

function performUndo() {
    showMessage('Undo (demo mode)', 'info');
}
