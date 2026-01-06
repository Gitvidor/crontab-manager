        // ========== 全局变量 ==========
        let groups = [];
        let undoStack = [];      // 撤销栈
        let undoTimer = null;
        let undoCountdown = 5;
        // 拖拽状态
        let draggedElement = null;
        let dragType = null;         // 'group' or 'task'
        let dragRafId = null;        // requestAnimationFrame ID，用于节流
        let lastDragOverTarget = null;
        let isDragging = false;
        let dragPlaceholder = null;  // 拖拽占位符元素
        // 机器管理
        let machines = {};           // 机器配置
        let currentMachine = 'local';
        let currentLinuxUser = 'root';  // 默认用户为 root
        const collapsedStateMap = new Map();  // 保存每个 machine+user 的折叠状态
        // 权限管理（服务端渲染）

        // ========== SVG 图标常量 ==========
        const ICON = {
            // 用户图标（实心）
            USER: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="7" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0z"/></svg>',
            // 主机图标（显示器）
            HOST: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
            // 过滤器图标
            FILTER: '<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2h14l-5.5 6v5l-3 2v-7L1 2z"/></svg>',
        };

        // ========== 工具函数 ==========
        // Cron 时间解析为人类可读描述
        function parseCronToHuman(minute, hour, day, month, weekday) {
            const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

            // 解析单个字段
            function parseField(val, names = null) {
                if (val === '*') return null;
                if (val.startsWith('*/')) {
                    return `every ${val.slice(2)}`;
                }
                if (val.includes(',')) {
                    const vals = val.split(',').map(v => names ? (names[parseInt(v)] || v) : v);
                    return vals.join(', ');
                }
                if (val.includes('-')) {
                    const [start, end] = val.split('-');
                    if (names) return `${names[parseInt(start)] || start}-${names[parseInt(end)] || end}`;
                    return `${start}-${end}`;
                }
                return names ? (names[parseInt(val)] || val) : val;
            }

            // 格式化时间
            function formatTime(m, h) {
                if (m === '*' && h === '*') return 'every minute';
                if (m.startsWith('*/') && h === '*') return `every ${m.slice(2)} minutes`;
                if (m === '0' && h === '*') return 'every hour at :00';
                if (m === '30' && h === '*') return 'every hour at :30';
                if (m === '*' && h.startsWith('*/')) return `every minute, every ${h.slice(2)} hours`;
                if (m === '0' && h.startsWith('*/')) return `every ${h.slice(2)} hours`;

                const minPart = parseField(m);
                const hourPart = parseField(h);

                if (minPart === null && hourPart === null) return 'every minute';
                if (minPart !== null && hourPart === null) return `at minute ${minPart}`;
                if (minPart === null && hourPart !== null) return `every minute at hour ${hourPart}`;

                // 具体时间
                if (!m.includes('/') && !m.includes(',') && !m.includes('-') &&
                    !h.includes('/') && !h.includes(',') && !h.includes('-')) {
                    const hh = h.padStart(2, '0');
                    const mm = m.padStart(2, '0');
                    return `at ${hh}:${mm}`;
                }

                return `hour ${hourPart}, minute ${minPart}`;
            }

            let parts = [];

            // 时间部分
            parts.push(formatTime(minute, hour));

            // 日期部分
            const dayPart = parseField(day);
            const monthPart = parseField(month, monthNames);
            if (dayPart !== null && monthPart !== null) {
                parts.push(`on ${monthPart} ${dayPart}`);
            } else if (dayPart !== null) {
                parts.push(`on day ${dayPart}`);
            } else if (monthPart !== null) {
                parts.push(`in ${monthPart}`);
            }

            // 星期部分
            const weekdayPart = parseField(weekday, weekdayNames);
            if (weekdayPart !== null) {
                parts.push(`on ${weekdayPart}`);
            }

            return parts.join(', ').replace(/^./, c => c.toUpperCase());
        }

        // 高亮搜索关键词
        function highlightText(text, keyword) {
            if (!keyword) return escapeHtml(text);
            const escaped = escapeHtml(text);
            const flags = caseSensitive ? 'g' : 'gi';
            const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, flags);
            return escaped.replace(regex, '<span class="search-highlight">$1</span>');
        }

        // 通用 API 调用封装
        async function apiCall(url, options = {}) {
            // 自动添加机器参数
            const bodyData = options.body || {};
            bodyData.machine_id = currentMachine;
            bodyData.linux_user = currentLinuxUser || 'root';
            const resp = await fetch(url, {
                method: options.method || 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyData)
            });
            const result = await resp.json();
            if (result.success) {
                if (options.successMsg) showMessage(options.successMsg, 'success');
                if (options.reload !== false) loadTasksKeepState();
            } else {
                showMessage((options.errorPrefix || 'Error') + ': ' + result.error, 'error');
            }
            return result;
        }

        // 通用分页渲染函数
        function renderPagination(config) {
            const { elementId, currentPage, totalPages, goPageFn, totalItems, itemType, showDisplay } = config;
            const pagination = document.getElementById(elementId);
            if (totalPages <= 1) {
                pagination.innerHTML = '';
                if (showDisplay !== undefined) pagination.style.display = 'none';
                return;
            }
            if (showDisplay !== undefined) pagination.style.display = 'flex';

            let html = '';
            html += `<button class="page-btn" onclick="${goPageFn}(1)" ${currentPage === 1 ? 'disabled' : ''}>«</button>`;
            html += `<button class="page-btn" onclick="${goPageFn}(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>‹</button>`;

            const maxVisible = 5;
            let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
            let endPage = Math.min(totalPages, startPage + maxVisible - 1);
            if (endPage - startPage < maxVisible - 1) {
                startPage = Math.max(1, endPage - maxVisible + 1);
            }

            if (startPage > 1) {
                html += `<button class="page-btn" onclick="${goPageFn}(1)">1</button>`;
                if (startPage > 2) html += `<span class="page-info">...</span>`;
            }
            for (let i = startPage; i <= endPage; i++) {
                html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="${goPageFn}(${i})">${i}</button>`;
            }
            if (endPage < totalPages) {
                if (endPage < totalPages - 1) html += `<span class="page-info">...</span>`;
                html += `<button class="page-btn" onclick="${goPageFn}(${totalPages})">${totalPages}</button>`;
            }

            html += `<button class="page-btn" onclick="${goPageFn}(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>›</button>`;
            html += `<button class="page-btn" onclick="${goPageFn}(${totalPages})" ${currentPage === totalPages ? 'disabled' : ''}>»</button>`;
            if (totalItems !== undefined) html += `<span class="page-info">${totalItems} ${itemType || 'items'}</span>`;

            pagination.innerHTML = html;
        }

        // ========== UI 反馈（消息提示、撤销） ==========

        // 显示撤销提示
        function showUndoToast(message, undoData) {
            undoStack.push(undoData);
            const toast = document.getElementById('undoToast');
            toast.querySelector('.undo-text').textContent = message;
            toast.classList.add('show');

            undoCountdown = 5;
            updateUndoCountdown();

            if (undoTimer) clearInterval(undoTimer);
            undoTimer = setInterval(() => {
                undoCountdown--;
                updateUndoCountdown();
                if (undoCountdown <= 0) {
                    hideUndoToast();
                    undoStack.pop(); // 超时则移除撤销数据
                }
            }, 1000);
        }

        function updateUndoCountdown() {
            document.querySelector('.undo-countdown').textContent = `${undoCountdown}s`;
        }

        function hideUndoToast() {
            document.getElementById('undoToast').classList.remove('show');
            if (undoTimer) {
                clearInterval(undoTimer);
                undoTimer = null;
            }
        }

        // 执行撤销
        async function performUndo() {
            if (undoStack.length === 0) return;

            const undoData = undoStack.pop();
            hideUndoToast();

            if (undoData.type === 'delete_task') {
                // 恢复删除的任务
                const resp = await fetch(`/api/add_to_group/${undoData.groupId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        schedule: undoData.schedule,
                        command: undoData.command,
                        enabled: undoData.enabled,
                        machine_id: currentMachine,
                        linux_user: currentLinuxUser || 'root'
                    })
                });
                const result = await resp.json();
                if (result.success) {
                    showMessage('Task restored', 'success');
                    loadTasksKeepState();
                } else {
                    showMessage('Restore failed: ' + result.error, 'error');
                }
            } else if (undoData.type === 'delete_group') {
                // 恢复删除的任务组（需要后端支持）
                showMessage('Group restore not yet supported', 'error');
            }
        }

        // ========== 标签页切换 ==========

        function switchTab(tab) {
            // 检查是否处于编辑模式，如果是则阻止切换
            const textarea = document.getElementById('rawContent');
            if (textarea && !textarea.readOnly && tab !== 'history') {
                alert('Please save or cancel your changes before switching tabs.');
                return;
            }

            // 更新 tab 按钮状态（settings 不在 tab 栏中）
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            const tabMap = { 'list': 1, 'history': 2, 'cron': 3, 'logs': 4 };
            if (tabMap[tab]) {
                document.querySelector(`.tab:nth-child(${tabMap[tab]})`).classList.add('active');
            }

            document.getElementById('taskList').classList.toggle('active', tab === 'list');
            document.getElementById('historyView').classList.toggle('active', tab === 'history');
            document.getElementById('cronLogs').classList.toggle('active', tab === 'cron');
            document.getElementById('auditLogs').classList.toggle('active', tab === 'logs');
            const settingsPanel = document.getElementById('settingsPanel');
            if (settingsPanel) settingsPanel.classList.toggle('active', tab === 'settings');
            document.querySelector('.collapse-controls').style.display = tab === 'list' ? 'flex' : 'none';
            // 非 Task list 时隐藏分页栏；Task list 时由 renderTaskPagination 控制显示
            if (tab !== 'list') {
                document.getElementById('taskPagination').style.display = 'none';
            }
            document.getElementById('newGroupForm').classList.remove('active');
            document.getElementById('searchBox').value = '';

            if (tab === 'list') {
                loadTasksKeepState();
            } else if (tab === 'history') {
                loadRaw();
                loadHistory();
            } else if (tab === 'cron') {
                loadCronLogs();
            } else if (tab === 'logs') {
                loadAuditLogs();
            } else if (tab === 'settings') {
                loadUsers();
            }
        }

        // ========== 历史版本相关 ==========

        function toggleEditHelp() {
            const panel = document.getElementById('editHelpPanel');
            const btn = document.getElementById('editHelpBtn');
            if (panel.style.display === 'none') {
                panel.style.display = 'block';
                btn.classList.add('active');
            } else {
                panel.style.display = 'none';
                btn.classList.remove('active');
            }
        }

        async function toggleEditMode() {
            const textarea = document.getElementById('rawContent');
            const btn = document.getElementById('editToggleBtn');
            const cancelBtn = document.getElementById('cancelEditBtn');
            const codeEditor = textarea.closest('.code-editor');
            const isEditing = !textarea.readOnly;

            if (isEditing) {
                // 保存模式 -> 只读模式
                await saveRaw();
                loadHistory(); // 保存后自动刷新历史版本
                textarea.readOnly = true;
                btn.textContent = 'Edit';
                btn.classList.remove('save-mode');
                cancelBtn.style.display = 'none';
                codeEditor.classList.remove('editing');
            } else {
                // 只读模式 -> 编辑模式
                textarea.readOnly = false;
                textarea.focus();
                btn.textContent = 'Save';
                btn.classList.add('save-mode');
                cancelBtn.style.display = 'inline-flex';
                codeEditor.classList.add('editing');
            }
        }

        function cancelEditMode() {
            const textarea = document.getElementById('rawContent');
            const btn = document.getElementById('editToggleBtn');
            const cancelBtn = document.getElementById('cancelEditBtn');
            const codeEditor = textarea.closest('.code-editor');

            // 恢复原始内容
            loadRaw();
            // 切换回只读模式
            textarea.readOnly = true;
            btn.textContent = 'Edit';
            btn.classList.remove('save-mode');
            cancelBtn.style.display = 'none';
            codeEditor.classList.remove('editing');
        }

        // 历史版本分页
        let historyBackups = [];
        let historyCurrentPage = 1;
        let currentDiffBackupIndex = -1;  // 当前 diff 显示的备份索引
        const HISTORY_ROW_HEIGHT = 38; // 每行高度(px): padding 8 + content 24 + border 2 + gap 4
        const HISTORY_MIN_PAGE_SIZE = 10;

        let allAuditLogs = [];  // 原始日志数据
        let auditLogs = [];     // 过滤后的日志
        let auditCurrentPage = 1;
        let activeUserFilter = null;
        let activeActionFilter = null;
        const AUDIT_ROW_HEIGHT = 35; // 每行高度(px)
        const AUDIT_MIN_PAGE_SIZE = 10;

        let allCronLogs = [];   // 原始日志数据
        let cronLogs = [];      // 过滤后的日志
        let cronCurrentPage = 1;
        const CRON_ROW_HEIGHT = 35; // 每行高度(px)
        const CRON_MIN_PAGE_SIZE = 15;

        const PAGE_HEADER_OFFSET = 320; // 页头+tabs+搜索框+表头+分页栏等固定高度

        function getHistoryPageSize() {
            const availableHeight = window.innerHeight - PAGE_HEADER_OFFSET;
            const rows = Math.floor(availableHeight / HISTORY_ROW_HEIGHT);
            return Math.max(HISTORY_MIN_PAGE_SIZE, rows);
        }

        function getAuditPageSize() {
            const availableHeight = window.innerHeight - PAGE_HEADER_OFFSET;
            const rows = Math.floor(availableHeight / AUDIT_ROW_HEIGHT);
            return Math.max(AUDIT_MIN_PAGE_SIZE, rows);
        }

        function getCronPageSize() {
            const availableHeight = window.innerHeight - PAGE_HEADER_OFFSET;
            const rows = Math.floor(availableHeight / CRON_ROW_HEIGHT);
            return Math.max(CRON_MIN_PAGE_SIZE, rows);
        }

        async function loadHistory() {
            const list = document.getElementById('historyList');
            const pagination = document.getElementById('historyPagination');
            try {
                const resp = await fetch(getApiPath('/api/backups'));
                const data = await resp.json();

                if (!data.backups?.length) {
                    list.innerHTML = '<div class="log-empty">No backups found</div>';
                    pagination.innerHTML = '';
                    return;
                }

                historyBackups = data.backups;
                historyCurrentPage = 1;
                renderHistoryPage();
            } catch (e) {
                list.innerHTML = '<div class="log-empty">Failed to load backups</div>';
                pagination.innerHTML = '';
            }
        }

        function renderHistoryPage() {
            const list = document.getElementById('historyList');
            const pageSize = getHistoryPageSize();
            const totalPages = Math.ceil(historyBackups.length / pageSize);
            if (historyCurrentPage > totalPages) historyCurrentPage = Math.max(1, totalPages);
            const start = (historyCurrentPage - 1) * pageSize;
            const end = start + pageSize;
            const pageBackups = historyBackups.slice(start, end);

            list.innerHTML = pageBackups.map(b => {
                // 格式化时间：20251231_151544 -> 2025-12-31 15:15:44
                const ts = b.timestamp.replace(/_/, ' ').replace(/(\d{4})(\d{2})(\d{2}) (\d{2})(\d{2})(\d{2})/, '$1-$2-$3 $4:$5:$6');
                const userLabel = b.username ? `<span class="history-user">${ICON.USER}${escapeHtml(b.username)}</span>` : '';
                return `<div class="history-item">
                    <div class="history-item-header" onclick="toggleHistoryItem(this.parentElement, '${b.filename}')">
                        <span class="history-time">${ts}${userLabel}</span>
                        <div class="history-actions">
                            <button class="history-btn diff-btn" onclick="event.stopPropagation(); showDiff('${b.filename}', '${ts}')">Diff</button>
                            <button class="history-btn restore-btn${USER_CAN_EDIT ? '' : ' no-permission'}" ${USER_CAN_EDIT ? `onclick="event.stopPropagation(); restoreBackup('${b.filename}', '${ts}')"` : ''}>Restore</button>
                        </div>
                    </div>
                </div>`;
            }).join('');

            renderHistoryPagination(totalPages);
        }

        function renderHistoryPagination(totalPages) {
            renderPagination({
                elementId: 'historyPagination',
                currentPage: historyCurrentPage,
                totalPages,
                goPageFn: 'goHistoryPage',
                totalItems: historyBackups.length
            });
        }

        function goHistoryPage(page) {
            const pageSize = getHistoryPageSize();
            const totalPages = Math.ceil(historyBackups.length / pageSize);
            if (page < 1 || page > totalPages) return;
            historyCurrentPage = page;
            renderHistoryPage();
        }

        async function toggleHistoryItem(el, filename) {
            if (el.classList.contains('expanded')) {
                el.classList.remove('expanded');
                el.querySelector('.history-content')?.remove();
                return;
            }

            try {
                const resp = await fetch(getApiPath('/api/backup') + `/${encodeURIComponent(filename)}`);
                const data = await resp.json();
                if (data.content) {
                    el.classList.add('expanded');
                    const contentDiv = document.createElement('div');
                    contentDiv.className = 'history-content';
                    // 应用语法高亮
                    const lines = data.content.split('\n');
                    contentDiv.innerHTML = lines.map(line => `<div>${highlightLine(line)}</div>`).join('');
                    el.appendChild(contentDiv);
                }
            } catch (e) {
                showMessage('Failed to load backup content', 'error');
            }
        }

        // LCS diff 算法
        function computeDiff(oldLines, newLines) {
            const m = oldLines.length, n = newLines.length;
            // 构建 LCS 表
            const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
            for (let i = 1; i <= m; i++) {
                for (let j = 1; j <= n; j++) {
                    if (oldLines[i - 1] === newLines[j - 1]) {
                        dp[i][j] = dp[i - 1][j - 1] + 1;
                    } else {
                        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                    }
                }
            }
            // 回溯生成 diff
            const result = [];
            let i = m, j = n;
            while (i > 0 || j > 0) {
                if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
                    result.unshift({ type: 'same', oldLine: oldLines[i - 1], newLine: newLines[j - 1] });
                    i--; j--;
                } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                    result.unshift({ type: 'add', oldLine: null, newLine: newLines[j - 1] });
                    j--;
                } else {
                    result.unshift({ type: 'remove', oldLine: oldLines[i - 1], newLine: null });
                    i--;
                }
            }
            return result;
        }

        async function showDiff(filename, timestamp) {
            try {
                // 查找当前备份索引
                currentDiffBackupIndex = historyBackups.findIndex(b => b.filename === filename);

                // 获取当前版本和备份版本
                const [currentResp, backupResp] = await Promise.all([
                    fetch(getApiPath('/api/raw')),
                    fetch(getApiPath('/api/backup') + `/${encodeURIComponent(filename)}`)
                ]);
                const currentData = await currentResp.json();
                const backupData = await backupResp.json();

                const currentLines = (currentData.content || '').split('\n');
                const backupLines = (backupData.content || '').split('\n');

                // 使用 LCS diff 算法
                const diff = computeDiff(backupLines, currentLines);
                let currentHtml = '', backupHtml = '';

                for (const d of diff) {
                    if (d.type === 'same') {
                        currentHtml += `<div class="diff-line">${highlightLine(d.newLine)}</div>`;
                        backupHtml += `<div class="diff-line">${highlightLine(d.oldLine)}</div>`;
                    } else if (d.type === 'add') {
                        currentHtml += `<div class="diff-line diff-add">${highlightLine(d.newLine)}</div>`;
                        backupHtml += `<div class="diff-line diff-empty"></div>`;
                    } else if (d.type === 'remove') {
                        currentHtml += `<div class="diff-line diff-empty"></div>`;
                        backupHtml += `<div class="diff-line diff-remove">${highlightLine(d.oldLine)}</div>`;
                    }
                }

                document.getElementById('diffCurrent').innerHTML = currentHtml;
                document.getElementById('diffBackup').innerHTML = backupHtml;
                document.getElementById('diffBackupTime').textContent = timestamp;
                document.getElementById('diffModal').classList.add('show');

                // 更新导航按钮状态
                updateDiffNavButtons();

                // 设置同步滚动
                setupSyncScroll();
            } catch (e) {
                showMessage('Failed to load diff', 'error');
            }
        }

        // 更新 diff 导航按钮状态
        function updateDiffNavButtons() {
            const prevBtn = document.getElementById('diffPrevBtn');
            const nextBtn = document.getElementById('diffNextBtn');
            // 索引越小 = 越新，索引越大 = 越旧
            // prev 按钮：切换到更旧的版本（索引+1）
            // next 按钮：切换到更新的版本（索引-1）
            prevBtn.disabled = currentDiffBackupIndex >= historyBackups.length - 1;
            nextBtn.disabled = currentDiffBackupIndex <= 0;
        }

        // 导航到上一个/下一个备份版本
        async function navigateDiff(direction) {
            // direction: -1 = 更旧的版本（索引+1），1 = 更新的版本（索引-1）
            const newIndex = currentDiffBackupIndex - direction;
            if (newIndex < 0 || newIndex >= historyBackups.length) return;

            // 添加滑动动画
            const titleEl = document.getElementById('diffBackupTime');
            titleEl.classList.remove('slide-left', 'slide-right');
            // 触发重排以重新启动动画
            void titleEl.offsetWidth;
            titleEl.classList.add(direction === 1 ? 'slide-left' : 'slide-right');

            const backup = historyBackups[newIndex];
            const ts = backup.timestamp.replace(/_/, ' ').replace(/(\d{4})(\d{2})(\d{2}) (\d{2})(\d{2})(\d{2})/, '$1-$2-$3 $4:$5:$6');
            await showDiff(backup.filename, ts);
        }

        function setupSyncScroll() {
            const panel1 = document.getElementById('diffCurrent');
            const panel2 = document.getElementById('diffBackup');
            let isSyncing = false;

            const syncScroll = (source, target) => {
                if (isSyncing) return;
                isSyncing = true;
                target.scrollTop = source.scrollTop;
                target.scrollLeft = source.scrollLeft;
                isSyncing = false;
            };

            panel1.onscroll = () => syncScroll(panel1, panel2);
            panel2.onscroll = () => syncScroll(panel2, panel1);
        }

        function closeDiffModal() {
            document.getElementById('diffModal').classList.remove('show');
        }

        async function restoreBackup(filename, timestamp) {
            if (!confirm(`Restore to backup: ${timestamp}?`)) return;

            try {
                const resp = await fetch(getApiPath('/api/restore') + `/${encodeURIComponent(filename)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                const data = await resp.json();
                if (data.success) {
                    showMessage('Restored successfully', 'success');
                    loadRaw();
                    loadHistory();
                } else {
                    showMessage(data.error || 'Restore failed', 'error');
                }
            } catch (e) {
                showMessage('Restore failed', 'error');
            }
        }

        // 点击弹窗外部关闭
        document.getElementById('diffModal').addEventListener('click', function (e) {
            if (e.target === this) closeDiffModal();
        });

        // ========== 日志相关 ==========

        async function loadAuditLogs() {
            const logList = document.getElementById('logList');
            const pagination = document.getElementById('auditPagination');
            const sourceEl = document.getElementById('auditLogSource');
            document.getElementById('auditSearch').value = '';
            activeUserFilter = null;
            activeActionFilter = null;

            try {
                const resp = await fetch(`/api/audit_logs/${encodeURIComponent(currentMachine)}`);
                const data = await resp.json();
                const logs = data.logs || [];

                // 更新 Source 显示
                sourceEl.textContent = data.path || '-';

                if (logs.length === 0) {
                    logList.innerHTML = '<div class="log-empty">No audit logs</div>';
                    pagination.innerHTML = '';
                    allAuditLogs = [];
                    auditLogs = [];
                    return;
                }

                allAuditLogs = logs;
                auditLogs = logs;
                auditCurrentPage = 1;
                renderAuditFilters();
                renderAuditPage();
            } catch (e) {
                logList.innerHTML = '<div class="log-empty">Failed to load</div>';
                pagination.innerHTML = '';
            }
        }

        function renderAuditFilters() {
            const users = [...new Set(allAuditLogs.map(l => l.user))].sort();
            const actions = [...new Set(allAuditLogs.map(l => l.action))].sort();

            const userDropdown = document.getElementById('userFilterDropdown');
            const actionDropdown = document.getElementById('actionFilterDropdown');

            userDropdown.innerHTML = `<div class="filter-option clear" onclick="selectFilter('user', null)">All</div>` +
                users.map(u => `<div class="filter-option${activeUserFilter === u ? ' active' : ''}" onclick="selectFilter('user', '${u}')">${u}</div>`).join('');

            actionDropdown.innerHTML = `<div class="filter-option clear" onclick="selectFilter('action', null)">All</div>` +
                actions.map(a => `<div class="filter-option${activeActionFilter === a ? ' active' : ''}" onclick="selectFilter('action', '${a}')">${a}</div>`).join('');

            // 更新过滤按钮状态
            document.querySelectorAll('.log-col-user .col-filter')[0]?.classList.toggle('active', !!activeUserFilter);
            document.querySelectorAll('.log-col-action .col-filter')[0]?.classList.toggle('active', !!activeActionFilter);
        }

        function toggleFilterDropdown(type) {
            const dropdown = document.getElementById(type + 'FilterDropdown');
            const otherType = type === 'user' ? 'action' : 'user';
            document.getElementById(otherType + 'FilterDropdown').classList.remove('show');
            dropdown.classList.toggle('show');
        }

        function selectFilter(type, value) {
            if (type === 'user') {
                activeUserFilter = value;
            } else {
                activeActionFilter = value;
            }
            document.getElementById(type + 'FilterDropdown').classList.remove('show');
            renderAuditFilters();
            filterAuditLogs();
        }

        // 点击其他地方关闭下拉菜单
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.log-col-user') && !e.target.closest('.log-col-action')) {
                document.getElementById('userFilterDropdown')?.classList.remove('show');
                document.getElementById('actionFilterDropdown')?.classList.remove('show');
            }
        });

        function filterAuditLogs() {
            const keyword = document.getElementById('auditSearch').value.toLowerCase().trim();

            auditLogs = allAuditLogs.filter(log => {
                // 标签过滤
                if (activeUserFilter && log.user !== activeUserFilter) return false;
                if (activeActionFilter && log.action !== activeActionFilter) return false;
                // 关键字过滤
                if (keyword) {
                    const searchText = [log.timestamp, log.user, log.action, formatLogDetails(log.details)].join(' ').toLowerCase();
                    if (!searchText.includes(keyword)) return false;
                }
                return true;
            });

            auditCurrentPage = 1;
            renderAuditPage();
        }

        function renderAuditPage() {
            const logList = document.getElementById('logList');
            const pagination = document.getElementById('auditPagination');

            if (auditLogs.length === 0) {
                logList.innerHTML = '<div class="log-empty">No matching logs</div>';
                pagination.innerHTML = '';
                return;
            }

            const pageSize = getAuditPageSize();
            const totalPages = Math.ceil(auditLogs.length / pageSize);
            // 确保当前页在有效范围内
            if (auditCurrentPage > totalPages) auditCurrentPage = Math.max(1, totalPages);
            const start = (auditCurrentPage - 1) * pageSize;
            const end = start + pageSize;
            const pageLogs = auditLogs.slice(start, end);

            logList.innerHTML = pageLogs.map(log => {
                const actionClass = getActionClass(log.action);
                const details = formatLogDetails(log.details);
                return `
                    <div class="log-item">
                        <span class="log-time">${log.timestamp}</span>
                        <span class="log-user">${ICON.USER}${log.user}</span>
                        <span class="log-action ${actionClass}">${log.action}</span>
                        <span class="log-details">${details}</span>
                    </div>
                `;
            }).join('');

            renderAuditPagination(totalPages);
        }

        function renderAuditPagination(totalPages) {
            renderPagination({
                elementId: 'auditPagination',
                currentPage: auditCurrentPage,
                totalPages,
                goPageFn: 'goAuditPage',
                totalItems: auditLogs.length
            });
        }

        function goAuditPage(page) {
            const pageSize = getAuditPageSize();
            const totalPages = Math.ceil(auditLogs.length / pageSize);
            if (page < 1 || page > totalPages) return;
            auditCurrentPage = page;
            renderAuditPage();
        }

        // 窗口大小变化时重新渲染分页
        window.addEventListener('resize', () => {
            if (historyBackups.length > 0 && document.getElementById('historyView').classList.contains('active')) {
                renderHistoryPage();
            }
            if (auditLogs.length > 0 && document.getElementById('auditLogs').classList.contains('active')) {
                renderAuditPage();
            }
            if (cronLogs.length > 0 && document.getElementById('cronLogs').classList.contains('active')) {
                renderCronPage();
            }
        });

        function getActionClass(action) {
            if (action.includes('login')) return 'login';
            if (action.includes('logout')) return 'logout';
            if (action.includes('add') || action.includes('create')) return 'add';
            if (action.includes('delete')) return 'delete';
            if (action.includes('update') || action.includes('toggle') || action.includes('save')) return 'update';
            return '';
        }

        function formatLogDetails(details) {
            if (!details) return '-';
            if (typeof details === 'string') return details;

            const parts = [];
            if (details.command) parts.push(`cmd: ${details.command}`);
            if (details.schedule) parts.push(`schedule: ${details.schedule}`);
            if (details.title) parts.push(`name: ${details.title}`);
            if (details.group_deleted) parts.push(`group deleted: ${details.group_deleted}`);
            if (details.old_schedule && details.new_schedule) {
                parts.push(`${details.old_schedule} → ${details.new_schedule}`);
            }
            if (details.action === 'enable') parts.push('enabled');
            if (details.action === 'disable') parts.push('disabled');
            if (details.enable !== undefined) parts.push(details.enable ? 'enabled' : 'disabled');
            if (details.length) parts.push(`${details.length} chars`);
            if (details.from_group !== undefined && details.to_group !== undefined) {
                parts.push(`group: ${details.from_group} → ${details.to_group}`);
            }

            return parts.length > 0 ? parts.join(' | ') : JSON.stringify(details);
        }

        // 加载Cron执行日志（支持远程机器）
        async function loadCronLogs() {
            const logList = document.getElementById('cronLogList');
            const pagination = document.getElementById('cronPagination');
            const sourceEl = document.getElementById('cronLogSource');
            const refreshBtn = document.querySelector('.refresh-btn');
            document.getElementById('cronSearch').value = '';

            // 添加旋转动画
            if (refreshBtn) {
                refreshBtn.classList.add('spinning');
                setTimeout(() => refreshBtn.classList.remove('spinning'), 600);
            }

            try {
                const resp = await fetch(`/api/cron_logs/${encodeURIComponent(currentMachine)}`);
                const data = await resp.json();

                sourceEl.textContent = data.source || '-';

                if (data.error) {
                    logList.innerHTML = `<div class="cron-log-error">${escapeHtml(data.error)}</div>`;
                    pagination.innerHTML = '';
                    allCronLogs = [];
                    cronLogs = [];
                    return;
                }

                if (!data.logs || data.logs.length === 0) {
                    logList.innerHTML = '<div class="log-empty">No cron execution logs found</div>';
                    pagination.innerHTML = '';
                    allCronLogs = [];
                    cronLogs = [];
                    return;
                }

                allCronLogs = data.logs;
                cronLogs = data.logs;
                cronCurrentPage = 1;
                renderCronPage();
            } catch (e) {
                logList.innerHTML = '<div class="cron-log-error">Failed to load cron logs</div>';
                pagination.innerHTML = '';
                sourceEl.textContent = '-';
                allCronLogs = [];
                cronLogs = [];
            }
        }

        function filterCronLogs() {
            const keyword = document.getElementById('cronSearch').value.toLowerCase().trim();

            cronLogs = allCronLogs.filter(line => {
                if (!keyword) return true;
                return line.toLowerCase().includes(keyword);
            });

            cronCurrentPage = 1;
            renderCronPage();
        }

        // 格式化时间为统一格式 YYYY-MM-DD HH:MM:SS
        function formatCronTime(timeStr) {
            // ISO 8601: 2026-01-05T21:04:02.768617+08:00 -> 2026-01-05 21:04:02
            const isoMatch = timeStr.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
            if (isoMatch) {
                return `${isoMatch[1]} ${isoMatch[2]}`;
            }
            // Syslog: Jan  5 23:18:01 -> 2026-01-05 23:18:01
            const months = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
            const syslogMatch = timeStr.match(/^(\w{3})\s+(\d+)\s+(\d+:\d+:\d+)$/);
            if (syslogMatch) {
                const month = months[syslogMatch[1]] || '01';
                const day = syslogMatch[2].padStart(2, '0');
                const year = new Date().getFullYear();
                return `${year}-${month}-${day} ${syslogMatch[3]}`;
            }
            return timeStr;
        }

        // 解析 cron log 行：time + host + details
        function parseCronLogLine(line) {
            // 格式1: ISO 8601 时间 - 2026-01-05T21:04:02.768617+08:00 host details...
            const isoMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+[+-]\d{2}:\d{2})\s+(\S+)\s+(.+)$/);
            if (isoMatch) {
                return {
                    time: formatCronTime(isoMatch[1]),
                    host: isoMatch[2],
                    details: isoMatch[3]
                };
            }

            // 格式2: Syslog 时间 - Jan  5 23:18:01 host details...
            const syslogMatch = line.match(/^(\w{3}\s+\d+\s+\d+:\d+:\d+)\s+(\S+)\s+(.+)$/);
            if (syslogMatch) {
                return {
                    time: formatCronTime(syslogMatch[1]),
                    host: syslogMatch[2],
                    details: syslogMatch[3]
                };
            }

            // 无法解析，返回原始行
            return null;
        }

        // 格式化 details，高亮 CMD() 中的内容
        function formatCronDetails(details) {
            const escaped = escapeHtml(details);
            // 匹配 CMD (...) 并高亮括号内内容
            return escaped.replace(/CMD\s+\((.+)\)$/, 'CMD (<span class="cron-cmd-highlight">$1</span>)');
        }

        function renderCronPage() {
            const logList = document.getElementById('cronLogList');
            const pagination = document.getElementById('cronPagination');

            if (cronLogs.length === 0) {
                logList.innerHTML = '<div class="log-empty">No matching logs</div>';
                pagination.innerHTML = '';
                return;
            }

            const pageSize = getCronPageSize();
            const totalPages = Math.ceil(cronLogs.length / pageSize);
            if (cronCurrentPage > totalPages) cronCurrentPage = Math.max(1, totalPages);
            const start = (cronCurrentPage - 1) * pageSize;
            const end = start + pageSize;
            const pageLogs = cronLogs.slice(start, end);

            logList.innerHTML = pageLogs.map(line => {
                const parsed = parseCronLogLine(line);
                if (parsed) {
                    return `<div class="cron-log-line">
                        <span class="cron-time">${escapeHtml(parsed.time)}</span>
                        <span class="cron-host">${ICON.HOST}${escapeHtml(parsed.host)}</span>
                        <span class="cron-details">${formatCronDetails(parsed.details)}</span>
                    </div>`;
                } else {
                    return `<div class="cron-log-line"><span class="cron-raw">${escapeHtml(line)}</span></div>`;
                }
            }).join('');

            renderCronPagination(totalPages);
        }

        function renderCronPagination(totalPages) {
            renderPagination({
                elementId: 'cronPagination',
                currentPage: cronCurrentPage,
                totalPages,
                goPageFn: 'goCronPage',
                totalItems: cronLogs.length
            });
        }

        function goCronPage(page) {
            const pageSize = getCronPageSize();
            const totalPages = Math.ceil(cronLogs.length / pageSize);
            if (page < 1 || page > totalPages) return;
            cronCurrentPage = page;
            renderCronPage();
        }

        // ========== 机器管理 ==========

        // 加载机器列表
        async function loadMachines() {
            try {
                const res = await fetch('/api/machines');
                const data = await res.json();
                // 将数组转换为以 id 为 key 的对象
                machines = {};
                data.machines.forEach(m => {
                    machines[m.id] = m;
                });
                currentMachine = data.default || 'local';

                // 填充机器选择器（user@machine 格式）
                const select = document.getElementById('machineSelect');
                select.innerHTML = '';
                const defaultUser = (machines[currentMachine]?.linux_users || ['root'])[0] || 'root';
                currentLinuxUser = defaultUser;
                for (const [id, config] of Object.entries(machines)) {
                    const users = config.linux_users || ['root'];
                    users.forEach((user, idx) => {
                        const option = document.createElement('option');
                        const userName = user || 'root';
                        option.value = `${userName}@${id}`;
                        option.textContent = `${userName}@${config.name || id}`;
                        if (id === currentMachine && idx === 0) option.selected = true;
                        select.appendChild(option);
                    });
                }

                // 检查连接状态
                checkMachineStatus();
            } catch (e) {
                console.error('Failed to load machines:', e);
            }
        }

        // 获取当前 machine+user 的存储 key
        function getCollapsedStateKey() {
            return `${currentMachine}:${currentLinuxUser}`;
        }

        // 保存当前折叠状态到 Map
        function saveCurrentCollapsedState() {
            const key = getCollapsedStateKey();
            const collapsed = [];
            document.querySelectorAll('.task-group.collapsed').forEach(g => {
                collapsed.push(g.dataset.groupId);
            });
            collapsedStateMap.set(key, collapsed);
        }

        // 恢复折叠状态（如无保存状态则默认全部折叠）
        function restoreOrCollapseAll() {
            const key = getCollapsedStateKey();
            if (collapsedStateMap.has(key)) {
                // 恢复保存的状态
                const collapsedIds = collapsedStateMap.get(key);
                document.querySelectorAll('.task-group').forEach(g => {
                    if (collapsedIds.includes(g.dataset.groupId)) {
                        g.classList.add('collapsed');
                    } else {
                        g.classList.remove('collapsed');
                    }
                });
            } else {
                // 首次访问，默认全部折叠
                document.querySelectorAll('.task-group').forEach(g => {
                    g.classList.add('collapsed');
                });
            }
            updateCollapseToggleBtn();
        }

        // 切换机器（解析 user@machineId 格式）
        async function switchMachine(value) {
            // 保存当前折叠状态
            saveCurrentCollapsedState();
            // 解析 user@machineId 格式
            const [user, machineId] = value.split('@');
            currentLinuxUser = user || 'root';
            currentMachine = machineId;
            await checkMachineStatus();
            refreshCurrentTab();
        }

        // 刷新当前标签页内容
        async function refreshCurrentTab() {
            const activeTab = document.querySelector('.tab.active');
            if (!activeTab) return;

            const tabText = activeTab.textContent.trim();
            if (tabText === 'Task List') {
                await loadTasks();
                restoreOrCollapseAll();
                filterTasks();
            } else if (tabText === 'Raw Version') {
                loadRaw();
                loadHistory();
            } else if (tabText === 'Cron Logs') {
                loadCronLogs();
            } else if (tabText === 'Audit Logs') {
                loadAuditLogs();
            }
        }


        // 检查机器连接状态
        async function checkMachineStatus() {
            const dot = document.getElementById('connectionStatus');
            dot.className = 'status-dot checking';
            dot.title = 'Checking connection...';

            try {
                const res = await fetch(`/api/machine/${currentMachine}/status`);
                const data = await res.json();
                if (data.success) {
                    dot.className = 'status-dot connected';
                    dot.title = `Connected: ${data.message}`;
                } else {
                    dot.className = 'status-dot disconnected';
                    dot.title = `Disconnected: ${data.error || data.message}`;
                }
            } catch (e) {
                dot.className = 'status-dot disconnected';
                dot.title = 'Connection error';
            }
        }

        // 获取 API 路径（带机器参数）
        function getApiPath(base) {
            const user = currentLinuxUser || 'root';
            return `${base}/${encodeURIComponent(currentMachine)}/${encodeURIComponent(user)}`;
        }

        // ========== 数据加载与渲染 ==========

        async function loadTasks() {
            const resp = await fetch(getApiPath('/api/tasks'));
            groups = await resp.json();
            renderTasks();
        }

        // 渲染单个任务（内联编辑模式）
        function renderTask(task, groupId, group) {
            const parts = task.schedule.split(/\s+/);
            const [minute, hour, day, month, weekday] = parts.length >= 5 ? parts : ['*', '*', '*', '*', '*'];
            const cronDescription = parseCronToHuman(minute, hour, day, month, weekday);
            // 直接使用任务名
            const displayName = task.name;
            const noPerm = USER_CAN_EDIT ? '' : ' no-permission';
            const taskName = displayName
                ? `<span class="task-name editable" ${USER_CAN_EDIT ? `ondblclick="editTaskName(${task.id},this)" title="Double-click to edit"` : ''}>${escapeHtml(displayName)}</span>`
                : `<span class="task-name task-name-empty editable" ${USER_CAN_EDIT ? `ondblclick="editTaskName(${task.id},this)" title="Double-click to edit"` : ''}>Unnamed Task</span>`;
            const groupLabel = `<span class="task-group-label" onclick="goToGroup(${groupId})" title="Click to jump to group">${escapeHtml(group.title || 'Unnamed Group')}</span>`;

            return `
            <div class="task-card ${task.enabled ? '' : 'disabled'}" id="task-${task.id}"
                 data-task-id="${task.id}" data-group-id="${groupId}"
                 data-minute="${encodeURIComponent(minute)}" data-hour="${encodeURIComponent(hour)}" data-day="${encodeURIComponent(day)}"
                 data-month="${encodeURIComponent(month)}" data-weekday="${encodeURIComponent(weekday)}" data-command="${encodeURIComponent(task.command)}"
                 data-name="${encodeURIComponent(task.name || '')}"
                 draggable="false" ondragstart="dragTaskStart(event)" ondragend="dragEnd(event)" ondragover="dragTaskOver(event)" ondragleave="dragTaskLeave(event)" ondrop="dropTask(event)">
                <span class="drag-handle${noPerm}" title="Drag to reorder" ${USER_CAN_EDIT ? `onmousedown="enableDrag(this.parentElement)" onmouseup="disableDrag(this.parentElement)" ontouchstart="enableDrag(this.parentElement)" ontouchend="disableDrag(this.parentElement)"` : ''}>⋮⋮</span>
                <div class="toggle ${task.enabled ? 'on' : ''}${noPerm}" ${USER_CAN_EDIT ? `onclick="toggleTask(${task.id})"` : ''}></div>
                <div class="task-info">
                    <div class="task-name-row">${taskName}${groupLabel}</div>
                    <div class="task-schedule-wrapper">
                        <div class="cron-tooltip">${cronDescription}</div>
                        <div class="task-schedule">
                            <span class="${USER_CAN_EDIT ? 'editable ' : ''}time-field" ${USER_CAN_EDIT ? `ondblclick="editField(${task.id},'minute',this)"` : ''} title="Minute">${minute}</span>
                            <span class="${USER_CAN_EDIT ? 'editable ' : ''}time-field" ${USER_CAN_EDIT ? `ondblclick="editField(${task.id},'hour',this)"` : ''} title="Hour">${hour}</span>
                            <span class="${USER_CAN_EDIT ? 'editable ' : ''}time-field" ${USER_CAN_EDIT ? `ondblclick="editField(${task.id},'day',this)"` : ''} title="Day">${day}</span>
                            <span class="${USER_CAN_EDIT ? 'editable ' : ''}time-field" ${USER_CAN_EDIT ? `ondblclick="editField(${task.id},'month',this)"` : ''} title="Month">${month}</span>
                            <span class="${USER_CAN_EDIT ? 'editable ' : ''}time-field" ${USER_CAN_EDIT ? `ondblclick="editField(${task.id},'weekday',this)"` : ''} title="Weekday">${weekday}</span>
                        </div>
                    </div>
                    <div class="task-command">
                        <span class="${USER_CAN_EDIT ? 'editable ' : ''}cmd-field" ${USER_CAN_EDIT ? `ondblclick="editField(${task.id},'command',this)"` : ''}>${escapeHtml(task.command)}</span>
                    </div>
                </div>
                <div class="task-actions">
                    <button class="detail-btn" onclick="showTaskDetail(${task.id})" title="Details">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M12 16v-4M12 8h.01"/>
                        </svg>
                    </button>
                    <button class="run-btn${noPerm}" ${USER_CAN_EDIT ? `onclick="runTask(${task.id})"` : ''} title="Run Now">▶</button>
                    <button class="delete-btn btn-delete-circle${noPerm}" ${USER_CAN_EDIT ? `onclick="deleteTask(${task.id})"` : ''} title="Delete">×</button>
                </div>
            </div>`;
        }

        // 渲染任务列表（按分组）
        function renderTasks() {
            const container = document.getElementById('taskList');
            if (groups.length === 0) {
                container.innerHTML = '<p style="color:#666;padding:20px;">No crontab tasks</p>';
                return;
            }

            const noPerm = USER_CAN_EDIT ? '' : ' no-permission';
            container.innerHTML = groups.map(group => {
                const enabledCount = group.tasks.filter(t => t.enabled).length;
                const allEnabled = enabledCount === group.tasks.length;
                const allDisabled = enabledCount === 0;
                const partial = !allEnabled && !allDisabled;
                const switchClass = allEnabled ? 'on' : (partial ? 'partial' : '');
                return `
                <div class="task-group${allDisabled ? ' disabled' : ''}" id="group-${group.id}" data-group-id="${group.id}" data-title="${escapeHtml(group.title || '')}"
                     draggable="false" ondragstart="dragGroupStart(event)" ondragend="dragEnd(event)" ondragover="dragGroupOver(event)" ondrop="dropGroup(event)">
                    <div class="group-header" onclick="toggleGroupCollapse(${group.id})">
                        <span class="drag-handle group-drag-handle${noPerm}" title="Drag to reorder" onclick="event.stopPropagation()" ${USER_CAN_EDIT ? `onmousedown="enableDrag(this.closest('.task-group'))" onmouseup="disableDrag(this.closest('.task-group'))" ontouchstart="enableDrag(this.closest('.task-group'))" ontouchend="disableDrag(this.closest('.task-group'))"` : ''}>⋮⋮</span>
                        <div class="group-toggle-switch ${switchClass}${noPerm}" ${USER_CAN_EDIT ? `onclick="event.stopPropagation();toggleGroupSwitch(${group.id},${!allEnabled})"` : 'onclick="event.stopPropagation()"'}></div>
                        <span class="group-title" onclick="event.stopPropagation()" ${USER_CAN_EDIT ? `ondblclick="event.stopPropagation();editGroupTitle(${group.id},this)" title="Double-click to edit"` : ''}>${group.title ? escapeHtml(group.title) : 'Unnamed Group'}</span>
                        <span class="group-count">${enabledCount}/${group.tasks.length}</span>
                        <button class="group-delete-btn btn-delete-circle${noPerm}" ${USER_CAN_EDIT ? `onclick="event.stopPropagation();deleteGroup(${group.id})"` : 'onclick="event.stopPropagation()"'} title="Delete group"></button>
                    </div>
                    <div class="group-tasks">
                        ${group.tasks.map(task => renderTask(task, group.id, group)).join('')}
                        <div class="group-drop-end${noPerm}" data-group-id="${group.id}" ${USER_CAN_EDIT ? `ondragover="dragDropEndOver(event)" ondragleave="dragDropEndLeave(event)" ondrop="dropToEnd(event)"` : ''}></div>
                        <div class="group-add-task-btn${noPerm}" ${USER_CAN_EDIT ? `onclick="showGroupAddForm(${group.id})"` : ''}><span class="plus-icon">+</span> New Task</div>
                        <div class="group-add-form" id="group-add-form-${group.id}">
                            <input type="text" id="g${group.id}-name" class="mini-name-input" placeholder="Task name (optional)">
                            <div class="mini-cron-inputs">
                                <input type="text" id="g${group.id}-minute" value="*" placeholder="Min" title="Minute">
                                <input type="text" id="g${group.id}-hour" value="*" placeholder="Hr" title="Hour">
                                <input type="text" id="g${group.id}-day" value="*" placeholder="Day" title="Day">
                                <input type="text" id="g${group.id}-month" value="*" placeholder="Mon" title="Month">
                                <input type="text" id="g${group.id}-weekday" value="*" placeholder="Wk" title="Weekday">
                            </div>
                            <div class="mini-command-row">
                                <input type="text" id="g${group.id}-command" placeholder="Enter command">
                                <button class="mini-add-btn" onclick="addTaskToGroup(${group.id})">Add</button>
                                <button class="mini-cancel-btn" onclick="hideGroupAddForm(${group.id})">Cancel</button>
                            </div>
                        </div>
                    </div>
                </div>
            `}).join('');
        }

        // ========== 组管理（折叠、创建、编辑、删除） ==========

        function toggleGroupCollapse(id) {
            document.getElementById(`group-${id}`).classList.toggle('collapsed');
            updateCollapseToggleBtn();
        }

        // 删除任务组
        async function deleteGroup(groupId) {
            if (!confirm('Delete this task group? This cannot be undone!')) return;
            await apiCall(`/api/delete_group/${groupId}`, { successMsg: 'Group deleted', errorPrefix: 'Delete failed' });
        }

        // 展开全部
        function expandAll() {
            document.querySelectorAll('.task-group').forEach(g => g.classList.remove('collapsed'));
            updateCollapseToggleBtn();
        }

        // 折叠全部
        function collapseAll() {
            document.querySelectorAll('.task-group').forEach(g => g.classList.add('collapsed'));
            updateCollapseToggleBtn();
        }

        // 切换全部折叠/展开
        function toggleAllGroups() {
            const groups = document.querySelectorAll('.task-group');
            const allCollapsed = Array.from(groups).every(g => g.classList.contains('collapsed'));
            if (allCollapsed) {
                expandAll();
            } else {
                collapseAll();
            }
        }

        // 更新折叠切换按钮状态
        function updateCollapseToggleBtn() {
            const btn = document.getElementById('collapseToggleBtn');
            if (!btn) return;
            const groups = document.querySelectorAll('.task-group');
            const allCollapsed = Array.from(groups).every(g => g.classList.contains('collapsed'));
            btn.classList.toggle('all-collapsed', allCollapsed);
            btn.title = allCollapsed ? 'Expand All' : 'Collapse All';
        }

        // 保存折叠状态（返回已折叠的组 ID 数组）
        function saveCollapsedState() {
            const collapsed = [];
            document.querySelectorAll('.task-group.collapsed').forEach(g => {
                collapsed.push(g.dataset.groupId);
            });
            return collapsed;
        }

        // 恢复折叠状态
        function restoreCollapsedState(collapsedIds) {
            document.querySelectorAll('.task-group').forEach(g => {
                if (collapsedIds.includes(g.dataset.groupId)) {
                    g.classList.add('collapsed');
                }
            });
        }

        // 加载任务并保持折叠状态
        async function loadTasksKeepState() {
            const collapsedIds = saveCollapsedState();
            await loadTasks();
            restoreCollapsedState(collapsedIds);
            updateCollapseToggleBtn();
            // 重新应用当前过滤模式和分页
            filterTasks();
        }

        // ========== 搜索过滤 ==========

        let currentFilter = 'all';
        let caseSensitive = false;
        let savedCollapsedState = []; // 保存离开 All 状态时的折叠状态

        // 任务列表分页
        let taskCurrentPage = 1;
        const GROUP_PAGE_SIZE = 20;  // All 模式每页任务组数
        const TASK_PAGE_SIZE = 10;   // Active/Paused 模式每页任务数

        function toggleCaseSensitive() {
            caseSensitive = !caseSensitive;
            taskCurrentPage = 1;
            document.getElementById('caseToggle').classList.toggle('active', caseSensitive);
            filterTasks();
        }

        function setFilter(filter) {
            const prevFilter = currentFilter;
            currentFilter = filter;

            // 切换过滤器时重置页码
            taskCurrentPage = 1;

            // 离开 All 时保存折叠状态
            if (prevFilter === 'all' && filter !== 'all') {
                savedCollapsedState = saveCollapsedState();
            }

            // Update UI
            document.querySelectorAll('.filter-btn').forEach(btn => {
                if (btn.dataset.filter === filter) btn.classList.add('active');
                else btn.classList.remove('active');
            });
            filterTasks();

            // 返回 All 时恢复折叠状态
            if (prevFilter !== 'all' && filter === 'all') {
                restoreCollapsedState(savedCollapsedState);
                updateCollapseToggleBtn();
            }
        }

        // 跳转到指定组（从 Active/Paused 视图跳转到 All 视图）
        function goToGroup(groupId) {
            // 切换到 All 视图
            setFilter('all');

            // 清空搜索框
            document.getElementById('searchBox').value = '';

            // 滚动到目标组
            setTimeout(() => {
                const groupEl = document.getElementById(`group-${groupId}`);
                if (groupEl) {
                    // 展开组
                    groupEl.classList.remove('collapsed');
                    // 滚动到可见位置
                    groupEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // 高亮闪烁效果
                    groupEl.style.transition = 'box-shadow 0.3s ease';
                    groupEl.style.boxShadow = '0 0 0 2px var(--primary)';
                    setTimeout(() => {
                        groupEl.style.boxShadow = '';
                    }, 1500);
                }
            }, 100);
        }

        function filterTasks() {
            const rawKeyword = document.getElementById('searchBox').value.trim();
            const keyword = caseSensitive ? rawKeyword : rawKeyword.toLowerCase();

            const isFlatView = currentFilter !== 'all';
            document.getElementById('taskList').classList.toggle('flat-view', isFlatView);
            document.querySelector('.collapse-controls').classList.toggle('flat-mode', isFlatView);

            // 辅助函数：根据大小写敏感设置进行匹配
            const matchText = (text, kw) => {
                if (!kw) return true;
                return caseSensitive ? text.includes(kw) : text.toLowerCase().includes(kw);
            };

            // 收集可见的组和任务
            const visibleGroups = [];
            const visibleTasks = [];

            document.querySelectorAll('.task-group').forEach(groupEl => {
                const groupTitleEl = groupEl.querySelector('.group-title');
                const originalGroupTitle = groupEl.dataset.title || 'Unnamed Group';
                const tasks = groupEl.querySelectorAll('.task-card');
                let groupMatch = !isFlatView && matchText(originalGroupTitle, keyword);
                let groupVisibleTaskCount = 0;

                // 高亮组名 (only if not flat view)
                if (!isFlatView && keyword && groupMatch) {
                    groupTitleEl.innerHTML = highlightText(originalGroupTitle, keyword);
                } else if (!isFlatView) {
                    groupTitleEl.textContent = originalGroupTitle || 'Unnamed Group';
                }

                tasks.forEach(taskEl => {
                    const commandEl = taskEl.querySelector('.task-command .cmd-field');
                    const minute = decodeURIComponent(taskEl.dataset.minute);
                    const hour = decodeURIComponent(taskEl.dataset.hour);
                    const day = decodeURIComponent(taskEl.dataset.day);
                    const month = decodeURIComponent(taskEl.dataset.month);
                    const weekday = decodeURIComponent(taskEl.dataset.weekday);
                    const command = decodeURIComponent(taskEl.dataset.command);

                    const scheduleText = `${minute} ${hour} ${day} ${month} ${weekday}`;
                    const taskMatch = matchText(scheduleText, keyword) || matchText(command, keyword);

                    let statusMatch = true;
                    const isEnabled = taskEl.querySelector('.toggle').classList.contains('on');
                    if (currentFilter === 'active' && !isEnabled) statusMatch = false;
                    if (currentFilter === 'paused' && isEnabled) statusMatch = false;

                    const isTaskVisible = (keyword === '' || taskMatch || groupMatch) && statusMatch;

                    if (isTaskVisible) {
                        groupVisibleTaskCount++;
                        if (isFlatView) {
                            visibleTasks.push({ taskEl, commandEl, command, keyword, matchText });
                        }
                    }
                    // 标记任务是否可见（用于分页显示）
                    taskEl.dataset.visible = isTaskVisible ? '1' : '0';
                    // 先隐藏所有任务，稍后由分页逻辑显示
                    taskEl.style.display = 'none';

                    // 高亮命令（All 模式也需要）
                    if (!isFlatView && isTaskVisible && keyword && matchText(command, keyword)) {
                        commandEl.innerHTML = highlightText(command, keyword);
                    } else if (!isFlatView && isTaskVisible) {
                        commandEl.textContent = command;
                    }
                });

                // 判断组是否可见
                const isGroupVisible = (!isFlatView && (keyword === '' || groupMatch)) || groupVisibleTaskCount > 0;
                groupEl.style.display = 'none'; // 先隐藏，稍后由分页逻辑显示

                if (isGroupVisible) {
                    visibleGroups.push({ groupEl, groupVisibleTaskCount });
                    if (keyword !== '' || isFlatView) {
                        groupEl.classList.remove('collapsed');
                    }
                }
            });

            // 应用分页
            if (isFlatView) {
                // Active/Paused 模式：按任务分页
                applyTaskPagination(visibleTasks, visibleGroups);
            } else {
                // All 模式：按任务组分页
                applyGroupPagination(visibleGroups);
            }
        }

        // All 模式分页：按任务组
        function applyGroupPagination(visibleGroups) {
            const totalPages = Math.ceil(visibleGroups.length / GROUP_PAGE_SIZE);
            const start = (taskCurrentPage - 1) * GROUP_PAGE_SIZE;
            const end = start + GROUP_PAGE_SIZE;

            visibleGroups.forEach((item, index) => {
                if (index >= start && index < end) {
                    item.groupEl.style.display = 'block';
                    // 只显示可见的任务
                    item.groupEl.querySelectorAll('.task-card').forEach(taskEl => {
                        if (taskEl.dataset.visible === '1') {
                            taskEl.style.display = 'flex';
                        }
                    });
                }
            });

            renderTaskPagination(totalPages, visibleGroups.length, 'groups');
        }

        // Active/Paused 模式分页：按任务
        function applyTaskPagination(visibleTasks, visibleGroups) {
            const totalPages = Math.ceil(visibleTasks.length / TASK_PAGE_SIZE);
            const start = (taskCurrentPage - 1) * TASK_PAGE_SIZE;
            const end = start + TASK_PAGE_SIZE;

            // 记录哪些组有可见任务
            const groupsWithVisibleTasks = new Set();

            visibleTasks.forEach((item, index) => {
                if (index >= start && index < end) {
                    item.taskEl.style.display = 'flex';
                    groupsWithVisibleTasks.add(item.taskEl.closest('.task-group'));

                    // 高亮命令
                    if (item.keyword && item.matchText(item.command, item.keyword)) {
                        item.commandEl.innerHTML = highlightText(item.command, item.keyword);
                    } else {
                        item.commandEl.textContent = item.command;
                    }
                }
            });

            // 显示有可见任务的组
            groupsWithVisibleTasks.forEach(groupEl => {
                groupEl.style.display = 'block';
            });

            renderTaskPagination(totalPages, visibleTasks.length, 'tasks');
        }

        // 渲染任务分页控件
        function renderTaskPagination(totalPages, totalItems, itemType) {
            renderPagination({
                elementId: 'taskPagination',
                currentPage: taskCurrentPage,
                totalPages,
                goPageFn: 'goTaskPage',
                totalItems,
                itemType,
                showDisplay: true
            });
        }

        // 跳转到指定页
        function goTaskPage(page) {
            const isFlatView = currentFilter !== 'all';
            // 需要重新计算总页数
            taskCurrentPage = page;
            filterTasks();
        }

        // 显示新建任务组表单
        function showNewGroupForm() {
            document.getElementById('newGroupForm').classList.add('active');
            document.getElementById('newGroupTitle').focus();
        }

        // 隐藏新建任务组表单
        function hideNewGroupForm() {
            document.getElementById('newGroupForm').classList.remove('active');
            document.getElementById('newGroupTitle').value = '';
        }

        // 创建新任务组
        async function createGroup() {
            const title = document.getElementById('newGroupTitle').value.trim();
            if (!title) {
                showMessage('Please enter group name', 'error');
                return;
            }

            const resp = await fetch('/api/create_group', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, machine_id: currentMachine, linux_user: currentLinuxUser || 'root' })
            });
            const result = await resp.json();
            if (result.success) {
                showMessage('Group created', 'success');
                hideNewGroupForm();
                loadTasksKeepState();
            } else {
                showMessage('Create failed: ' + result.error, 'error');
            }
        }

        // 显示组内添加任务表单
        function showGroupAddForm(groupId) {
            document.getElementById(`group-add-form-${groupId}`).classList.add('active');
            document.getElementById(`g${groupId}-command`).focus();
        }

        // 隐藏组内添加任务表单
        function hideGroupAddForm(groupId) {
            document.getElementById(`group-add-form-${groupId}`).classList.remove('active');
            // 重置表单
            document.getElementById(`g${groupId}-name`).value = '';
            document.getElementById(`g${groupId}-minute`).value = '*';
            document.getElementById(`g${groupId}-hour`).value = '*';
            document.getElementById(`g${groupId}-day`).value = '*';
            document.getElementById(`g${groupId}-month`).value = '*';
            document.getElementById(`g${groupId}-weekday`).value = '*';
            document.getElementById(`g${groupId}-command`).value = '';
        }

        // 向组内添加任务
        async function addTaskToGroup(groupId) {
            const name = document.getElementById(`g${groupId}-name`).value.trim();
            const minute = document.getElementById(`g${groupId}-minute`).value.trim() || '*';
            const hour = document.getElementById(`g${groupId}-hour`).value.trim() || '*';
            const day = document.getElementById(`g${groupId}-day`).value.trim() || '*';
            const month = document.getElementById(`g${groupId}-month`).value.trim() || '*';
            const weekday = document.getElementById(`g${groupId}-weekday`).value.trim() || '*';
            const command = document.getElementById(`g${groupId}-command`).value.trim();

            if (!command) {
                showMessage('Please enter command', 'error');
                return;
            }

            const schedule = `${minute} ${hour} ${day} ${month} ${weekday}`;
            const body = { schedule, command, machine_id: currentMachine, linux_user: currentLinuxUser || 'root' };
            if (name) body.name = name;
            const resp = await fetch(`/api/add_to_group/${groupId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const result = await resp.json();
            if (result.success) {
                showMessage('Task added', 'success');
                hideGroupAddForm(groupId);
                loadTasksKeepState();
            } else {
                showMessage('Add failed: ' + result.error, 'error');
            }
        }

        // 双击编辑组名称
        function editGroupTitle(groupId, element) {
            const groupEl = document.getElementById(`group-${groupId}`);
            const currentTitle = groupEl.dataset.title || '';
            const originalText = element.textContent;

            // 创建输入框
            const input = document.createElement('input');
            input.type = 'text';
            input.value = currentTitle;
            input.placeholder = 'Enter group name';

            element.textContent = '';
            element.appendChild(input);
            input.focus();
            input.select();

            // 保存函数
            const save = async () => {
                const newTitle = input.value.trim();
                if (!newTitle) {
                    element.textContent = originalText;
                    return;
                }

                const resp = await fetch(`/api/update_group_title/${groupId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: newTitle, machine_id: currentMachine, linux_user: currentLinuxUser || 'root' })
                });
                const result = await resp.json();
                if (result.success) {
                    showMessage('Group renamed', 'success');
                    loadTasksKeepState();
                } else {
                    showMessage('Rename failed: ' + result.error, 'error');
                    element.textContent = originalText;
                }
            };

            // 取消函数
            const cancel = () => {
                element.textContent = originalText;
            };

            // 事件处理
            input.onblur = save;
            input.onkeydown = (e) => {
                if (e.key === 'Enter') { input.blur(); }
                if (e.key === 'Escape') { input.onblur = cancel; input.blur(); }
            };
        }

        // 启用/禁用整个组
        async function toggleGroupSwitch(groupId, enable) {
            // 先更新 UI
            const groupEl = document.getElementById(`group-${groupId}`);
            const switchEl = groupEl.querySelector('.group-toggle-switch');
            const prevClass = switchEl.className;
            switchEl.classList.remove('on', 'partial');
            if (enable) switchEl.classList.add('on');
            groupEl.classList.toggle('disabled', !enable);

            // 更新组内所有任务的 UI
            groupEl.querySelectorAll('.task-card').forEach(card => {
                const toggle = card.querySelector('.toggle');
                if (enable) {
                    toggle.classList.add('on');
                    card.classList.remove('disabled');
                } else {
                    toggle.classList.remove('on');
                    card.classList.add('disabled');
                }
            });

            const resp = await fetch(`/api/toggle_group/${groupId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enable, machine_id: currentMachine, linux_user: currentLinuxUser || 'root' })
            });
            const result = await resp.json();
            if (result.success) {
                showMessage(enable ? 'Group enabled' : 'Group disabled', 'success');
                setTimeout(() => loadTasksKeepState(), 300);
            } else {
                // Restore state
                switchEl.className = prevClass;
                showMessage('Operation failed: ' + result.error, 'error');
                loadTasksKeepState();
            }
        }

        // ========== 任务管理（编辑、删除、运行） ==========

        function editField(taskId, field, element) {
            const card = document.getElementById(`task-${taskId}`);
            const currentValue = decodeURIComponent(card.dataset[field]);
            const isCmd = field === 'command';

            // 创建输入框
            const input = document.createElement('input');
            input.type = 'text';
            input.className = isCmd ? 'cmd-input' : 'time-input';
            input.value = currentValue;

            // 保存原始内容
            const originalText = element.textContent;
            element.textContent = '';
            element.appendChild(input);
            input.focus();
            input.select();

            // 保存函数
            const save = async () => {
                const newValue = input.value.trim() || (isCmd ? '' : '*');
                if (isCmd && !newValue) {
                    showMessage('Command cannot be empty', 'error');
                    element.textContent = originalText;
                    return;
                }

                // 更新data属性
                card.dataset[field] = encodeURIComponent(newValue);
                element.textContent = newValue;

                // 获取所有字段值并保存
                const schedule = `${decodeURIComponent(card.dataset.minute)} ${decodeURIComponent(card.dataset.hour)} ${decodeURIComponent(card.dataset.day)} ${decodeURIComponent(card.dataset.month)} ${decodeURIComponent(card.dataset.weekday)}`;
                const command = decodeURIComponent(card.dataset.command);

                const resp = await fetch(`/api/update/${taskId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ schedule, command, machine_id: currentMachine, linux_user: currentLinuxUser || 'root' })
                });
                const result = await resp.json();
                if (result.success) {
                    showMessage('Saved', 'success');
                } else {
                    showMessage('Save failed: ' + result.error, 'error');
                    element.textContent = originalText;
                    card.dataset[field] = encodeURIComponent(currentValue);
                }
            };

            // 取消函数
            const cancel = () => {
                element.textContent = originalText;
            };

            // 事件处理
            input.onblur = save;
            input.onkeydown = (e) => {
                if (e.key === 'Enter') { input.blur(); }
                if (e.key === 'Escape') { input.onblur = cancel; input.blur(); }
            };
        }

        // 编辑任务名
        async function editTaskName(taskId, element) {
            const card = document.getElementById(`task-${taskId}`);
            const currentName = decodeURIComponent(card.dataset.name || '');
            const isEmpty = element.classList.contains('task-name-empty');

            // 创建输入框
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'name-input';
            input.value = currentName;
            input.placeholder = 'Task name';
            input.style.cssText = 'width: 200px; padding: 2px 6px; font-size: 12px; border: 1px solid var(--primary); border-radius: 4px;';

            // 保存原始内容
            const originalText = element.textContent;
            element.textContent = '';
            element.appendChild(input);
            input.focus();
            input.select();

            // 保存函数
            const save = async () => {
                const newName = input.value.trim();

                const resp = await fetch(`/api/update_task_name/${taskId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: newName, machine_id: currentMachine, linux_user: currentLinuxUser || 'root' })
                });
                const result = await resp.json();

                if (result.success) {
                    card.dataset.name = encodeURIComponent(newName);
                    if (newName) {
                        element.textContent = newName;
                        element.classList.remove('task-name-empty');
                    } else {
                        element.textContent = 'Unnamed Task';
                        element.classList.add('task-name-empty');
                    }
                } else {
                    showMessage('Save failed: ' + result.error, 'error');
                    element.textContent = originalText;
                }
            };

            // 取消函数
            const cancel = () => {
                element.textContent = originalText;
            };

            // 事件处理
            input.onblur = save;
            input.onkeydown = (e) => {
                if (e.key === 'Enter') { input.blur(); }
                if (e.key === 'Escape') { input.onblur = cancel; input.blur(); }
            };
        }

        // 显示任务详情
        function showTaskDetail(id) {
            const card = document.getElementById(`task-${id}`);
            const name = decodeURIComponent(card.dataset.name) || 'Unnamed Task';
            const command = decodeURIComponent(card.dataset.command);
            const minute = decodeURIComponent(card.dataset.minute);
            const hour = decodeURIComponent(card.dataset.hour);
            const day = decodeURIComponent(card.dataset.day);
            const month = decodeURIComponent(card.dataset.month);
            const weekday = decodeURIComponent(card.dataset.weekday);
            const schedule = `${minute} ${hour} ${day} ${month} ${weekday}`;
            const enabled = !card.classList.contains('disabled');

            alert(`Task Details\n\nName: ${name}\nSchedule: ${schedule}\nCommand: ${command}\nStatus: ${enabled ? 'Enabled' : 'Disabled'}`);
        }

        // Run task manually（手动运行任务）
        async function runTask(id) {
            const card = document.getElementById(`task-${id}`);
            const command = decodeURIComponent(card.dataset.command);

            // 显示确认对话框
            if (!confirm(`Run this task now?\n\nCommand: ${command}`)) {
                return;
            }

            const resp = await fetch(`/api/run/${id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ machine_id: currentMachine, linux_user: currentLinuxUser || 'root' })
            });
            const result = await resp.json();
            if (result.success) {
                showMessage(`Task completed (code: ${result.returncode})`, 'success');
            } else {
                showMessage('Run failed: ' + result.error, 'error');
            }
        }

        // Delete task（带撤销功能）
        async function deleteTask(id) {
            // 获取任务信息用于撤销
            const card = document.getElementById(`task-${id}`);
            const groupId = card.dataset.groupId;
            const minute = decodeURIComponent(card.dataset.minute);
            const hour = decodeURIComponent(card.dataset.hour);
            const day = decodeURIComponent(card.dataset.day);
            const month = decodeURIComponent(card.dataset.month);
            const weekday = decodeURIComponent(card.dataset.weekday);
            const command = decodeURIComponent(card.dataset.command);
            const enabled = card.querySelector('.toggle').classList.contains('on');
            const schedule = `${minute} ${hour} ${day} ${month} ${weekday}`;

            const resp = await fetch(`/api/delete/${id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ machine_id: currentMachine, linux_user: currentLinuxUser || 'root' })
            });
            const result = await resp.json();
            if (result.success) {
                // 显示撤销提示
                showUndoToast('Task deleted', {
                    type: 'delete_task',
                    groupId: parseInt(groupId),
                    schedule: schedule,
                    command: command,
                    enabled: enabled
                });
                loadTasksKeepState();
            } else {
                showMessage('Delete failed: ' + result.error, 'error');
            }
        }

        // 切换任务状态
        async function toggleTask(id) {
            // 先更新 UI
            const card = document.getElementById(`task-${id}`);
            const toggle = card.querySelector('.toggle');
            const isOn = toggle.classList.contains('on');
            toggle.classList.toggle('on');
            card.classList.toggle('disabled');

            // 更新所属任务组的开关状态
            const groupEl = card.closest('.task-group');
            if (groupEl) {
                updateGroupSwitchState(groupEl);
            }

            const resp = await fetch(`/api/toggle/${id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ machine_id: currentMachine, linux_user: currentLinuxUser || 'root' })
            });
            const result = await resp.json();
            if (result.success) {
                showMessage('Status updated', 'success');
                // Delay refresh for transition effect
                setTimeout(() => loadTasksKeepState(), 300);
            } else {
                // Restore state
                toggle.classList.toggle('on');
                card.classList.toggle('disabled');
                if (groupEl) updateGroupSwitchState(groupEl);
                showMessage('Operation failed: ' + result.error, 'error');
            }
        }

        // 更新任务组开关状态
        function updateGroupSwitchState(groupEl) {
            const tasks = groupEl.querySelectorAll('.task-card');
            const toggles = groupEl.querySelectorAll('.task-card .toggle');
            let enabledCount = 0;
            toggles.forEach(t => { if (t.classList.contains('on')) enabledCount++; });

            const switchEl = groupEl.querySelector('.group-toggle-switch');
            const allEnabled = enabledCount === tasks.length;
            const allDisabled = enabledCount === 0;
            const partial = !allEnabled && !allDisabled;

            switchEl.classList.remove('on', 'partial');
            if (allEnabled) switchEl.classList.add('on');
            else if (partial) switchEl.classList.add('partial');

            groupEl.classList.toggle('disabled', allDisabled);

            // 更新计数显示
            const countEl = groupEl.querySelector('.group-count');
            if (countEl) countEl.textContent = `${enabledCount}/${tasks.length}`;
        }

        // ========== 原始编辑器 ==========

        async function loadRaw() {
            const resp = await fetch(getApiPath('/api/raw'));
            const data = await resp.json();
            document.getElementById('rawContent').value = data.content;
            updateHighlight();
        }

        // Crontab 单行语法高亮
        function highlightLine(line) {
            const escaped = escapeHtml(line);
            // 空行
            if (!line.trim()) return escaped;
            // 注释行
            if (line.trim().startsWith('#')) {
                // 被禁用的任务（# 开头但后面是 cron 格式）
                if (/^#\s*[\d\*]/.test(line.trim())) {
                    return `<span class="hl-disabled">${escaped}</span>`;
                }
                return `<span class="hl-comment">${escaped}</span>`;
            }
            // 环境变量 NAME=value
            const envMatch = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
            if (envMatch) {
                const key = escapeHtml(envMatch[1]);
                const val = escapeHtml(envMatch[2]);
                return `<span class="hl-env-key">${key}</span>=<span class="hl-env-value">${val}</span>`;
            }
            // Cron 任务行：分 时 日 月 周 命令
            const cronMatch = line.match(/^([\d\*\/\-,]+\s+[\d\*\/\-,]+\s+[\d\*\/\-,]+\s+[\d\*\/\-,]+\s+[\d\*\/\-,]+)\s+(.+)$/);
            if (cronMatch) {
                const schedule = escapeHtml(cronMatch[1]);
                const cmd = escapeHtml(cronMatch[2]);
                return `<span class="hl-schedule">${schedule}</span> <span class="hl-command">${cmd}</span>`;
            }
            return escaped;
        }

        // Crontab 多行语法高亮
        function highlightCrontab(text) {
            return text.split('\n').map(highlightLine).join('\n');
        }

        function updateHighlight() {
            const textarea = document.getElementById('rawContent');
            const highlight = document.getElementById('codeHighlight');
            highlight.innerHTML = highlightCrontab(textarea.value) + '\n';
        }

        function syncHighlightScroll() {
            const textarea = document.getElementById('rawContent');
            const highlight = document.getElementById('codeHighlight');
            highlight.scrollTop = textarea.scrollTop;
            highlight.scrollLeft = textarea.scrollLeft;
        }

        // 保存原始内容
        async function saveRaw() {
            const content = document.getElementById('rawContent').value;
            await apiCall('/api/save', { body: { content }, successMsg: 'Saved successfully', errorPrefix: 'Save failed', reload: false });
        }

        // 显示消息
        function showMessage(text, type) {
            const msg = document.getElementById('message');
            msg.textContent = text;
            msg.className = 'message ' + type;
            setTimeout(() => { msg.className = 'message'; }, 3000);
        }

        // HTML转义
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // ========== 拖拽排序 ==========

        // 启用拖拽（仅在拖拽手柄上按下时）
        function enableDrag(element) {
            element.setAttribute('draggable', 'true');
        }

        // 禁用拖拽
        function disableDrag(element) {
            // 只有在非拖拽状态下才禁用，防止拖拽过程中被意外禁用
            if (!isDragging) {
                element.setAttribute('draggable', 'false');
            }
        }

        // 清除所有拖拽指示器
        function clearDragIndicators() {
            document.querySelectorAll('.drag-over').forEach(el => {
                el.classList.remove('drag-over');
            });
            document.querySelectorAll('.group-drop-end.visible').forEach(el => el.classList.remove('visible'));
            // 移除占位符元素
            if (dragPlaceholder && dragPlaceholder.parentNode) {
                dragPlaceholder.parentNode.removeChild(dragPlaceholder);
            }
            dragPlaceholder = null;
        }

        // 全局清理拖拽状态（更可靠的重置）
        function cleanupDragState() {
            if (dragRafId) {
                cancelAnimationFrame(dragRafId);
                dragRafId = null;
            }
            if (draggedElement) {
                draggedElement.classList.remove('dragging', 'dragging-collapsed');
                draggedElement.setAttribute('draggable', 'false');
            }
            clearDragIndicators();
            draggedElement = null;
            dragType = null;
            lastDragOverTarget = null;
            isDragging = false;
        }

        // 全局事件监听：处理拖拽在窗口外结束的情况
        document.addEventListener('dragend', cleanupDragState);
        window.addEventListener('blur', cleanupDragState);
        document.addEventListener('drop', function (e) {
            // 如果 drop 发生在非目标区域，也要清理状态
            setTimeout(cleanupDragState, 100);
        });

        // 组拖拽开始（仅折叠状态允许拖拽）
        function dragGroupStart(e) {
            if (!e.target.classList.contains('task-group')) return;
            // 仅折叠状态允许拖拽
            if (!e.target.classList.contains('collapsed')) {
                e.preventDefault();
                return;
            }
            isDragging = true;
            draggedElement = e.target;
            dragType = 'group';
            e.target.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', e.target.dataset.groupId);

            // 延迟创建占位符（等拖影生成后）
            setTimeout(() => {
                if (!draggedElement) return;
                // 获取元素高度
                const rect = draggedElement.getBoundingClientRect();
                // 创建占位符在原位置
                dragPlaceholder = document.createElement('div');
                dragPlaceholder.className = 'drag-placeholder-group';
                dragPlaceholder.style.height = rect.height + 'px'; // 直接设置高度
                dragPlaceholder.addEventListener('dragover', (ev) => ev.preventDefault());
                dragPlaceholder.addEventListener('drop', dropGroup);
                // 插入到被拖拽元素之后
                draggedElement.parentNode.insertBefore(dragPlaceholder, draggedElement.nextSibling);
                // 记录原位置信息
                dragPlaceholder.dataset.targetGroupId = draggedElement.dataset.groupId;
                // 隐藏原元素
                draggedElement.classList.add('dragging-collapsed');
            }, 0);
        }

        // 任务拖拽开始
        function dragTaskStart(e) {
            if (!e.target.classList.contains('task-card')) return;
            isDragging = true;
            draggedElement = e.target;
            dragType = 'task';
            e.target.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', e.target.dataset.taskId);

            // 延迟创建占位符（等拖影生成后）
            setTimeout(() => {
                if (!draggedElement) return;
                // 获取元素高度
                const rect = draggedElement.getBoundingClientRect();
                // 创建占位符在原位置
                dragPlaceholder = document.createElement('div');
                dragPlaceholder.className = 'drag-placeholder';
                dragPlaceholder.style.height = rect.height + 'px'; // 直接设置高度
                dragPlaceholder.addEventListener('dragover', (ev) => ev.preventDefault());
                dragPlaceholder.addEventListener('drop', dropTask);
                // 插入到被拖拽元素之后
                draggedElement.parentNode.insertBefore(dragPlaceholder, draggedElement.nextSibling);
                // 记录原位置信息
                dragPlaceholder.dataset.targetTaskId = draggedElement.dataset.taskId;
                dragPlaceholder.dataset.targetGroupId = draggedElement.dataset.groupId;
                dragPlaceholder.dataset.insertBefore = 'false';
                // 隐藏原元素
                draggedElement.classList.add('dragging-collapsed');
            }, 0);
        }

        // 拖拽结束
        function dragEnd(e) {
            cleanupDragState();
        }

        // 组拖拽悬停（带节流）
        function dragGroupOver(e) {
            e.preventDefault();
            if (dragType !== 'group') return;

            const target = e.target.closest('.task-group');
            if (!target || target === draggedElement) return;

            // 使用 RAF 节流
            if (dragRafId) return;

            const clientY = e.clientY;
            dragRafId = requestAnimationFrame(() => {
                dragRafId = null;
                if (!isDragging || !target || !dragPlaceholder) return;

                // 计算鼠标相对于组的位置（添加死区）
                const rect = target.getBoundingClientRect();
                const deadZone = rect.height * 0.2;
                const midY = rect.top + rect.height / 2;

                // 死区检查
                if (lastDragOverTarget === target && Math.abs(clientY - midY) < deadZone) {
                    return;
                }

                const isTopHalf = clientY < midY;
                const targetParent = target.parentNode;
                const insertRef = isTopHalf ? target : target.nextSibling;
                const targetHeight = rect.height;

                // 位置变化时移动占位符
                if (dragPlaceholder.nextSibling !== insertRef || dragPlaceholder.parentNode !== targetParent) {
                    targetParent.insertBefore(dragPlaceholder, insertRef);
                    dragPlaceholder.style.height = targetHeight + 'px';
                }

                // 记录目标位置
                dragPlaceholder.dataset.targetGroupId = target.dataset.groupId;
                dragPlaceholder.dataset.insertBefore = isTopHalf ? 'true' : 'false';

                lastDragOverTarget = target;
            });
        }

        // 任务拖拽悬停（检测鼠标位置，插入占位符）- 使用 RAF 节流
        function dragTaskOver(e) {
            e.preventDefault();
            if (dragType !== 'task') return;

            const target = e.target.closest('.task-card');
            if (!target || target === draggedElement) return;

            // 使用 requestAnimationFrame 节流，避免频繁的 DOM 操作
            if (dragRafId) return;

            const clientY = e.clientY;
            dragRafId = requestAnimationFrame(() => {
                dragRafId = null;
                if (!isDragging || !target) return;

                // 清除末尾放置区
                document.querySelectorAll('.group-drop-end.visible').forEach(el => {
                    el.classList.remove('visible');
                });

                // 计算鼠标相对于卡片的位置（添加死区避免抖动）
                const rect = target.getBoundingClientRect();
                const deadZone = rect.height * 0.2; // 20% 死区
                const midY = rect.top + rect.height / 2;

                // 如果已有占位符且目标相同，检查是否在死区内
                if (dragPlaceholder && lastDragOverTarget === target) {
                    if (Math.abs(clientY - midY) < deadZone) {
                        return; // 在死区内，不改变位置
                    }
                }

                const isTopHalf = clientY < midY;

                // 占位符已在 dragTaskStart 中创建，这里只处理移动
                if (!dragPlaceholder) return;

                // 确定插入位置
                const targetParent = target.parentNode;
                const insertRef = isTopHalf ? target : target.nextSibling;
                const targetHeight = rect.height;

                // 位置变化时移动占位符
                if (dragPlaceholder.nextSibling !== insertRef || dragPlaceholder.parentNode !== targetParent) {
                    targetParent.insertBefore(dragPlaceholder, insertRef);
                    dragPlaceholder.style.height = targetHeight + 'px';
                }

                // 记录目标和位置，供 drop 使用
                dragPlaceholder.dataset.targetTaskId = target.dataset.taskId;
                dragPlaceholder.dataset.targetGroupId = target.dataset.groupId;
                dragPlaceholder.dataset.insertBefore = isTopHalf ? 'true' : 'false';

                lastDragOverTarget = target;
            });
        }

        // 任务拖拽离开
        function dragTaskLeave(e) {
            // 使用占位符后，不需要在 leave 时清理类名
            // 占位符会在 dragend 或 drop 时统一清理
        }

        // 组放置
        async function dropGroup(e) {
            e.preventDefault();
            if (dragType !== 'group' || !draggedElement) return;

            // 支持放置在占位符或组上
            const target = e.target.closest('.task-group') || (dragPlaceholder ? dragPlaceholder : null);
            if (!target) return;
            if (target.classList && target.classList.contains('task-group') && target === draggedElement) return;

            // 保存引用
            const elementToMove = draggedElement;
            const fromId = parseInt(elementToMove.dataset.groupId);

            // 从占位符获取目标信息
            let toId, insertBefore;
            if (dragPlaceholder && dragPlaceholder.dataset.targetGroupId) {
                toId = parseInt(dragPlaceholder.dataset.targetGroupId);
                insertBefore = dragPlaceholder.dataset.insertBefore === 'true';
            } else if (target.classList && target.classList.contains('task-group')) {
                toId = parseInt(target.dataset.groupId);
                const rect = target.getBoundingClientRect();
                insertBefore = e.clientY < rect.top + rect.height / 2;
            } else {
                return;
            }

            // 先用 DOM 操作将元素移动到占位符位置
            if (dragPlaceholder && dragPlaceholder.parentNode) {
                dragPlaceholder.parentNode.insertBefore(elementToMove, dragPlaceholder);
            }

            // 清理拖拽状态
            cleanupDragState();

            // 调用后端 API 重新排序
            const resp = await fetch('/api/reorder_groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ from_id: fromId, to_id: toId, insert_before: insertBefore, machine_id: currentMachine, linux_user: currentLinuxUser || 'root' })
            });
            const result = await resp.json();
            if (result.success) {
                showMessage('Groups reordered', 'success');
                setTimeout(loadTasksKeepState, 300);
            } else {
                showMessage('Reorder failed: ' + result.error, 'error');
                loadTasksKeepState();
            }
        }

        // 任务放置
        async function dropTask(e) {
            e.preventDefault();
            if (dragType !== 'task' || !draggedElement) return;

            // 支持放置在占位符或任务卡片上
            const target = e.target.closest('.task-card') || (dragPlaceholder ? dragPlaceholder : null);
            if (!target) return;
            if (target.classList && target.classList.contains('task-card') && target === draggedElement) return;

            // 从占位符获取位置信息（优先），或者使用目标卡片的信息
            const elementToMove = draggedElement;
            let insertBefore, toTaskId, toGroupId;

            if (dragPlaceholder && dragPlaceholder.dataset.targetTaskId) {
                insertBefore = dragPlaceholder.dataset.insertBefore === 'true';
                toTaskId = parseInt(dragPlaceholder.dataset.targetTaskId);
                toGroupId = parseInt(dragPlaceholder.dataset.targetGroupId);
            } else if (target.classList && target.classList.contains('task-card')) {
                // 兜底：直接放在卡片上
                const rect = target.getBoundingClientRect();
                insertBefore = e.clientY < rect.top + rect.height / 2;
                toTaskId = parseInt(target.dataset.taskId);
                toGroupId = parseInt(target.dataset.groupId);
            } else {
                return; // 无有效目标
            }

            const fromTaskId = parseInt(elementToMove.dataset.taskId);
            const fromGroupId = parseInt(elementToMove.dataset.groupId);

            // 先用 DOM 操作将元素移动到占位符位置（即时视觉反馈）
            if (dragPlaceholder && dragPlaceholder.parentNode) {
                dragPlaceholder.parentNode.insertBefore(elementToMove, dragPlaceholder);
                // 更新 data-group-id（如果跨组移动）
                if (fromGroupId !== toGroupId) {
                    elementToMove.dataset.groupId = toGroupId;
                }
            }

            // 清理拖拽状态
            cleanupDragState();

            // 调用后端 API 重新排序
            const resp = await fetch('/api/reorder_tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from_task_id: fromTaskId,
                    from_group_id: fromGroupId,
                    to_task_id: toTaskId,
                    to_group_id: toGroupId,
                    insert_before: insertBefore,
                    machine_id: currentMachine,
                    linux_user: currentLinuxUser || 'root'
                })
            });
            const result = await resp.json();
            if (result.success) {
                showMessage('Tasks reordered', 'success');
                // 延迟加载以确保数据同步
                setTimeout(loadTasksKeepState, 300);
            } else {
                showMessage('Reorder failed: ' + result.error, 'error');
                loadTasksKeepState(); // 失败时重新加载以恢复原状
            }
        }

        // 末尾放置区悬停
        function dragDropEndOver(e) {
            e.preventDefault();
            if (dragType !== 'task') return;
            // 移除占位符
            if (dragPlaceholder && dragPlaceholder.parentNode) {
                dragPlaceholder.parentNode.removeChild(dragPlaceholder);
                dragPlaceholder = null;
            }
            // 显示当前末尾放置区
            e.target.classList.add('visible');
        }

        // 末尾放置区离开
        function dragDropEndLeave(e) {
            e.target.classList.remove('visible');
        }

        // 放置到组末尾
        async function dropToEnd(e) {
            e.preventDefault();
            if (dragType !== 'task' || !draggedElement) return;

            const dropZone = e.target.closest('.group-drop-end');
            if (!dropZone) return;

            // 保存引用
            const elementToMove = draggedElement;
            const fromTaskId = parseInt(elementToMove.dataset.taskId);
            const fromGroupId = parseInt(elementToMove.dataset.groupId);
            const toGroupId = parseInt(dropZone.dataset.groupId);

            // 先清理拖拽状态，防止卡住
            cleanupDragState();

            // 调用后端 API 移动到末尾
            const resp = await fetch('/api/move_task_to_end', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task_id: fromTaskId,
                    from_group_id: fromGroupId,
                    to_group_id: toGroupId,
                    machine_id: currentMachine,
                    linux_user: currentLinuxUser || 'root'
                })
            });
            const result = await resp.json();
            if (result.success) {
                showMessage('Task moved', 'success');
                // 使用 DOM 操作移动节点到组末尾（dropZone 之前）
                dropZone.parentNode.insertBefore(elementToMove, dropZone);
                // 更新 data-group-id
                if (fromGroupId !== toGroupId) {
                    elementToMove.dataset.groupId = toGroupId;
                }
                // 延迟加载以确保数据同步
                setTimeout(loadTasksKeepState, 300);
            } else {
                showMessage('Move failed: ' + result.error, 'error');
                loadTasksKeepState();
            }
        }

        // ========== 用户管理 (仅 admin) ==========

        async function loadUsers() {
            if (!USER_CAN_ADMIN) return;
            try {
                const resp = await fetch('/api/users');
                if (!resp.ok) {
                    document.getElementById('userList').innerHTML = '<div class="log-empty">Permission denied</div>';
                    return;
                }
                const data = await resp.json();
                renderUserList(data.users);
            } catch (e) {
                document.getElementById('userList').innerHTML = `<div class="log-empty">Error: ${e.message}</div>`;
            }
        }

        function renderUserList(users) {
            const container = document.getElementById('userList');
            if (!users || users.length === 0) {
                container.innerHTML = '<div class="log-empty">No users</div>';
                return;
            }
            container.innerHTML = users.map(u => `
                <div class="user-item" data-username="${escapeHtml(u.username)}">
                    <span class="user-item-name">${escapeHtml(u.username)}</span>
                    <select class="user-role-select ${u.role}" onchange="changeUserRole('${escapeHtml(u.username)}', this.value)">
                        <option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>Viewer</option>
                        <option value="editor" ${u.role === 'editor' ? 'selected' : ''}>Editor</option>
                        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                    </select>
                    <span class="user-item-machines">${u.machines.join(', ')}</span>
                    <div class="user-item-actions">
                        <button class="delete btn-delete-circle" onclick="deleteUser('${escapeHtml(u.username)}')">Delete</button>
                    </div>
                </div>
            `).join('');
        }

        async function createUser() {
            const username = document.getElementById('newUsername').value.trim();
            const password = document.getElementById('newPassword').value;
            const role = document.getElementById('newRole').value;

            if (!username || !password) {
                showMessage('Username and password required', 'error');
                return;
            }

            try {
                const resp = await fetch('/api/users', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password, role, machines: ['*'] })
                });
                const result = await resp.json();
                if (result.success) {
                    showMessage('User created', 'success');
                    document.getElementById('newUsername').value = '';
                    document.getElementById('newPassword').value = '';
                    document.getElementById('newRole').value = 'viewer';
                    loadUsers();
                } else {
                    showMessage(result.error || 'Failed', 'error');
                }
            } catch (e) {
                showMessage('Error: ' + e.message, 'error');
            }
        }

        async function changeUserRole(username, newRole) {
            try {
                const resp = await fetch(`/api/users/${encodeURIComponent(username)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ role: newRole })
                });
                const result = await resp.json();
                if (result.success) {
                    showMessage(`Role updated to ${newRole}`, 'success');
                    loadUsers();
                } else {
                    showMessage(result.error || 'Failed', 'error');
                    loadUsers(); // 重新加载以恢复原状态
                }
            } catch (e) {
                showMessage('Error: ' + e.message, 'error');
                loadUsers();
            }
        }

        async function deleteUser(username) {
            if (!confirm(`Delete user "${username}"?`)) return;

            try {
                const resp = await fetch(`/api/users/${encodeURIComponent(username)}`, {
                    method: 'DELETE'
                });
                const result = await resp.json();
                if (result.success) {
                    showMessage('User deleted', 'success');
                    loadUsers();
                } else {
                    showMessage(result.error || 'Failed', 'error');
                }
            } catch (e) {
                showMessage('Error: ' + e.message, 'error');
            }
        }

        // ========== 权限控制 ==========

        function applyPermissions() {
            // Viewer 模式: 无权限元素已通过 no-permission 类处理
            // 这里只需确保 Raw Editor 保持只读
            if (!USER_CAN_EDIT) {
                const rawContent = document.getElementById('rawContent');
                if (rawContent) rawContent.readOnly = true;
            }
        }

        // ========== 初始化 ==========
        // 首先加载机器列表，然后加载任务并折叠所有组
        loadMachines().then(() => {
            loadTasks().then(() => {
                collapseAll();
                applyPermissions();
            });
        });
