const vscode = require('vscode');
const { execSync } = require('child_process');
const utils = require('./utils');

async function killPython() {
    try {
        if (process.platform === 'win32') {
            execSync('taskkill /F /IM python.exe 2>nul', { encoding: 'utf8' });
        } else {
            execSync("kill -9 $(pgrep -f 'python.*odoo-bin' || true) 2>/dev/null", { encoding: 'utf8' });
        }
        utils.setServerState('stopped', null);
        vscode.window.showInformationMessage('Odoo Python processes killed.');
    } catch (_) {
        vscode.window.showInformationMessage('No Odoo processes found.');
    }
}

async function startPostgres() {
    utils.runInTerminal('PostgreSQL', 'sudo service postgresql start');
}

async function openOdoo() {
    const port = utils.getPort();
    vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}/odoo`));
}

async function openApps() {
    const port = utils.getPort();
    vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}/web?debug=1#action=base.open_module_tree`));
}

async function openDebugMode() {
    const port = utils.getPort();
    vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}/web?debug=assets`));
}

async function clearAssets() {
    const db = utils.getDatabase();
    const confirm = await vscode.window.showWarningMessage(
        `Clear all asset bundles in "${db}"? Odoo will regenerate them on next load.`,
        'Clear', 'Cancel'
    );
    if (confirm !== 'Clear') return;
    try {
        const { args, env } = utils.buildPsqlArgs();
        execSync(
            `psql ${args.map(a => JSON.stringify(a)).join(' ')} -c "DELETE FROM ir_attachment WHERE url LIKE '/web/assets/%';"`,
            { encoding: 'utf8', timeout: 5000, env }
        );
        vscode.window.showInformationMessage('Asset bundles cleared.');
    } catch (e) {
        vscode.window.showErrorMessage(`Failed: ${e.message}`);
    }
}

async function removeUnusedImports() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'python') {
        vscode.window.showInformationMessage('Open a Python file first.');
        return;
    }
    const filePath = editor.document.uri.fsPath;
    try {
        execSync(`"${utils.getPythonPath()}" -m autoflake --in-place --remove-all-unused-imports "${filePath}"`,
            { encoding: 'utf8', timeout: 10000 });
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage('Unused imports removed.');
    } catch (e) {
        vscode.window.showErrorMessage(`autoflake failed: ${e.message}`);
    }
}

async function copyDatabase() {
    try {
        const { args, env } = utils.buildPsqlArgs('postgres');
        const out = execSync(
            `psql ${args.map(a => JSON.stringify(a)).join(' ')} -q -A -t -c 'SELECT datname FROM pg_database WHERE datistemplate=false ORDER BY datname'`,
            { encoding: 'utf8', timeout: 5000, env }
        );
        const dbs = out.trim().split('\n').filter(Boolean);
        const source = await vscode.window.showQuickPick(dbs, { title: 'Copy Database — Select Source' });
        if (!source) return;
        const newName = await vscode.window.showInputBox({
            title: 'Copy Database — New Name',
            placeHolder: `e.g. ${source}_copy`,
            prompt: 'Enter name for the new database',
            validateInput: v => /^[a-zA-Z0-9_]+$/.test(v) ? null : 'Only letters, numbers, underscores'
        });
        if (!newName) return;
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Copying ${source} → ${newName}...`, cancellable: false },
            async () => {
                const cfg = utils.getDbConfig();
                const createArgs = ['createdb', '-T', source];
                if (cfg.host) createArgs.push('-h', cfg.host);
                if (cfg.port) createArgs.push('-p', String(cfg.port));
                if (cfg.user) createArgs.push('-U', cfg.user);
                createArgs.push(newName);
                execSync(createArgs.map(a => JSON.stringify(a)).join(' '), { encoding: 'utf8', timeout: 120000, env });
            }
        );
        await vscode.workspace.getConfiguration('odooDebugger').update('database', newName, vscode.ConfigurationTarget.Workspace);
        updateStatusBar();
        vscode.window.showInformationMessage(`Database copied: ${source} → ${newName}. Now using ${newName}.`);
    } catch (e) {
        vscode.window.showErrorMessage(`Copy failed: ${e.message}`);
    }
}

async function dropDatabase() {
    const db = utils.getDatabase();
    const confirm = await vscode.window.showWarningMessage(
        `DROP database "${db}"? This is irreversible!`, { modal: true }, 'Drop'
    );
    if (confirm !== 'Drop') return;
    try {
        const cfg = utils.getDbConfig();
        const dropArgs = ['dropdb'];
        if (cfg.host) dropArgs.push('-h', cfg.host);
        if (cfg.port) dropArgs.push('-p', String(cfg.port));
        if (cfg.user) dropArgs.push('-U', cfg.user);
        dropArgs.push(db);
        const env = { ...process.env };
        if (cfg.password) env.PGPASSWORD = cfg.password;
        execSync(dropArgs.map(a => JSON.stringify(a)).join(' '), { encoding: 'utf8', env });
        vscode.window.showInformationMessage(`Database "${db}" dropped.`);
    } catch (e) {
        vscode.window.showErrorMessage(`Failed: ${e.message}`);
    }
}

async function switchDatabase() {
    const currentDb = utils.getDatabase();
    let dbs = [];
    try {
        const { args, env } = utils.buildPsqlArgs('postgres');
        const out = execSync(
            `psql ${args.map(a => JSON.stringify(a)).join(' ')} -q -A -t -c 'SELECT datname FROM pg_database WHERE datistemplate=false ORDER BY datname'`,
            { encoding: 'utf8', timeout: 5000, env }
        );
        dbs = out.trim().split('\n').filter(Boolean);
    } catch (_) {}

    // Always offer manual entry at top
    const items = [
        { label: '$(edit) Enter database name manually...', _manual: true },
        ...(dbs.length ? [{ label: '', kind: vscode.QuickPickItemKind.Separator }] : []),
        ...dbs.map(d => ({ label: d, description: d === currentDb ? '(current)' : '' })),
    ];

    const pick = await vscode.window.showQuickPick(items, {
        title: 'Switch Database',
        placeHolder: dbs.length ? 'Select or enter manually' : 'PostgreSQL not reachable — enter name manually',
    });
    if (!pick) return;

    let selected;
    if (pick._manual) {
        selected = await vscode.window.showInputBox({
            title: 'Database Name',
            value: currentDb,
            placeHolder: 'e.g. odoo18',
            validateInput: v => v.trim() ? null : 'Cannot be empty',
        });
        if (!selected?.trim()) return;
        selected = selected.trim();
    } else {
        selected = pick.label;
    }

    await vscode.workspace.getConfiguration('odooDebugger').update('database', selected, vscode.ConfigurationTarget.Workspace);
    updateStatusBar();
    vscode.window.showInformationMessage(`Switched to database: ${selected}`);
}

// ── Status Bar ─────────────────────────────────────────────────────

let _statusBarItem;

function createStatusBar() {
    _statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    _statusBarItem.command = 'odooDebugger.switchDatabase';
    updateStatusBar();
    _statusBarItem.show();

    // Listen for state changes
    utils.onServerStateChange(() => updateStatusBar());

    return _statusBarItem;
}

function updateStatusBar() {
    if (!_statusBarItem) return;
    const db = utils.getDatabase();
    const state = utils.getServerState();
    const venv = utils.getVenvDir();
    const venvName = venv ? require('path').basename(venv) : 'system';

    if (state === 'running') {
        _statusBarItem.text = `$(debug-start) Odoo: ${db} ● Running`;
        _statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.activeBackground');
        _statusBarItem.color = '#4ec94e';
    } else if (state === 'debugging') {
        _statusBarItem.text = `$(debug) Odoo: ${db} ● Debugging`;
        _statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.activeBackground');
        _statusBarItem.color = '#e8c44d';
    } else if (state === 'building') {
        _statusBarItem.text = `$(sync~spin) Odoo: ${db} ● Building`;
        _statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        _statusBarItem.color = '#ff9999';
    } else {
        _statusBarItem.text = `$(database) Odoo: ${db}`;
        _statusBarItem.backgroundColor = undefined;
        _statusBarItem.color = undefined;
    }
    _statusBarItem.tooltip = `DB: ${db} | State: ${state} | Venv: ${venvName}\nClick to switch DB`;
}

module.exports = {
    killPython, startPostgres,
    openOdoo, openApps, openDebugMode, clearAssets,
    removeUnusedImports, dropDatabase, copyDatabase, switchDatabase,
    createStatusBar, updateStatusBar,
};
