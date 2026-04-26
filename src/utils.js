const vscode = require('vscode');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── Server state tracking ──────────────────────────────────────────
let _serverState = 'stopped'; // 'stopped' | 'running' | 'debugging' | 'building'
let _serverTerminal = null;
let _debugSession = null;
let _onStateChange = new vscode.EventEmitter();
const onServerStateChange = _onStateChange.event;

function getServerState() { return _serverState; }

function setServerState(state, ref) {
    _serverState = state;
    if (state === 'running') _serverTerminal = ref;
    else if (state === 'debugging') _debugSession = ref;
    else { _serverTerminal = null; _debugSession = null; }
    _onStateChange.fire(state);
}

function getServerTerminal() { return _serverTerminal; }
function getDebugSession() { return _debugSession; }

// ── Config helpers ─────────────────────────────────────────────────
function resolveVars(str) {
    const wf = (vscode.workspace.workspaceFolders || [])[0];
    if (!wf) return str;
    return str.replace(/\$\{workspaceFolder\}/g, wf.uri.fsPath);
}

function getConfig(key) {
    const val = vscode.workspace.getConfiguration('odooDev').get(key);
    return typeof val === 'string' ? resolveVars(val) : val;
}

function getWorkspaceRoot() {
    return (vscode.workspace.workspaceFolders || [])[0]?.uri.fsPath || '';
}

function getCommunityPath() {
    return getConfig('communityPath') || path.join(getWorkspaceRoot(), 'community');
}

function getGithubPath() {
    return getConfig('githubPath') || path.join(getWorkspaceRoot(), 'github');
}

function getDatabase() {
    return getConfig('database') || 'odoo18';
}

function getPort() {
    return getConfig('port') || 8069;
}


// ── Venv ───────────────────────────────────────────────────────────
// Platform helpers
const _isWin = process.platform === 'win32';
const _venvBin = _isWin ? 'Scripts' : 'bin';
const _pythonExe = _isWin ? 'python.exe' : 'python';

function _isVenvDir(dir) {
    return fs.existsSync(path.join(dir, _venvBin, _pythonExe));
}

function _looksLikeVenvPython(pyPath) {
    if (!pyPath) return false;
    const sep = path.sep;
    return pyPath.includes(`${sep}bin${sep}python`) || pyPath.includes(`${sep}Scripts${sep}python`);
}

function getVenvDir() {
    const configured = getConfig('venvPath');
    if (configured && fs.existsSync(configured)) return configured;

    try {
        const candidates = [];
        try {
            const pyEnvsExt = vscode.extensions.getExtension('ms-python.vscode-python-envs');
            if (pyEnvsExt && pyEnvsExt.isActive && pyEnvsExt.exports && pyEnvsExt.exports.getActiveEnvironmentPath) {
                const p = pyEnvsExt.exports.getActiveEnvironmentPath();
                if (p && p.path) candidates.push(p.path);
            }
        } catch (_) {}
        const pyConfig = vscode.workspace.getConfiguration('python');
        [pyConfig.get('defaultInterpreterPath'), pyConfig.get('pythonPath')].forEach(p => { if (p) candidates.push(p); });

        for (const pyPath of candidates) {
            if (_looksLikeVenvPython(pyPath)) {
                const venvDir = path.resolve(pyPath, '..', '..');
                if (_isVenvDir(venvDir)) return venvDir;
            }
        }
    } catch (_) {}

    for (const name of ['venv', '.venv', 'env']) {
        const c = path.join(getWorkspaceRoot(), name);
        if (_isVenvDir(c)) return c;
    }

    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (home) {
        try {
            const envsDir = path.join(home, 'envs');
            if (fs.existsSync(envsDir)) {
                for (const e of fs.readdirSync(envsDir, { withFileTypes: true })) {
                    if (e.isDirectory() && _isVenvDir(path.join(envsDir, e.name))) return path.join(envsDir, e.name);
                }
            }
        } catch (_) {}
    }
    return '';
}

function getPythonPath() {
    const venv = getVenvDir();
    if (venv) return path.join(venv, _venvBin, _pythonExe);
    return _isWin ? 'python' : 'python3';
}

function getOdooBin() {
    return path.join(getCommunityPath(), 'odoo-bin');
}

function getConfigFile() {
    const cf = getConfig('configFile');
    if (!cf) return '';
    if (path.isAbsolute(cf)) return cf;
    return path.join(getWorkspaceRoot(), cf);
}

// ── Addons paths ───────────────────────────────────────────────────

/** Get configured addons paths, or auto-discover if empty */
function getCustomAddonsPaths() {
    const configured = getConfig('addonsPaths') || [];
    if (configured.length) return configured.map(p => resolveVars(p));
    return _autoDiscoverAddonsDirs();
}

/** Auto-discover addons dirs from github path (fallback when nothing configured) */
function _autoDiscoverAddonsDirs() {
    const ghPath = getGithubPath();
    if (!fs.existsSync(ghPath)) return [];
    const excluded = getConfig('excludedAddonsDirs') || [];
    const paths = [];
    try {
        const repos = fs.readdirSync(ghPath, { withFileTypes: true });
        for (const repo of repos) {
            if (!repo.isDirectory() || repo.name.startsWith('.')) continue;
            const repoPath = path.join(ghPath, repo.name);
            const subs = fs.readdirSync(repoPath, { withFileTypes: true });
            for (const s of subs) {
                if (!s.isDirectory() || s.name.startsWith('.') || excluded.includes(s.name)) continue;
                paths.push(path.join(repoPath, s.name));
            }
        }
    } catch (_) {}
    return paths;
}

/** Discover ALL possible addons dirs (for the manage picker) */
function discoverAllAddonsDirs() {
    const ghPath = getGithubPath();
    if (!fs.existsSync(ghPath)) return [];
    const paths = [];
    try {
        const repos = fs.readdirSync(ghPath, { withFileTypes: true });
        for (const repo of repos) {
            if (!repo.isDirectory() || repo.name.startsWith('.')) continue;
            const repoPath = path.join(ghPath, repo.name);
            const subs = fs.readdirSync(repoPath, { withFileTypes: true });
            for (const s of subs) {
                if (!s.isDirectory() || s.name.startsWith('.')) continue;
                paths.push(path.join(repoPath, s.name));
            }
        }
    } catch (_) {}
    return paths.sort();
}

function getFullAddonsPath() {
    const communityAddons = path.join(getCommunityPath(), 'addons');
    const custom = getCustomAddonsPaths();
    return custom.length ? `${communityAddons},${custom.join(',')}` : communityAddons;
}

// ── Module discovery (filesystem only) ─────────────────────────────

function discoverModulesFromDisk() {
    const modules = new Map();
    const addonsPaths = getFullAddonsPath().split(',').filter(Boolean);
    for (const addonsDir of addonsPaths) {
        if (!fs.existsSync(addonsDir)) continue;
        try {
            const entries = fs.readdirSync(addonsDir, { withFileTypes: true });
            for (const e of entries) {
                if (!e.isDirectory() || e.name.startsWith('.') || e.name === '__pycache__') continue;
                if (fs.existsSync(path.join(addonsDir, e.name, '__manifest__.py'))) {
                    modules.set(e.name, path.join(addonsDir, e.name));
                }
            }
        } catch (_) {}
    }
    return modules;
}

function getChangedModules() {
    const ghPath = getGithubPath();
    const modules = new Set();
    try {
        const commPath = getCommunityPath();
        if (fs.existsSync(path.join(commPath, '.git'))) {
            const out = execSync('git diff --name-only', { cwd: commPath, encoding: 'utf8' });
            for (const line of out.trim().split('\n')) {
                const parts = line.split('/');
                if (parts.length >= 2 && line.trim()) modules.add(parts[1]);
            }
        }
        if (fs.existsSync(ghPath)) {
            const repos = _findGitRepos(ghPath);
            for (const repo of repos) {
                try {
                    const out = execSync('git diff --name-only', { cwd: repo, encoding: 'utf8' });
                    for (const line of out.trim().split('\n')) {
                        const parts = line.split('/');
                        if (parts.length >= 2 && line.trim()) modules.add(parts[0]);
                    }
                } catch (_) {}
            }
        }
    } catch (_) {}
    modules.delete('');
    return [...modules];
}

function _findGitRepos(dir, depth = 0) {
    if (depth > 2) return [];
    const repos = [];
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
            if (!e.isDirectory() || e.name.startsWith('.')) continue;
            const full = path.join(dir, e.name);
            if (e.name === '.git') { repos.push(dir); continue; }
            repos.push(..._findGitRepos(full, depth + 1));
        }
    } catch (_) {}
    return repos;
}

/** Detect which module the given file belongs to */
function detectModuleFromFile(filePath) {
    if (!filePath) return null;
    let dir = filePath;
    for (let i = 0; i < 10; i++) {
        dir = path.dirname(dir);
        if (dir === '/' || dir === '.') return null;
        if (fs.existsSync(path.join(dir, '__manifest__.py'))) {
            return { name: path.basename(dir), path: dir };
        }
    }
    return null;
}

// ── Pickers ────────────────────────────────────────────────────────

async function pickModule(options = {}) {
    const { title = 'Select Module' } = options;
    const changed = getChangedModules();
    const allModules = discoverModulesFromDisk();
    const allNames = [...allModules.keys()].sort();

    const items = [];
    if (changed.length) {
        for (const m of changed) {
            items.push({ label: m, description: '$(git-compare) changed' });
        }
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    }
    for (const m of allNames) {
        if (!changed.includes(m)) {
            items.push({ label: m });
        }
    }

    const pick = await vscode.window.showQuickPick(items, {
        title, placeHolder: 'Type to filter...'
    });
    return pick?.label || undefined;
}

// ── Terminal helpers ────────────────────────────────────────────────

function runInTerminal(name, command, opts = {}) {
    const existing = vscode.window.terminals.find(t => t.name === name);
    if (existing && !opts.newTerminal) {
        existing.dispose();
    }
    const terminal = vscode.window.createTerminal({
        name,
        cwd: getWorkspaceRoot(),
        ...opts
    });
    terminal.show();
    terminal.sendText(command);
    return terminal;
}

function buildOdooArgs(extra = []) {
    const args = [
        `--addons-path=${getFullAddonsPath()}`,
        `--database=${getDatabase()}`,
        `--db-filter=${getDatabase()}`,
        '--dev=all',
        `--limit-time-real=${getConfig('limitTimeReal') || 10000}`,
        `--max-cron-threads=${getConfig('maxCronThreads') ?? 0}`,
    ];
    const cf = getConfigFile();
    if (cf && fs.existsSync(cf)) {
        args.push('-c', cf);
    }
    args.push('-s');
    args.push(...extra);
    return args;
}

module.exports = {
    // State
    getServerState, setServerState, getServerTerminal, getDebugSession, onServerStateChange,
    // Config
    getConfig, getWorkspaceRoot, getCommunityPath, getGithubPath, getDatabase, getPort,
    getVenvDir, getPythonPath, getOdooBin, getConfigFile,
    // Addons
    getCustomAddonsPaths, discoverAllAddonsDirs, getFullAddonsPath,
    // Modules
    discoverModulesFromDisk, getChangedModules, detectModuleFromFile, pickModule,
    // Terminal
    runInTerminal, buildOdooArgs, resolveVars
};
