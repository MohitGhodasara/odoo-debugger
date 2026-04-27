const vscode = require('vscode');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const utils = require('./utils');

let _buildPrevState = null;
function getBuildPrevState() { const s = _buildPrevState; _buildPrevState = null; return s; }

// ── Run / Debug / Stop ─────────────────────────────────────────────

/** Auto-stop server if running, returns true if ready to proceed */
async function _ensureStopped(waitForPort = true) {
    if (utils.getServerState() === 'stopped') return true;
    // Both run (noDebug) and debug use a debug session
    if (vscode.debug.activeDebugSession) {
        await vscode.debug.stopDebugging();
    }
    const terminal = utils.getServerTerminal();
    if (terminal) terminal.dispose();
    utils.setServerState('stopped', null);
    if (!waitForPort) {
        await new Promise(r => setTimeout(r, 1000));
        return true;
    }
    // Wait for port to free up (only for run/debug, not update/install)
    const net = require('net');
    for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 400));
        const free = await new Promise(resolve => {
            const s = net.createConnection({ port: utils.getPort() });
            s.on('connect', () => { s.destroy(); resolve(false); });
            s.on('error', () => resolve(true));
            s.setTimeout(300, () => { s.destroy(); resolve(true); });
        });
        if (free) return true;
    }
    return true;
}

async function runOdoo() {
    await _ensureStopped();
    const odooBin = await utils.resolveOdooBin();
    if (!odooBin) return;
    const args = utils.buildOdooArgs();
    const pythonPath = utils.getPythonPath();
    const config = {
        name: 'Run Odoo',
        type: 'debugpy',
        request: 'launch',
        program: odooBin,
        python: pythonPath,
        pythonPath: pythonPath,
        args,
        django: true,
        jinja: true,
        console: 'integratedTerminal',
        env: { VIRTUAL_ENV: utils.getVenvDir() || '' },
    };
    const started = await vscode.debug.startDebugging(undefined, config, { noDebug: true, suppressDebugToolbar: true, suppressDebugStatusbar: true, suppressDebugView: true });
    if (started) {
        utils.setServerState('running', null);
    }
}

async function debugOdoo() {
    await _ensureStopped();
    const odooBin = await utils.resolveOdooBin();
    if (!odooBin) return;
    const args = utils.buildOdooArgs();
    const pythonPath = utils.getPythonPath();
    const config = {
        name: 'Debug Odoo',
        type: 'debugpy',
        request: 'launch',
        program: odooBin,
        python: pythonPath,
        pythonPath: pythonPath,
        args,
        django: true,
        jinja: true,
        console: 'integratedTerminal',
        env: { VIRTUAL_ENV: utils.getVenvDir() || '' },
    };
    const started = await vscode.debug.startDebugging(undefined, config);
    if (started) {
        utils.setServerState('debugging', vscode.debug.activeDebugSession);
    }
}

async function stopOdoo() {
    const state = utils.getServerState();
    if (state === 'running' || state === 'debugging') {
        const terminal = utils.getServerTerminal();
        if (terminal) terminal.dispose();
        if (vscode.debug.activeDebugSession) {
            await vscode.debug.stopDebugging();
        }
    }
    utils.setServerState('stopped', null);
}

// ── Install / Update / Uninstall ───────────────────────────────────

async function updateModule() {
    const mod = await utils.pickModule({ title: 'Update Module' });
    if (!mod) return;
    _buildPrevState = utils.getServerState(); // capture BEFORE stopping
    await _ensureStopped(false);
    await _buildModule('update', mod);
}

async function installModule() {
    const mod = await utils.pickModule({ title: 'Install Module' });
    if (!mod) return;
    _buildPrevState = utils.getServerState();
    await _ensureStopped(false);
    await _buildModule('init', mod);
}

async function updateChangedModules() {
    const changed = utils.getChangedModules();
    if (!changed.length) {
        vscode.window.showInformationMessage('No changed modules detected from git diff.');
        return;
    }
    const pick = await vscode.window.showQuickPick(
        [
            { label: changed.join(','), description: 'All changed' },
            ...changed.map(m => ({ label: m }))
        ],
        { title: 'Update Changed Modules', placeHolder: 'Select modules to update' }
    );
    if (!pick) return;
    _buildPrevState = utils.getServerState();
    await _ensureStopped(false);
    await _buildModule('update', pick.label);
}

async function uninstallModule() {
    const mod = await utils.pickModule({ title: 'Uninstall Module' });
    if (!mod) return;
    const confirm = await vscode.window.showWarningMessage(
        `Uninstall "${mod}"? This cannot be undone easily.`, { modal: true }, 'Uninstall'
    );
    if (confirm !== 'Uninstall') return;
    const odooBin = await utils.resolveOdooBin();
    if (!odooBin) return;
    const pythonPath = utils.getPythonPath();
    await vscode.debug.startDebugging(undefined, {
        name: 'Odoo Uninstall',
        type: 'debugpy',
        request: 'launch',
        program: odooBin,
        python: pythonPath,
        pythonPath: pythonPath,
        args: ['shell', `--database=${utils.getDatabase()}`, `--db-filter=${utils.getDatabase()}`,
               `--addons-path=${utils.getFullAddonsPath()}`, '--no-http'],
        console: 'integratedTerminal',
        env: { VIRTUAL_ENV: utils.getVenvDir() || '' },
    }, { noDebug: true, suppressDebugToolbar: true, suppressDebugStatusbar: true, suppressDebugView: true });
    vscode.window.showInformationMessage(`Shell opened. Run: self.env['ir.module.module'].search([('name','=','${mod}')]).button_immediate_uninstall()`);
}

async function _buildModule(action, modules) {
    const upgradeScript = utils.getConfig('upgradeScript');
    if (upgradeScript) {
        utils.runInTerminal('Odoo Build', `bash "${upgradeScript}" ${modules}`);
        return;
    }
    const odooBin = await utils.resolveOdooBin();
    if (!odooBin) return;
    const args = utils.buildOdooArgs([`--${action}=${modules}`, '--stop-after-init']);
    const pythonPath = utils.getPythonPath();

    utils.setServerState('building', null);
    vscode.debug.startDebugging(undefined, {
        name: 'Odoo Build',
        type: 'debugpy',
        request: 'launch',
        program: odooBin,
        python: pythonPath,
        pythonPath: pythonPath,
        args,
        django: true,
        console: 'integratedTerminal',
        env: { VIRTUAL_ENV: utils.getVenvDir() || '' },
    }, { noDebug: true, suppressDebugToolbar: true, suppressDebugStatusbar: true, suppressDebugView: true });
}

// ── Shell ──────────────────────────────────────────────────────────

async function openShell() {
    const odooBin = await utils.resolveOdooBin();
    if (!odooBin) return;
    const pythonPath = utils.getPythonPath();
    await vscode.debug.startDebugging(undefined, {
        name: 'Odoo Shell',
        type: 'debugpy',
        request: 'launch',
        program: odooBin,
        python: pythonPath,
        pythonPath: pythonPath,
        args: ['shell', `--database=${utils.getDatabase()}`, `--db-filter=${utils.getDatabase()}`,
               `--addons-path=${utils.getFullAddonsPath()}`, '--no-http'],
        console: 'integratedTerminal',
        env: { VIRTUAL_ENV: utils.getVenvDir() || '' },
    }, { noDebug: true, suppressDebugToolbar: true, suppressDebugStatusbar: true, suppressDebugView: true });
}

// ── Logs (removed — handled by logViewer from terminal capture) ──

// ── JS Debug ───────────────────────────────────────────────────────

async function launchChromeDebug() {
    let chromePath = utils.getConfig('chromePath');
    if (!chromePath) {
        // Auto-detect Chrome
        const candidates = process.platform === 'win32'
            ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']
            : ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
        chromePath = candidates.find(c => fs.existsSync(c));
    }
    if (!chromePath || !fs.existsSync(chromePath)) {
        vscode.window.showErrorMessage('Chrome not found. Set odooDebugger.chromePath in settings.');
        return;
    }
    const port = utils.getConfig('chromeDebugPort') || 9222;
    const odooPort = utils.getPort();
    const url = `http://localhost:${odooPort}/web?debug=assets`;
    utils.runInTerminal('Chrome Debug',
        `"${chromePath}" --remote-debugging-port=${port} --user-data-dir=/tmp/chrome-odoo-debug "${url}"`
    );
    vscode.window.showInformationMessage(`Chrome launched on debug port ${port}. Use "Attach JS Debugger" to connect.`);
}

async function attachJsDebugger() {
    const port = utils.getConfig('chromeDebugPort') || 9222;
    const odooPort = utils.getPort();

    // Build pathMapping from all custom addons paths
    const pathMapping = {
        '/': path.join(utils.getCommunityPath(), 'addons') + '/',
    };
    const customPaths = utils.getCustomAddonsPaths();
    for (const addonsDir of customPaths) {
        if (!fs.existsSync(addonsDir)) continue;
        try {
            const entries = fs.readdirSync(addonsDir, { withFileTypes: true });
            for (const e of entries) {
                if (!e.isDirectory() || e.name.startsWith('.')) continue;
                if (fs.existsSync(path.join(addonsDir, e.name, '__manifest__.py'))) {
                    pathMapping[`/${e.name}`] = path.join(addonsDir, e.name);
                }
            }
        } catch (_) {}
    }

    const config = {
        name: 'Odoo JS Debug',
        type: 'chrome',
        request: 'attach',
        port,
        trace: true,
        urlFilter: `http://localhost:${odooPort}/*`,
        sourceMaps: true,
        pathMapping,
    };
    await vscode.debug.startDebugging(undefined, config);
}

// ── Manage Addons Paths ────────────────────────────────────────────

async function manageAddonsPaths() {
    const allDirs = utils.discoverAllAddonsDirs();
    const currentPaths = utils.getCustomAddonsPaths();

    const items = [
        // Always show a "Browse custom folder..." option at top
        { label: '$(folder-opened) Browse for folder...', description: 'Add a custom directory not listed below', _browse: true },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        ...allDirs.map(dir => ({
            label: path.basename(dir),
            description: dir,
            picked: currentPaths.includes(dir),
        })),
        // Also show currently configured paths that may not be in auto-discovered list
        ...currentPaths
            .filter(p => !allDirs.includes(p))
            .map(p => ({ label: path.basename(p), description: p, picked: true, detail: '(custom — not auto-discovered)' })),
    ];

    const picks = await vscode.window.showQuickPick(items, {
        title: 'Manage Addons Paths',
        placeHolder: 'Check directories to include as addons paths',
        canPickMany: true,
    });
    if (!picks) return;

    // Handle browse option
    let selected = picks.filter(p => !p._browse).map(p => p.description);
    if (picks.some(p => p._browse)) {
        const uris = await vscode.window.showOpenDialog({
            title: 'Select Addons Directory',
            canSelectFiles: false, canSelectFolders: true, canSelectMany: true,
        });
        if (uris) selected.push(...uris.map(u => u.fsPath));
    }

    selected = [...new Set(selected)];
    await vscode.workspace.getConfiguration('odooDebugger').update(
        'addonsPaths', selected, vscode.ConfigurationTarget.Workspace
    );
    vscode.window.showInformationMessage(`Addons paths updated: ${selected.length} path(s) configured.`);
}

// ── Scaffold Module ────────────────────────────────────────────────

async function scaffoldModule() {
    const customPaths = utils.getCustomAddonsPaths();
    let targetDir;

    if (customPaths.length === 0) {
        vscode.window.showErrorMessage('No addons paths configured. Run "Manage Addons Paths" first.');
        return;
    } else if (customPaths.length === 1) {
        targetDir = customPaths[0];
    } else {
        const pick = await vscode.window.showQuickPick(
            customPaths.map(p => ({ label: path.basename(p), description: p })),
            { title: 'Where to create the module?' }
        );
        if (!pick) return;
        targetDir = pick.description;
    }

    const moduleName = await vscode.window.showInputBox({
        title: 'Module Name',
        placeHolder: 'e.g. ion_feature_request',
        prompt: 'Technical name (snake_case)',
        validateInput: v => /^[a-z][a-z0-9_]*$/.test(v) ? null : 'Must be lowercase snake_case'
    });
    if (!moduleName) return;

    const displayName = await vscode.window.showInputBox({
        title: 'Display Name',
        placeHolder: 'e.g. Feature Request',
        prompt: 'Human-readable module title',
    });
    if (!displayName) return;

    const modelDotName = moduleName.replace(/_/g, '.');
    const modelClassName = moduleName.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    const moduleDir = path.join(targetDir, moduleName);

    if (fs.existsSync(moduleDir)) {
        vscode.window.showErrorMessage(`Directory already exists: ${moduleDir}`);
        return;
    }

    // Create directories
    fs.mkdirSync(path.join(moduleDir, 'models'), { recursive: true });
    fs.mkdirSync(path.join(moduleDir, 'views'), { recursive: true });
    fs.mkdirSync(path.join(moduleDir, 'security'), { recursive: true });

    // __manifest__.py
    fs.writeFileSync(path.join(moduleDir, '__manifest__.py'),
`{
    'name': '${displayName}',
    'version': '18.0.1.0.0',
    'category': 'Uncategorized',
    'summary': '${displayName}',
    'depends': ['base', 'mail'],
    'data': [
        'security/ir.model.access.csv',
        'views/${moduleName}_views.xml',
    ],
    'installable': True,
    'auto_install': False,
    'license': 'LGPL-3',
}
`);

    // __init__.py (root)
    fs.writeFileSync(path.join(moduleDir, '__init__.py'), 'from . import models\n');

    // models/__init__.py
    fs.writeFileSync(path.join(moduleDir, 'models', '__init__.py'), `from . import ${moduleName}\n`);

    // models/<module>.py
    fs.writeFileSync(path.join(moduleDir, 'models', `${moduleName}.py`),
`from odoo import api, fields, models, _
from odoo.exceptions import UserError, ValidationError


class ${modelClassName}(models.Model):
    _name = '${modelDotName}'
    _description = '${displayName}'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'create_date desc'

    name = fields.Char(string='Name', required=True, tracking=True)
    company_id = fields.Many2one('res.company', default=lambda self: self.env.company)
    active = fields.Boolean(default=True)
    state = fields.Selection([
        ('draft', 'Draft'),
        ('confirmed', 'Confirmed'),
        ('done', 'Done'),
        ('cancelled', 'Cancelled'),
    ], default='draft', tracking=True)
`);

    // views/<module>_views.xml
    const xmlId = moduleName.replace(/_/g, '_');
    fs.writeFileSync(path.join(moduleDir, 'views', `${moduleName}_views.xml`),
`<?xml version="1.0" encoding="utf-8"?>
<odoo>

    <!-- Form View -->
    <record id="${xmlId}_view_form" model="ir.ui.view">
        <field name="name">${modelDotName}.form</field>
        <field name="model">${modelDotName}</field>
        <field name="arch" type="xml">
            <form string="${displayName}">
                <header>
                    <field name="state" widget="statusbar" statusbar_visible="draft,confirmed,done"/>
                </header>
                <sheet>
                    <div class="oe_title">
                        <h1><field name="name" placeholder="Name..."/></h1>
                    </div>
                    <group>
                        <group>
                            <field name="company_id" groups="base.group_multi_company"/>
                        </group>
                        <group>
                            <field name="active" invisible="1"/>
                        </group>
                    </group>
                </sheet>
                <chatter/>
            </form>
        </field>
    </record>

    <!-- Tree View -->
    <record id="${xmlId}_view_tree" model="ir.ui.view">
        <field name="name">${modelDotName}.tree</field>
        <field name="model">${modelDotName}</field>
        <field name="arch" type="xml">
            <tree string="${displayName}" decoration-muted="state == 'cancelled'">
                <field name="name"/>
                <field name="state" decoration-success="state == 'done'" decoration-info="state == 'draft'" widget="badge"/>
            </tree>
        </field>
    </record>

    <!-- Search View -->
    <record id="${xmlId}_view_search" model="ir.ui.view">
        <field name="name">${modelDotName}.search</field>
        <field name="model">${modelDotName}</field>
        <field name="arch" type="xml">
            <search string="${displayName}">
                <field name="name"/>
                <filter name="my_records" string="My Records" domain="[('create_uid', '=', uid)]"/>
                <separator/>
                <filter name="draft" string="Draft" domain="[('state', '=', 'draft')]"/>
                <filter name="confirmed" string="Confirmed" domain="[('state', '=', 'confirmed')]"/>
                <group expand="0" string="Group By">
                    <filter name="group_state" string="State" context="{'group_by': 'state'}"/>
                </group>
            </search>
        </field>
    </record>

    <!-- Action -->
    <record id="${xmlId}_action" model="ir.actions.act_window">
        <field name="name">${displayName}</field>
        <field name="res_model">${modelDotName}</field>
        <field name="view_mode">tree,form</field>
    </record>

    <!-- Menu -->
    <menuitem id="menu_${xmlId}_root" name="${displayName}" sequence="100"/>
    <menuitem id="menu_${xmlId}" name="${displayName}" parent="menu_${xmlId}_root" action="${xmlId}_action"/>

</odoo>
`);

    // security/ir.model.access.csv
    const modelUnderscore = modelDotName.replace(/\./g, '_');
    fs.writeFileSync(path.join(moduleDir, 'security', 'ir.model.access.csv'),
`id,name,model_id/id,group_id/id,perm_read,perm_write,perm_create,perm_unlink
access_${modelUnderscore}_user,${modelDotName} user,model_${modelUnderscore},base.group_user,1,1,1,0
access_${modelUnderscore}_manager,${modelDotName} manager,model_${modelUnderscore},base.group_system,1,1,1,1
`);

    // Open the model file
    const modelFile = path.join(moduleDir, 'models', `${moduleName}.py`);
    const doc = await vscode.workspace.openTextDocument(modelFile);
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage(`Module "${moduleName}" scaffolded at ${moduleDir}`);
}

module.exports = {
    runOdoo, debugOdoo, stopOdoo,
    updateModule, installModule, updateChangedModules, uninstallModule,
    openShell,
    launchChromeDebug, attachJsDebugger,
    manageAddonsPaths, scaffoldModule,
    getBuildPrevState,
};
