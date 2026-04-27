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
    const val = vscode.workspace.getConfiguration('odooDebugger').get(key);
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
    return getConfig('database') || _readConfValue('db_name') || '';
}

function getPort() {
    return getConfig('port') || _readConfValue('http_port') || 8069;
}

// ── Odoo conf file parser ──────────────────────────────────────────

/** Parse a single key from the odoo conf/rc file. Returns string or null. */
function _readConfValue(key) {
    try {
        const cf = getConfigFile();
        if (!cf || !fs.existsSync(cf)) return null;
        const content = fs.readFileSync(cf, 'utf8');
        const match = content.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm'));
        if (!match) return null;
        const val = match[1].trim();
        // Odoo uses 'False' for unset values
        if (val === 'False' || val === 'false' || val === '') return null;
        return val;
    } catch (_) { return null; }
}

/** Get all DB connection details — explicit setting > conf file > OS default */
function getDbConfig() {
    return {
        database: getConfig('database') || _readConfValue('db_name') || '',
        host:     getConfig('dbHost')     || _readConfValue('db_host')     || '',
        port:     getConfig('dbPort')     || _readConfValue('db_port')     || '',
        user:     getConfig('dbUser')     || _readConfValue('db_user')     || '',
        password: getConfig('dbPassword') || _readConfValue('db_password') || '',
    };
}

/**
 * Build psql CLI args array and env object from DB config.
 * Usage: execSync(`psql ${buildPsqlArgs().args.join(' ')} ...`, { env: buildPsqlArgs().env })
 */
function buildPsqlArgs(overrideDb) {
    const cfg = getDbConfig();
    const db = overrideDb || cfg.database;
    const args = ['-d', db];
    if (cfg.host) args.push('-h', cfg.host);
    if (cfg.port) args.push('-p', String(cfg.port));
    if (cfg.user) args.push('-U', cfg.user);
    const env = { ...process.env };
    if (cfg.password) env.PGPASSWORD = cfg.password;
    return { args, env };
}

/** Run a psql command, returns stdout string. Throws on error. */
function runPsql(sqlOrArgs, extraArgs = []) {
    const { args, env } = buildPsqlArgs();
    const cmdArgs = [...args, ...extraArgs,
        typeof sqlOrArgs === 'string' ? `-c` : null,
        typeof sqlOrArgs === 'string' ? sqlOrArgs : null,
    ].filter(Boolean);
    return execSync(`psql ${cmdArgs.map(a => JSON.stringify(a)).join(' ')}`, { encoding: 'utf8', timeout: 10000, env });
}

/** Test DB connection. Returns null on success, error message string on failure. */
function testDbConnection() {
    try {
        // Connect to 'postgres' maintenance DB — always exists, doesn't require target DB to exist
        const { args, env } = buildPsqlArgs('postgres');
        execSync(`psql ${args.map(a => JSON.stringify(a)).join(' ')} -c "SELECT 1" -q`, { encoding: 'utf8', timeout: 5000, env });
        return null;
    } catch (e) {
        return (e.stderr || e.message || 'Unknown error').trim();
    }
}


// ── Python interpreter ─────────────────────────────────────────────
const _isWin = process.platform === 'win32';

/** Returns the Python interpreter path from VS Code's selected interpreter. */
function getPythonPath() {
    // 1. Explicit override in settings
    const explicit = getConfig('venvPath');
    if (explicit && fs.existsSync(explicit)) return explicit;

    // 2. VS Code Python extension active environment API (ms-python >= 2023.x)
    try {
        const pyExt = vscode.extensions.getExtension('ms-python.python');
        if (pyExt?.isActive) {
            const envPath = pyExt.exports?.environments?.getActiveEnvironmentPath?.();
            if (envPath?.path && fs.existsSync(envPath.path)) return envPath.path;
        }
    } catch (_) {}

    // 3. python.defaultInterpreterPath / python.pythonPath workspace setting
    const pyConfig = vscode.workspace.getConfiguration('python');
    for (const key of ['defaultInterpreterPath', 'pythonPath']) {
        const p = pyConfig.get(key);
        if (p && typeof p === 'string' && fs.existsSync(p)) return p;
    }

    return _isWin ? 'python' : 'python3';
}

/** For display in status bar / sidebar — parent dir of the interpreter */
function getVenvDir() {
    const py = getPythonPath();
    if (!py || py === 'python' || py === 'python3') return '';
    return path.dirname(path.dirname(py)); // bin/../ = env root
}

function getOdooBin() {
    // 1. Explicit setting
    const explicit = getConfig('odooBinPath');
    if (explicit && _isExecutable(explicit)) return explicit;

    // 2. communityPath/odoo-bin
    const communityBin = path.join(getCommunityPath(), 'odoo-bin');
    if (_isExecutable(communityBin)) return communityBin;

    // 3. Search workspace root — collect ALL matches
    const found = _findAllOdooBins(getWorkspaceRoot(), 0);
    if (found.length === 1) return found[0];
    if (found.length > 1) return null; // multiple — caller must prompt

    return null; // not found
}

function _isExecutable(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return false;
    try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) return false;
        if (process.platform !== 'win32') fs.accessSync(filePath, fs.constants.X_OK);
        return true;
    } catch (_) { return false; }
}

function _findAllOdooBins(dir, depth) {
    if (depth > 3 || !dir || !fs.existsSync(dir)) return [];
    const results = [];
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
            if (e.name === 'odoo-bin' && !e.isDirectory()) {
                const full = path.join(dir, e.name);
                if (_isExecutable(full)) results.push(full);
            }
        }
        for (const e of entries) {
            if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== '__pycache__') {
                results.push(..._findAllOdooBins(path.join(dir, e.name), depth + 1));
            }
        }
    } catch (_) {}
    return results;
}

async function resolveOdooBin() {
    // 1. Explicit setting
    const explicit = getConfig('odooBinPath');
    if (explicit && _isExecutable(explicit)) return explicit;

    // 2. communityPath/odoo-bin
    const communityBin = path.join(getCommunityPath(), 'odoo-bin');
    if (_isExecutable(communityBin)) return communityBin;

    // 3. Search workspace — may find multiple
    const found = _findAllOdooBins(getWorkspaceRoot(), 0);

    if (found.length === 1) return found[0];

    if (found.length > 1) {
        // Multiple found — let user pick
        const pick = await vscode.window.showQuickPick(
            found.map(f => ({ label: path.relative(getWorkspaceRoot(), f), description: f })),
            { title: 'Multiple odoo-bin found — select one' }
        );
        if (!pick) return null;
        await vscode.workspace.getConfiguration('odooDebugger').update('odooBinPath', pick.description, vscode.ConfigurationTarget.Workspace);
        return pick.description;
    }

    // 4. Not found — prompt user
    const action = await vscode.window.showWarningMessage(
        'odoo-bin not found. Please locate it manually.',
        'Browse...', 'Enter Path'
    );
    if (action === 'Browse...') {
        const uris = await vscode.window.showOpenDialog({
            title: 'Select odoo-bin',
            canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
        });
        if (uris && uris[0]) {
            const selected = uris[0].fsPath;
            await vscode.workspace.getConfiguration('odooDebugger').update('odooBinPath', selected, vscode.ConfigurationTarget.Workspace);
            return selected;
        }
    } else if (action === 'Enter Path') {
        const entered = await vscode.window.showInputBox({
            title: 'Path to odoo-bin',
            placeHolder: '/path/to/odoo-bin',
            validateInput: v => _isExecutable(v) ? null : 'File not found or not executable'
        });
        if (entered) {
            await vscode.workspace.getConfiguration('odooDebugger').update('odooBinPath', entered, vscode.ConfigurationTarget.Workspace);
            return entered;
        }
    }
    return null;
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
            const out = execSync('git diff --name-only HEAD', { cwd: commPath, encoding: 'utf8' });
            for (const line of out.trim().split('\n')) {
                const parts = line.split('/');
                if (parts.length >= 2 && line.trim()) {
                    const mod = parts[0];
                    if (mod && fs.existsSync(path.join(commPath, mod, '__manifest__.py'))) modules.add(mod);
                }
            }
        }
        if (fs.existsSync(ghPath)) {
            const repos = _findGitRepos(ghPath);
            for (const repo of repos) {
                try {
                    const out = execSync('git diff --name-only HEAD', { cwd: repo, encoding: 'utf8' });
                    for (const line of out.trim().split('\n')) {
                        const parts = line.split('/');
                        if (parts.length >= 2 && line.trim()) {
                            const mod = parts[0];
                            if (mod && fs.existsSync(path.join(repo, mod, '__manifest__.py'))) modules.add(mod);
                        }
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
    const cfg = getDbConfig();
    const args = [
        `--addons-path=${getFullAddonsPath()}`,
        `--database=${cfg.database}`,
        `--db-filter=${cfg.database}`,
        '--dev=all',
        `--limit-time-real=${getConfig('limitTimeReal') || 10000}`,
        `--max-cron-threads=${getConfig('maxCronThreads') ?? 0}`,
    ];
    // Pass explicit DB connection args only when set (not from conf file — conf file is passed via -c)
    if (getConfig('dbHost'))     args.push(`--db_host=${cfg.host}`);
    if (getConfig('dbPort'))     args.push(`--db_port=${cfg.port}`);
    if (getConfig('dbUser'))     args.push(`--db_user=${cfg.user}`);
    if (getConfig('dbPassword')) args.push(`--db_password=${cfg.password}`);
    const cf = getConfigFile();
    if (cf && fs.existsSync(cf)) args.push('-c', cf);
    args.push('-s');
    args.push(...extra);
    return args;
}

module.exports = {
    // State
    getServerState, setServerState, getServerTerminal, getDebugSession, onServerStateChange,
    // Config
    getConfig, getWorkspaceRoot, getCommunityPath, getGithubPath, getDatabase, getPort,
    getVenvDir, getPythonPath, getOdooBin, resolveOdooBin, getConfigFile,
    getDbConfig, buildPsqlArgs, runPsql, testDbConnection,
    // Addons
    getCustomAddonsPaths, discoverAllAddonsDirs, getFullAddonsPath,
    // Modules
    discoverModulesFromDisk, getChangedModules, detectModuleFromFile, pickModule,
    // Terminal
    runInTerminal, buildOdooArgs, resolveVars
};
