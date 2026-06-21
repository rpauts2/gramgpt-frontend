;(function() {
    'use strict';

    // ===== Telegram WebApp Init =====
    const tg = window.Telegram.WebApp;
    tg.expand();
    tg.ready();

    const tp = tg.themeParams || {};
    if (tp.bg_color) document.documentElement.style.setProperty('--tg-theme-bg-color', tp.bg_color);
    if (tp.text_color) document.documentElement.style.setProperty('--tg-theme-text-color', tp.text_color);
    if (tp.hint_color) document.documentElement.style.setProperty('--tg-theme-hint-color', tp.hint_color);
    if (tp.link_color) document.documentElement.style.setProperty('--tg-theme-link-color', tp.link_color);
    if (tp.button_color) document.documentElement.style.setProperty('--tg-theme-button-color', tp.button_color);
    if (tp.button_text_color) document.documentElement.style.setProperty('--tg-theme-button-text-color', tp.button_text_color);
    if (tp.secondary_bg_color) document.documentElement.style.setProperty('--tg-theme-secondary-bg-color', tp.secondary_bg_color);
    if (tp.section_separator_color) document.documentElement.style.setProperty('--tg-theme-section-separator-color', tp.section_separator_color);
    document.documentElement.classList.add('tg-theme');

    // Safe area insets for iOS
    if (tp.content_safe_area_inset_top) document.body.style.paddingTop = tp.content_safe_area_inset_top + 'px';
    if (tp.safe_area_inset_bottom) document.body.style.paddingBottom = (parseInt(tp.safe_area_inset_bottom) + 88) + 'px';

    const user = tg.initDataUnsafe?.user;
    if (user) {
        const el = document.getElementById('user-name');
        if (el) el.innerText = user.first_name;
    }

    // ===== BackButton management =====
    let backButtonStack = 0;
    function showBackButton() {
        backButtonStack++;
        try { Telegram.WebApp.BackButton.show(); } catch(e) {}
    }
    function hideBackButton() {
        backButtonStack = Math.max(0, backButtonStack - 1);
        if (backButtonStack === 0) {
            try { Telegram.WebApp.BackButton.hide(); } catch(e) {}
        }
    }
    Telegram.WebApp.BackButton.onClick(() => {
        if (backButtonStack > 0) {
            window.history.back();
        }
    });

    // ===== MainButton helpers =====
    function showMainButton(text, color, callback) {
        try {
            tg.MainButton.setText(text);
            if (color) tg.MainButton.setParams({color: tp.button_color || color});
            tg.MainButton.onClick(callback);
            tg.MainButton.show();
        } catch(e) {}
    }
    function hideMainButton() {
        try { tg.MainButton.hide(); tg.MainButton.offClick(); } catch(e) {}
    }

    // ===== Haptic feedback =====
    function haptic(type) {
        try { tg.HapticFeedback.impactOccurred(type || 'medium'); } catch(e) {}
    }

    // ===== Telegram Popup (replaces window.alert/confirm) =====
    function showPopup(title, message, buttons, callback) {
        haptic('medium');
        try {
            tg.showPopup({ title: title || '', message: message || '', buttons: buttons || [{id:'ok',type:'ok'}] }, callback || function(){});
        } catch(e) {
            window.alert(message);
        }
    }
    function showAlert(title, message) {
        showPopup(title, message, [{id:'ok',type:'ok'}]);
    }
    function showConfirm(title, message, onOk, onCancel) {
        showPopup(title, message, [{id:'cancel',type:'cancel'},{id:'ok',type:'ok'}], function(id) {
            if (id === 'ok' && onOk) onOk();
            else if (id === 'cancel' && onCancel) onCancel();
        });
    }

    // ===== Haptic on all clicks =====
    document.addEventListener('click', function() { haptic('light'); }, true);

    // ===== Swipe to go back (iOS) =====
    let touchStartX = 0;
    document.addEventListener('touchstart', function(e) {
        touchStartX = e.changedTouches[0].screenX;
    }, {passive: true});
    document.addEventListener('touchend', function(e) {
        var dx = e.changedTouches[0].screenX - touchStartX;
        if (dx > 80 && touchStartX < 40 && backButtonStack > 0) {
            window.history.back();
        }
    }, {passive: true});

    // ============================================================
    // Auth Token Management
    // ============================================================
    function getToken() {
        return localStorage.getItem('gramgpt_token');
    }
    function setToken(token) {
        if (token) localStorage.setItem('gramgpt_token', token);
        else localStorage.removeItem('gramgpt_token');
    }

    // ============================================================
    // API Client
    // ============================================================
    const api = {
        baseURL: '/api/v1',

        async request(method, path, body) {
            const opts = {
                method,
                headers: { 'Content-Type': 'application/json' },
            };
            const token = getToken();
            if (token) opts.headers['Authorization'] = 'Bearer ' + token;
            if (body) opts.body = JSON.stringify(body);
            try {
                const res = await fetch(`${this.baseURL}${path}`, opts);
                if (res.status === 401 && token) {
                    setToken(null);
                    if (tg?.initData) {
                        try {
                            const refreshRes = await fetch(`${this.baseURL}/auth/telegram`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ init_data: tg.initData }),
                            });
                            if (refreshRes.ok) {
                                const refreshData = await refreshRes.json();
                                if (refreshData.token) setToken(refreshData.token);
                                opts.headers['Authorization'] = 'Bearer ' + refreshData.token;
                                const retryRes = await fetch(`${this.baseURL}${path}`, opts);
                                if (!retryRes.ok) {
                                    const err = await retryRes.json().catch(() => ({ detail: retryRes.statusText }));
                                    throw new Error(err.detail || `HTTP ${retryRes.status}`);
                                }
                                return await retryRes.json();
                            }
                        } catch (e) {}
                    }
                }
                if (!res.ok) {
                    const err = await res.json().catch(() => ({ detail: res.statusText }));
                    throw new Error(err.detail || `HTTP ${res.status}`);
                }
                return await res.json();
            } catch (err) {
                throw err;
            }
        },

        get(path) { return this.request('GET', path); },
        post(path, body) { return this.request('POST', path, body); },
        patch(path, body) { return this.request('PATCH', path, body); },
        del(path) { return this.request('DELETE', path); },

        async fetchWithLoading(path, targetEl, renderFn) {
            const el = typeof targetEl === 'string' ? document.getElementById(targetEl) : targetEl;
            if (!el) return;
            el.innerHTML = '<div class="skeleton-card"><div class="skeleton-title"></div><div class="skeleton-text"></div><div class="skeleton-text-sm"></div></div>';
            try {
                const data = await this.get(path);
                el.innerHTML = '';
                renderFn(el, data);
            } catch (err) {
                el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h4>Ошибка загрузки</h4><p>${err.message}</p></div>`;
            }
        }
    };

    // ============================================================
    // Toast Notifications (Telegram-native bottom style)
    // ============================================================
    function createToastContainer() {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        return container;
    }

    function toast(type, title, message, duration) {
        haptic('medium');
        const container = createToastContainer();
        duration = duration || 4000;

        const el = document.createElement('div');
        el.className = `toast toast-${type}`;

        const icons = { success: 'check-circle', error: 'times-circle', warning: 'exclamation-triangle', info: 'info-circle' };
        el.innerHTML = `
            <div class="toast-icon"><i class="fas fa-${icons[type] || 'info-circle'}"></i></div>
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                ${message ? `<div class="toast-message">${message}</div>` : ''}
            </div>
            <button class="toast-close" onclick="this.parentElement.classList.add('toast-exit');setTimeout(()=>this.parentElement.remove(),300)"><i class="fas fa-times"></i></button>
        `;
        container.appendChild(el);

        setTimeout(() => {
            el.classList.add('toast-exit');
            setTimeout(() => el.remove(), 300);
        }, duration);
    }

    // ============================================================
    // Modal Dialog — native <dialog> with BackButton
    // ============================================================
    function showModal(title, text, confirmText, cancelText, onConfirm) {
        haptic('medium');
        const dialog = document.createElement('dialog');
        dialog.innerHTML = `
            <div class="modal-title">${title}</div>
            <div class="modal-text">${text}</div>
            <div class="modal-actions">
                <button class="btn btn-secondary btn-sm modal-cancel">${cancelText || 'Отмена'}</button>
                <button class="btn btn-sm modal-confirm">${confirmText || 'Подтвердить'}</button>
            </div>
        `;
        document.body.appendChild(dialog);
        showBackButton();

        dialog.querySelector('.modal-cancel').addEventListener('click', () => dialog.close());
        dialog.querySelector('.modal-confirm').addEventListener('click', () => {
            dialog.close();
            if (onConfirm) onConfirm();
        });
        dialog.addEventListener('close', () => { dialog.remove(); hideBackButton(); });
        dialog.addEventListener('click', (e) => {
            if (e.target !== dialog) return;
            const rect = dialog.getBoundingClientRect();
            const isInside = rect.top <= e.clientY && e.clientY <= rect.bottom &&
                rect.left <= e.clientX && e.clientX <= rect.right;
            if (!isInside) dialog.close();
        });
        dialog.showModal();
    }

    // ============================================================
    // Connection Monitor
    // ============================================================
    function initConnectionMonitor() {
        let bar = document.querySelector('.connection-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'connection-bar';
            document.body.prepend(bar);
        }

        window.addEventListener('online', () => {
            bar.className = 'connection-bar online';
            bar.textContent = '✅ Соединение восстановлено';
            setTimeout(() => { bar.textContent = ''; bar.className = 'connection-bar'; }, 2500);
        });
        window.addEventListener('offline', () => {
            bar.className = 'connection-bar offline';
            bar.textContent = '⚠️ Нет соединения с интернетом';
        });
    }

    // ============================================================
    // Empty State Generator
    // ============================================================
    function emptyState(icon, title, text, action) {
        var html = '<div class="empty-state"><div class="empty-state-icon"><i class="fas fa-' + icon + '"></i></div><div class="empty-state-title">' + title + '</div>';
        if (text) html += '<div class="empty-state-text">' + text + '</div>';
        if (action) html += '<button class="btn btn-sm btn-primary" onclick="' + action + '">' + (typeof action === 'string' && action.startsWith('toast') ? action : 'Настроить') + '</button>';
        html += '</div>';
        return html;
    }

    function showEmptyState(containerId, icon, title, text) {
        var el = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
        if (el) el.innerHTML = emptyState(icon || 'inbox', title || 'Нет данных', text || 'Данные появятся после начала работы модуля');
    }

    // ============================================================
    // Navigation — set active nav item
    // ============================================================
    function setActiveNav(page) {
        document.querySelectorAll('.nav-item').forEach(el => {
            el.classList.toggle('active', el.getAttribute('href')?.includes(page));
        });
    }

    // ============================================================
    // Shared Utilities (formerly duplicated per page)
    // ============================================================
    function escapeHtml(str) {
        var d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }
    window.escapeHtml = escapeHtml;

    function timeAgo(ts) {
        var sec = Math.floor((Date.now() / 1000) - ts);
        if (sec < 60) return 'только что';
        if (sec < 3600) return Math.floor(sec / 60) + ' мин назад';
        if (sec < 86400) return Math.floor(sec / 3600) + ' ч назад';
        return Math.floor(sec / 86400) + ' дн назад';
    }
    window.timeAgo = timeAgo;

    // ============================================================
    // Stop Button Manager — allows stopping any running module
    // ============================================================
    const stopManager = {
        _active: {},
        register(id, cancelFn) {
            this._active[id] = cancelFn;
            var btn = document.getElementById('stop-btn-' + id);
            if (btn) btn.style.display = 'flex';
        },
        stop(id) {
            if (this._active[id]) {
                this._active[id]();
                delete this._active[id];
                toast('info', 'Остановлено', 'Модуль ' + id + ' остановлен');
            }
            var btn = document.getElementById('stop-btn-' + id);
            if (btn) btn.style.display = 'none';
        },
        isRunning(id) { return !!this._active[id]; }
    };
    window.stopManager = stopManager;

    function createStopButton(moduleId, moduleLabel) {
        return '<button id="stop-btn-' + moduleId + '" class="btn btn-danger btn-sm" style="display:none;width:100%;margin-top:8px;background:var(--danger);color:#fff;" onclick="stopManager.stop(\'' + moduleId + '\')"><i class="fas fa-stop"></i> Остановить ' + moduleLabel + '</button>';
    }
    window.createStopButton = createStopButton;

    // ============================================================
    // Export Utilities
    // ============================================================
    function exportCSV(data, filename) {
        if (!data || !data.length) { toast('warning', 'Пусто', 'Нет данных для экспорта'); return; }
        var keys = Object.keys(data[0]);
        var csv = keys.join(',') + '\n' + data.map(function(row) {
            return keys.map(function(k) { return '"' + String(row[k] || '').replace(/"/g, '""') + '"'; }).join(',');
        }).join('\n');
        var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = filename || 'export.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast('success', 'Экспорт', 'Файл ' + filename + ' скачан');
    }
    window.exportCSV = exportCSV;

    function exportJSON(data, filename) {
        if (!data || !data.length) { toast('warning', 'Пусто', 'Нет данных для экспорта'); return; }
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = filename || 'export.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast('success', 'Экспорт', 'Файл ' + filename + ' скачан');
    }
    window.exportJSON = exportJSON;

    // ============================================================
    // Expose to window
    // ============================================================
    window.api = api;
    window.toast = toast;
    window.showModal = showModal;
    window.showPopup = showPopup;
    window.showAlert = showAlert;
    window.showConfirm = showConfirm;
    window.showMainButton = showMainButton;
    window.hideMainButton = hideMainButton;
    window.haptic = haptic;
    window.showBackButton = showBackButton;
    window.hideBackButton = hideBackButton;
    window.tg = tg;
    window.setActiveNav = setActiveNav;
    window.showEmptyState = showEmptyState;
    window.emptyState = emptyState;
    window.setToken = setToken;
    window.getToken = getToken;

    // ============================================================
    // Auto-init
    // ============================================================
    document.addEventListener('DOMContentLoaded', () => {
        initConnectionMonitor();
        if (document.getElementById('leads-count')) {
            updateStats();
        }
        setTimeout(() => checkCrisisAlert(), 1500);
    });

    (async function initTelegramAuth() {
        if (getToken()) return;
        const initData = tg?.initData;
        if (!initData) return;
        try {
            const res = await fetch('/api/v1/auth/telegram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ init_data: initData }),
            });
            if (res.ok) {
                const data = await res.json();
                if (data.token) setToken(data.token);
            }
        } catch (e) {}
    })();

    async function updateStats() {
        try {
            const data = await api.get('/analytics/summary');
            const leadsEl = document.getElementById('leads-count');
            if (leadsEl) leadsEl.innerText = Number(data.leads_captured || data.total_accounts).toLocaleString();
            const accountsEl = document.getElementById('accounts-count');
            if (accountsEl) accountsEl.innerText = data.active_accounts || data.total_accounts;
            const roiEl = document.getElementById('roi-value');
            if (roiEl) roiEl.innerText = data.roi_average || 'N/A';
        } catch (e) {
            console.error('Stats fetch error:', e);
        }
    }

    function checkCrisisAlert() {
        api.get('/security/status').then(function(data) {
            if (data && data.risk_level && data.risk_level !== 'safe' && data.risk_level !== 'low') {
                var alert = document.getElementById('crisis-alert');
                if (alert) alert.style.display = 'block';
            }
        }).catch(function() {});
    }
})();
