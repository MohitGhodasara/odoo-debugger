const vscode = require('vscode');
const path = require('path');
const utils = require('./utils');
const logViewer = require('./logViewer');

class OdooSidebarProvider {
    constructor(context) {
        this._context = context;
        this._view = null;

        // Refresh on state changes
        utils.onServerStateChange(() => this._update());

        // Refresh when debug session starts/stops
        vscode.debug.onDidStartDebugSession(() => this._update());
        vscode.debug.onDidTerminateDebugSession(() => this._update());
    }

    resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };

        webviewView.webview.onDidReceiveMessage(msg => {
            if (msg.command === 'logFilter') {
                logViewer.setFilter(msg.level);
                this._update();
            } else if (msg.command === 'gotoFrame') {
                this._gotoFrame(msg.file, msg.line);
            } else if (msg.command) {
                vscode.commands.executeCommand(msg.command);
            }
        });

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) this._update();
        });

        this._update();
    }

    _update() {
        if (!this._view) return;
        this._view.webview.html = this._getHtml();
    }

    async _gotoFrame(file, line) {
        if (!file || !line) return;
        try {
            const doc = await vscode.workspace.openTextDocument(file);
            const editor = await vscode.window.showTextDocument(doc);
            const pos = new vscode.Position(Math.max(0, line - 1), 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        } catch (_) {}
    }

    refresh() { this._update(); }

    _getHtml() {
        const state = utils.getServerState();
        const db = utils.getDatabase();
        const venvDir = utils.getVenvDir();
        const venvName = venvDir ? path.basename(venvDir) : 'system';
        const logFilter = logViewer.getCurrentFilter();
        const isDebugging = state === 'debugging';

        const statusClass = state === 'running' ? 'running' : state === 'debugging' ? 'debugging' : state === 'building' ? 'building' : 'stopped';
        const statusText = state === 'running' ? '▶ Running' : state === 'debugging' ? '● Debugging' : state === 'building' ? '► Building...' : '■ Stopped';

        return /*html*/`<!DOCTYPE html>
<html><head><style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    padding: 8px 8px 16px 8px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    overflow-x: hidden;
}

/* ── Status pill ── */
.status {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 10px; border-radius: 6px; margin-bottom: 10px;
    font-size: 12px; font-weight: 600;
    border: 1px solid transparent;
}
.status.stopped {
    background: var(--vscode-sideBar-background, transparent);
    color: var(--vscode-descriptionForeground);
    border-color: var(--vscode-widget-border, #3c3c3c);
}
.status.running { background: #2ea04322; color: #4ec94e; border-color: #2ea04355; }
.status.debugging { background: #c9940022; color: #e8c44d; border-color: #c9940055; }
.status.building { background: #c0392b22; color: #ff9999; border-color: #c0392b55; }
.status-info { font-weight: 400; opacity: 0.75; font-size: 11px; }

/* ── Sections ── */
.section { margin-bottom: 10px; }
.section-title {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.8px; color: var(--vscode-descriptionForeground);
    margin-bottom: 5px; padding: 0 2px;
    border-left: 2px solid var(--vscode-button-background);
    padding-left: 6px;
}

/* ── Grid ── */
.grid { display: grid; gap: 4px; }
.grid-1 { grid-template-columns: 1fr; }
.grid-2 { grid-template-columns: 1fr 1fr; }
.grid-3 { grid-template-columns: 1fr 1fr 1fr; }
.mt { margin-top: 4px; }

/* ── Buttons ── */
button {
    display: flex; align-items: center; justify-content: center;
    gap: 4px; padding: 5px 6px;
    border: 1px solid var(--vscode-widget-border, transparent);
    border-radius: 4px; cursor: pointer;
    font-size: 12px; font-family: var(--vscode-font-family);
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    min-height: 28px;
    transition: background 0.1s, opacity 0.1s;
}
button:hover { background: var(--vscode-button-secondaryHoverBackground); border-color: var(--vscode-focusBorder, transparent); }
button:active { opacity: 0.7; transform: scale(0.98); }
button.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: transparent;
    font-weight: 600;
}
button.primary:hover { background: var(--vscode-button-hoverBackground); }
button.danger { background: #5a1d1d; color: #f48771; border-color: #be110055; }
button.danger:hover { background: #6b2222; }
button.stop { background: #c93c3c; color: #fff; border-color: transparent; font-weight: 600; }
button.stop:hover { background: #d94f4f; }

/* ── Collapsible ── */
details { margin-bottom: 6px; }
details > summary {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.8px; color: var(--vscode-descriptionForeground);
    cursor: pointer; padding: 5px 6px; list-style: none;
    user-select: none;
    border-radius: 3px;
    border-top: 1px solid var(--vscode-widget-border, #3c3c3c33);
    margin-top: 2px;
}
details > summary::before { content: '▸ '; font-size: 9px; }
details[open] > summary::before { content: '▾ '; font-size: 9px; }
details > summary:hover { color: var(--vscode-foreground); background: var(--vscode-list-hoverBackground); }
details > .content { padding-top: 6px; }

/* ── Log filter ── */
.filter-bar {
    display: flex; gap: 2px; margin-bottom: 4px;
    background: var(--vscode-input-background);
    border-radius: 4px; overflow: hidden;
    border: 1px solid var(--vscode-input-border, #3c3c3c);
    padding: 2px;
}
.filter-btn {
    flex: 1; border: none; border-radius: 3px;
    font-size: 11px; padding: 3px 2px; min-height: 22px;
    background: transparent; color: var(--vscode-descriptionForeground);
    cursor: pointer; transition: background 0.1s;
}
.filter-btn:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground); }
.filter-btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-weight: 600; }

/* ── Debug controls ── */
.debug-controls {
    display: flex; gap: 2px; margin-bottom: 4px;
}
.debug-controls button {
    flex: 1; min-height: 26px; font-size: 14px; padding: 2px;
}

.empty { font-size: 12px; color: var(--vscode-descriptionForeground); padding: 4px 4px; font-style: italic; }
</style></head>
<body>

<!-- Status -->
<div class="status ${statusClass}">
    <span>${statusText}</span>
    <span class="status-info">${db} · ${venvName}</span>
</div>

<!-- Server (always visible) -->
<div class="section">
    <div class="section-title">Server</div>
    ${state === 'stopped' ? `
    <div class="grid grid-2">
        <button class="primary" onclick="cmd('odooDebugger.runOdoo')" title="Ctrl+Shift+R">▶ Run</button>
        <button class="primary" onclick="cmd('odooDebugger.debugOdoo')" title="Ctrl+Shift+D">● Debug</button>
    </div>
    ` : state === 'building' ? `
    <div class="grid grid-1">
        <button class="stop" onclick="cmd('odooDebugger.stopOdoo')">■ Stop</button>
    </div>
    ` : `
    <div class="grid grid-2">
        <button class="stop" onclick="cmd('odooDebugger.stopOdoo')" title="Ctrl+Shift+S">■ Stop</button>
        <button onclick="cmd('odooDebugger.restartOdoo')" title="Restart Odoo">⟳ Restart</button>
    </div>
    `}
</div>

${isDebugging ? `
<!-- Debug Controls (only when debugging) -->
<div class="section">
    <div class="section-title">Debug</div>
    <div class="debug-controls">
        <button onclick="cmd('workbench.action.debug.continue')" title="Continue (F5)">▶</button>
        <button onclick="cmd('workbench.action.debug.stepOver')" title="Step Over (F10)">⤼</button>
        <button onclick="cmd('workbench.action.debug.stepInto')" title="Step Into (F11)">↓</button>
        <button onclick="cmd('workbench.action.debug.stepOut')" title="Step Out (⇧F11)">↑</button>
        <button class="stop" onclick="cmd('workbench.action.debug.stop')" title="Stop">■</button>
    </div>
</div>
` : ''}

<!-- Modules (always visible) -->
<div class="section">
    <div class="section-title">Modules</div>
    <div class="grid grid-3">
        <button onclick="cmd('odooDebugger.updateModule')" title="Ctrl+Shift+U">⟳ Update</button>
        <button onclick="cmd('odooDebugger.installModule')">+ Install</button>
        <button onclick="cmd('odooDebugger.updateChangedModules')" title="Ctrl+Shift+G">⟳ Changed</button>
    </div>
</div>

<!-- Logs (collapsible) -->
<details>
    <summary>Logs</summary>
    <div class="content">
        <div class="filter-bar">
            ${['ALL', 'ERROR', 'WARNING', 'INFO', 'DEBUG'].map(l =>
                `<button class="filter-btn ${logFilter === l ? 'active' : ''}" onclick="logFilter('${l}')">${l}</button>`
            ).join('')}
        </div>
    </div>
</details>

<!-- JS Debug (collapsible) -->
<details>
    <summary>JS Debug</summary>
    <div class="content">
        <div class="grid grid-2">
            <button onclick="cmd('odooDebugger.launchChromeDebug')">Chrome Debug</button>
            <button onclick="cmd('odooDebugger.attachJsDebugger')">Attach JS</button>
        </div>
    </div>
</details>

<!-- Tools (collapsible) -->
<details>
    <summary>Tools</summary>
    <div class="content">
        <div class="grid grid-3">
            <button onclick="cmd('odooDebugger.openShell')">⟩_ Shell</button>
            <button onclick="cmd('odooDebugger.openOdoo')">Open Odoo</button>
            <button onclick="cmd('odooDebugger.openApps')">Apps</button>
        </div>
        <div class="grid grid-3 mt">
            <button onclick="cmd('odooDebugger.copyDatabase')">Copy DB</button>
            <button onclick="cmd('odooDebugger.openDebugMode')">Debug URL</button>
            <button onclick="cmd('odooDebugger.clearAssets')">Clear Assets</button>
        </div>
        <div class="grid grid-3 mt">
            <button onclick="cmd('odooDebugger.uninstallModule')">Uninstall</button>
            <button onclick="cmd('odooDebugger.scaffoldModule')">Scaffold</button>
            <button onclick="cmd('odooDebugger.startPostgres')">Start PG</button>
        </div>
        <div class="grid grid-3 mt">
            <button onclick="cmd('odooDebugger.killPython')">Kill Py</button>
            <button class="danger" onclick="cmd('odooDebugger.dropDatabase')">Drop DB</button>
        </div>
    </div>
</details>

<script>
    const vscode = acquireVsCodeApi();
    const prevState = vscode.getState() || {};
    function cmd(c) { vscode.postMessage({ command: c }); }
    function msg(c) { vscode.postMessage({ command: c }); }
    function logFilter(l) { vscode.postMessage({ command: 'logFilter', level: l }); }
    function gotoFrame(f, l) { vscode.postMessage({ command: 'gotoFrame', file: f, line: l }); }
    // Restore and persist <details> open/close state
    document.querySelectorAll('details').forEach(d => {
        const key = 'det_' + d.querySelector('summary')?.textContent?.trim();
        if (prevState[key]) d.open = true;
        d.addEventListener('toggle', () => {
            const s = vscode.getState() || {};
            s[key] = d.open;
            vscode.setState(s);
        });
    });
</script>
</body></html>`;
    }
}

module.exports = { OdooSidebarProvider };
