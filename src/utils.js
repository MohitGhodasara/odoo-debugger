const vscode = require('vscode');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── Server state tracking ──────────────────────────────────────────
let _serverState = 'stopped'; // 'stopped' | 'starting' | 'running' | 'debugging' | 'building'
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
        if (pyExt) {
            // Try environments API (newer versions)
            const envPath = pyExt.exports?.environments?.getActiveEnvironmentPath?.()
                ?? pyExt.exports?.getActiveEnvironmentPath?.();
            if (envPath?.path && fs.existsSync(envPath.path)) return envPath.path;
            // Try direct interpreter path (older versions)
            const interp = pyExt.exports?.settings?.getExecutionDetails?.()?.execCommand?.[0];
            if (interp && fs.existsSync(interp)) return interp;
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

    // 2. Search workspace root — collect ALL matches
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

    // 2. Search workspace — may find multiple
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

/**
 * Get configured addons paths.
 * Priority: explicit setting > conf file addons_path > empty
 */
function getCustomAddonsPaths() {
    const configured = getConfig('addonsPaths') || [];
    if (configured.length) return configured.map(p => resolveVars(p));
    // Fall back to conf file addons_path
    const fromConf = _readConfValue('addons_path');
    if (fromConf) return fromConf.split(',').map(p => p.trim()).filter(Boolean);
    return [];
}

/**
 * Discover ALL possible addons dirs for the Manage Addons Paths picker.
 * Sources: conf file addons_path + community dirs from odooBinPath + workspace scan.
 */
function discoverAllAddonsDirs() {
    const seen = new Set();
    const paths = [];
    const addDir = (d) => { if (d && fs.existsSync(d) && !seen.has(d)) { seen.add(d); paths.push(d); } };

    // 1. From conf file addons_path
    try {
        const fromConf = _readConfValue('addons_path');
        if (fromConf) fromConf.split(',').map(p => p.trim()).filter(Boolean).forEach(addDir);
    } catch (_) {}

    // 2. Community addons dirs — siblings of odoo-bin
    try {
        const odooBin = getConfig('odooBinPath') || getOdooBin();
        if (odooBin) {
            const root = path.dirname(odooBin);
            for (const rel of ['addons', path.join('odoo', 'addons')]) addDir(path.join(root, rel));
        }
    } catch (_) {}

    // 3. Scan workspace root for any dir containing __manifest__.py modules (depth 2)
    try {
        const ws = getWorkspaceRoot();
        if (ws) _scanForAddonsDirs(ws, 0, addDir);
    } catch (_) {}

    return paths.sort();
}

/** Recursively scan for directories that contain Odoo modules (have subdirs with __manifest__.py) */
function _scanForAddonsDirs(dir, depth, addDir) {
    if (depth > 2) return;
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const skip = new Set(['.git', 'node_modules', '__pycache__', '.vscode', '.idea']);
        let hasModules = false;
        for (const e of entries) {
            if (!e.isDirectory() || skip.has(e.name) || e.name.startsWith('.')) continue;
            if (fs.existsSync(path.join(dir, e.name, '__manifest__.py'))) {
                hasModules = true;
            }
        }
        if (hasModules) { addDir(dir); return; } // this dir IS an addons dir
        for (const e of entries) {
            if (!e.isDirectory() || skip.has(e.name) || e.name.startsWith('.')) continue;
            _scanForAddonsDirs(path.join(dir, e.name), depth + 1, addDir);
        }
    } catch (_) {}
}

function getFullAddonsPath() {
    const custom = getCustomAddonsPaths();
    return custom.join(',') || '';
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
    const modules = new Set();
    const repoSet = new Set();
    // Find git repos by walking up from each addons path
    for (const addonsDir of getCustomAddonsPaths()) {
        const repo = _findGitRootUp(addonsDir);
        if (repo) repoSet.add(repo);
    }
    // Also walk up from workspace root as fallback
    const wsRepo = _findGitRootUp(getWorkspaceRoot());
    if (wsRepo) repoSet.add(wsRepo);

    for (const repo of repoSet) {
        try {
            // unstaged + staged changes
            const cmds = [
                'git diff --name-only HEAD',
                'git diff --name-only --cached HEAD',
            ];
            const lines = new Set();
            for (const cmd of cmds) {
                try {
                    execSync(cmd, { cwd: repo, encoding: 'utf8' })
                        .trim().split('\n')
                        .filter(l => l.trim())
                        .forEach(l => lines.add(l));
                } catch (_) {}
            }
            for (const line of lines) {
                const parts = line.split('/');
                if (parts.length < 2) continue;
                // Try parts[0] (flat: module/file.py) and parts[1] (nested: addons/module/file.py)
                for (const idx of [0, 1]) {
                    if (idx >= parts.length - 1) continue;
                    const mod = parts[idx];
                    if (mod && fs.existsSync(path.join(repo, parts.slice(0, idx + 1).join('/'), '__manifest__.py'))) {
                        modules.add(mod);
                        break;
                    }
                }
            }
        } catch (_) {}
    }
    modules.delete('');
    return [...modules];
}

/** Walk up from dir to find the git repo root. Returns null if not in a git repo. */
function _findGitRootUp(dir) {
    let current = dir;
    for (let i = 0; i < 10; i++) {
        if (!current || current === path.dirname(current)) return null;
        if (fs.existsSync(path.join(current, '.git'))) return current;
        current = path.dirname(current);
    }
    return null;
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
    const cf = getConfigFile();
    const hasConf = cf && fs.existsSync(cf);
    const args = [];

    // Addons path — always pass if configured, overrides conf file value
    const addonsPath = getFullAddonsPath();
    if (addonsPath) args.push(`--addons-path=${addonsPath}`);

    if (hasConf) {
        // Conf file handles db, limits, workers, log settings etc.
        args.push('-c', cf);
        // Only override database if user explicitly set it in extension settings
        // (not read from conf — that would be a no-op duplicate)
        const dbOverride = getConfig('database');
        if (dbOverride) {
            args.push(`--database=${dbOverride}`);
            args.push(`--db-filter=${dbOverride}`);
        }
    } else {
        // No conf file — build full args from settings
        const cfg = getDbConfig();
        if (cfg.database) {
            args.push(`--database=${cfg.database}`);
            args.push(`--db-filter=${cfg.database}`);
        }
        if (cfg.host)     args.push(`--db_host=${cfg.host}`);
        if (cfg.port)     args.push(`--db_port=${cfg.port}`);
        if (cfg.user)     args.push(`--db_user=${cfg.user}`);
        if (cfg.password) args.push(`--db_password=${cfg.password}`);
    }

    const extraArgs = getConfig('extraArgs') || [];
    args.push(...extraArgs);
    // Inject --logfile if log panel is enabled (only for main server, not build/shell)
    if (extra.length === 0 || (!extra.includes('--stop-after-init') && !extra.includes('shell'))) {
        if (getConfig('logPanel.enabled') !== false) {
            const logFile = getConfig('logPanel.logFile') || '/tmp/odoo-vscode.log';
            args.push(`--logfile=${logFile}`);
        }
    }
    args.push(...extra);
    return args;
}

module.exports = {
    // State
    getServerState, setServerState, getServerTerminal, getDebugSession, onServerStateChange,
    // Config
    getConfig, getWorkspaceRoot, getDatabase, getPort,
    getVenvDir, getPythonPath, getOdooBin, resolveOdooBin, getConfigFile,
    getDbConfig, buildPsqlArgs, runPsql, testDbConnection,
    // Addons
    getCustomAddonsPaths, discoverAllAddonsDirs, getFullAddonsPath,
    // Modules
    discoverModulesFromDisk, getChangedModules, detectModuleFromFile, pickModule,
    // Terminal
    runInTerminal, buildOdooArgs, resolveVars
};
