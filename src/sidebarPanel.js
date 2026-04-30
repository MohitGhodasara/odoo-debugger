const vscode = require('vscode');
const path = require('path');
const utils = require('./utils');

// Codicon unicode map
const I = {
    run:      '\uead3', stop:     '\uead7', restart:  '\uead2',
    stepOver: '\uead6', stepInto: '\uead4', stepOut:  '\uead5',
    cont:     '\ueacf', pause:    '\uead1', debug:    '\uea71',
    refresh:  '\ueb37', close:    '\uea76', search:   '\uea6d',
    gear:     '\ueb51', folder:   '\uea83', db:       '\ueace',
    play:     '\ueb2c', trash:    '\uea81', clear:    '\ueabf',
    output:   '\ueb9d', tree:     '\ueb86', sort:     '\ueb55',
    globe:    '\ueb01', table:    '\uebb7', filter:   '\ueaf1',
    shell:    '\ueb63', git:      '\ueafd',
};

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
        const fontUri = webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'resources', 'codicon.ttf')
        );
        this._fontUri = fontUri;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._context.extensionUri, 'resources')]
        };

        webviewView.webview.onDidReceiveMessage(msg => {
            if (msg.command === 'gotoFrame') {
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
        this._view.webview.html = this._getHtml(this._fontUri || '');
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

    _getHtml(fontUri) {
        const state = utils.getServerState();
        const db = utils.getDatabase();
        const venvDir = utils.getVenvDir();
        const venvName = venvDir ? path.basename(venvDir) : 'system';

        const statusClass = state === 'running' ? 'running' : state === 'debugging' ? 'debugging' : (state === 'building' || state === 'starting') ? 'building' : 'stopped';
        const statusText = state === 'running' ? `${I.run} Running` : state === 'debugging' ? `${I.debug} Debugging` : state === 'building' ? `${I.refresh} Building...` : state === 'starting' ? `${I.refresh} Starting...` : `${I.stop} Stopped`;

        const isStopped = state === 'stopped';
        const isActive = state === 'running' || state === 'debugging';
        const isBusy = state === 'starting' || state === 'building';
        const isDebugging = state === 'debugging';

        // colours
        const C = {
            run:     'var(--vscode-debugIcon-startForeground,#89d185)',
            debug:   '#e8c44d',
            stop:    'var(--vscode-debugIcon-stopForeground,#f48771)',
            restart: 'var(--vscode-debugIcon-restartForeground,#89d185)',
            step:    'var(--vscode-foreground,#ccc)',
            hover:   'var(--vscode-toolbar-hoverBackground,#ffffff18)',
        };

        const btn = (icon, cmd, title, color, disabled = false, extraStyle = '') =>
            `<button class="dbg-btn" style="color:${color};${extraStyle}" ${disabled ? 'disabled' : `onclick="cmd('${cmd}')"`} title="${title}">${icon}</button>`;

        const toolbar = isStopped ? `
            ${btn(I.run,   'odooDebugger.runOdoo',   'Run (Ctrl+Shift+R)',   C.run)}
            ${btn(I.debug, 'odooDebugger.debugOdoo', 'Debug (Ctrl+Shift+D)', C.debug, false, 'font-size:20px')}` :
            `${btn(I.cont,     'workbench.action.debug.continue', 'Continue (F5)',      C.step,    !isDebugging)}
            ${btn(I.stepOver, 'workbench.action.debug.stepOver',  'Step Over (F10)',    C.step,    !isDebugging)}
            ${btn(I.stepInto, 'workbench.action.debug.stepInto',  'Step Into (F11)',    C.step,    !isDebugging)}
            ${btn(I.stepOut,  'workbench.action.debug.stepOut',   'Step Out',           C.step,    !isDebugging)}
            ${btn(I.restart,  'odooDebugger.restartOdoo',         'Restart',            C.restart, isBusy)}
            ${btn(I.stop,     'odooDebugger.stopOdoo',            'Stop (Ctrl+Shift+S)',C.stop)}`;

        // generic sidebar button helper — icon wrapped in codicon span
        const sb2 = (icon, cmd, title, short) =>
            `<button class="sb" onclick="cmd('${cmd}')" title="${title}"><span class="ic">${icon}</span><span>${short || title}</span></button>`;

        return /*html*/`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
@font-face { font-family: codicon; src: url('${fontUri}') format('truetype'); }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { padding: 8px 8px 16px 8px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); overflow-x: hidden; }

/* status */
.status { display:flex; align-items:center; justify-content:space-between; padding:6px 10px; border-radius:6px; margin-bottom:10px; font-size:12px; font-weight:600; border:1px solid transparent; font-family:codicon,var(--vscode-font-family); }
.status.stopped { background:var(--vscode-sideBar-background,transparent); color:var(--vscode-descriptionForeground); border-color:var(--vscode-widget-border,#3c3c3c); }
.status.running { background:#2ea04322; color:#89d185; border-color:#2ea04355; }
.status.debugging { background:#c9940022; color:#e8c44d; border-color:#c9940055; }
.status.building { background:#c0392b22; color:#ff9999; border-color:#c0392b55; }
.status-info { font-weight:400; opacity:0.75; font-size:11px; font-family:var(--vscode-font-family); }

/* section */
.section { margin-bottom:10px; }
.section-title { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:var(--vscode-descriptionForeground); margin-bottom:5px; border-left:2px solid var(--vscode-button-background); padding-left:6px; }

/* debug toolbar */
.dbg-bar { display:flex; align-items:center; gap:1px; background:var(--vscode-debugToolBar-background,#2d2d2d); border:1px solid var(--vscode-widget-border,#555); border-radius:6px; padding:3px 5px; }
.dbg-btn { height:28px; padding:0; border-radius:4px; border:none; font-size:16px; flex:1; background:transparent; line-height:28px; text-align:center; cursor:pointer; font-family:codicon; }
.dbg-btn:hover:not(:disabled) { background:${C.hover}; }
.dbg-btn:disabled { opacity:0.3; cursor:not-allowed; }

/* sidebar buttons — same theme as toolbar */
.grid { display:grid; gap:3px; }
.grid-2 { grid-template-columns:1fr 1fr; }
.grid-3 { grid-template-columns:1fr 1fr 1fr; }
.mt { margin-top:3px; }
.sb {
    display:flex; align-items:center; gap:5px; padding:4px 8px;
    border:1px solid var(--vscode-widget-border,#555); border-radius:4px; cursor:pointer;
    font-size:12px; font-family:var(--vscode-font-family);
    background:var(--vscode-debugToolBar-background,#2d2d2d);
    color:var(--vscode-foreground);
    height:28px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    transition:background 0.1s;
}
.sb:hover { background:var(--vscode-toolbar-hoverBackground,#ffffff18); }
.sb:active { opacity:0.7; }
.sb .ic { font-family:codicon; font-size:14px; flex-shrink:0; line-height:1; }
.sb span { overflow:hidden; text-overflow:ellipsis; }
.sb.danger { background:#5a1d1d; color:#f48771; border-color:#be110033; }
.sb.danger:hover { background:#6b2222; }

/* collapsible */
details { margin-bottom:6px; }
details > summary { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:var(--vscode-descriptionForeground); cursor:pointer; padding:5px 6px; list-style:none; user-select:none; border-radius:3px; border-top:1px solid var(--vscode-widget-border,#3c3c3c33); margin-top:2px; }
details > summary::before { content:'\u25b8 '; font-size:9px; }
details[open] > summary::before { content:'\u25be '; font-size:9px; }
details > summary:hover { color:var(--vscode-foreground); background:var(--vscode-list-hoverBackground); }
details > .content { padding-top:6px; }
</style></head>
<body>

<div class="status ${statusClass}">
    <span>${statusText}</span>
    <span class="status-info">${db} &middot; ${venvName}</span>
</div>

<div class="section">
    <div class="section-title">Server</div>
    <div class="dbg-bar">${toolbar}</div>
</div>

<div class="section">
    <div class="section-title">Modules</div>
    <div class="grid grid-3">
        ${sb2(I.refresh, 'odooDebugger.updateModule',       'Update Module',        'Update')}
        ${sb2(I.play,    'odooDebugger.installModule',       'Install Module',       'Install')}
        ${sb2(I.git,     'odooDebugger.updateChangedModules','Update Changed',       'Changed')}
    </div>
</div>

<script>
    const vscode = acquireVsCodeApi();
    function cmd(c) { vscode.postMessage({ command: c }); }
    function gotoFrame(f, l) { vscode.postMessage({ command: 'gotoFrame', file: f, line: l }); }
</script>
</body></html>`;
    }


}

class OdooToolsProvider {
    constructor(context) {
        this._context = context;
        this._view = null;
    }

    resolveWebviewView(webviewView) {
        this._view = webviewView;
        const fontUri = webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'resources', 'codicon.ttf')
        );
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._context.extensionUri, 'resources')]
        };
        webviewView.webview.onDidReceiveMessage(msg => {
            if (msg.command) vscode.commands.executeCommand(msg.command);
        });
        webviewView.webview.html = this._getHtml(fontUri);
    }

    _getHtml(fontUri) {
        const I2 = I; // use same codicon map
        const sb2 = (icon, cmd, title, short) =>
            `<button class="sb" onclick="cmd('${cmd}')" title="${title}"><span class="ic">${icon}</span><span>${short || title}</span></button>`;

        const css =
            `@font-face{font-family:codicon;src:url('${fontUri}') format('truetype')}` +
            `*{box-sizing:border-box;margin:0;padding:0}` +
            `body{padding:8px 8px 16px 8px;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);overflow-x:hidden}` +
            `.grid{display:grid;gap:3px}.grid-2{grid-template-columns:1fr 1fr}.grid-3{grid-template-columns:1fr 1fr 1fr}.mt{margin-top:3px}` +
            `.sb{display:flex;align-items:center;gap:5px;padding:4px 8px;border:1px solid var(--vscode-widget-border,#555);border-radius:4px;cursor:pointer;font-size:12px;font-family:var(--vscode-font-family);background:var(--vscode-debugToolBar-background,#2d2d2d);color:var(--vscode-foreground);height:28px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background 0.1s}` +
            `.sb:hover{background:var(--vscode-toolbar-hoverBackground,#ffffff18)}.sb:active{opacity:0.7}` +
            `.sb .ic{font-family:codicon;font-size:14px;flex-shrink:0;line-height:1}.sb span{overflow:hidden;text-overflow:ellipsis}` +
            `.sb.danger{background:#5a1d1d;color:#f48771;border-color:#be110033}.sb.danger:hover{background:#6b2222}` +
            `details{margin-bottom:6px}` +
            `details>summary{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--vscode-descriptionForeground);cursor:pointer;padding:5px 6px;list-style:none;user-select:none;border-radius:3px;border-top:1px solid var(--vscode-widget-border,#3c3c3c33);margin-top:2px}` +
            `details>summary::before{content:'\u25b8 ';font-size:9px}details[open]>summary::before{content:'\u25be ';font-size:9px}` +
            `details>summary:hover{color:var(--vscode-foreground);background:var(--vscode-list-hoverBackground)}` +
            `details>.content{padding-top:6px}`;

        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style></head><body>
<details open data-always-open>
    <summary>JS Debug</summary>
    <div class="content"><div class="grid grid-2">
        ${sb2(I2.debug, 'odooDebugger.launchChromeDebug', 'Launch Chrome Debug', 'Chrome')}
        ${sb2(I2.globe, 'odooDebugger.attachJsDebugger',  'Attach JS Debugger',  'Attach JS')}
    </div></div>
</details>
<details>
    <summary>Tools</summary>
    <div class="content"><div class="grid grid-3">
        ${sb2(I2.gear,   'odooDebugger.openSettings',     'Open Settings',           'Settings')}
        ${sb2(I2.search, 'odooDebugger.quickFind',         'Quick Find (Ctrl+Alt+N)', 'Find')}
        ${sb2(I2.shell,  'odooDebugger.openShell',         'Open Odoo Shell',         'Shell')}
        ${sb2(I2.globe,  'odooDebugger.openOdoo',          'Open Odoo in Browser',    'Open')}
        ${sb2(I2.globe,  'odooDebugger.openApps',          'Open Apps',               'Apps')}
        ${sb2(I2.db,     'odooDebugger.copyDatabase',      'Copy Database',            'Copy DB')}
        ${sb2(I2.globe,  'odooDebugger.openDebugMode',     'Open Debug Mode',          'Debug URL')}
        ${sb2(I2.clear,  'odooDebugger.clearAssets',       'Clear Asset Bundles',      'Assets')}
        ${sb2(I2.trash,  'odooDebugger.uninstallModule',   'Uninstall Module',         'Uninstall')}
        ${sb2(I2.folder, 'odooDebugger.scaffoldModule',    'Scaffold New Module',      'Scaffold')}
        ${sb2(I2.play,   'odooDebugger.startPostgres',     'Start PostgreSQL',         'Start PG')}
        ${sb2(I2.stop,   'odooDebugger.killPython',        'Kill Odoo Processes',      'Kill Py')}
    </div>
    <div class="grid grid-2 mt">
        <button class="sb danger" onclick="cmd('odooDebugger.dropDatabase')" title="Drop Database"><span class="ic">${I2.trash}</span><span>Drop DB</span></button>
    </div></div>
</details>
<script>
    const vscode = acquireVsCodeApi();
    const prevState = vscode.getState() || {};
    function cmd(c) { vscode.postMessage({ command: c }); }
    document.querySelectorAll('details').forEach(d => {
        const key = 'det_' + d.querySelector('summary')?.textContent?.trim();
        const alwaysOpen = d.hasAttribute('data-always-open');
        if (!alwaysOpen && prevState[key] !== undefined) d.open = prevState[key];
        d.addEventListener('toggle', () => {
            const s = vscode.getState() || {};
            s[key] = d.open;
            vscode.setState(s);
        });
    });
</script></body></html>`;
    }
}

module.exports = { OdooSidebarProvider, OdooToolsProvider };
