const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const utils = require('./utils');

const CTX_FILTER_ACTIVE = 'odooDebuggerModelFilterActive';

// ── Tree item types ────────────────────────────────────────────────

class ModelItem extends vscode.TreeItem {
    constructor(modelName, sources) {
        super(modelName, vscode.TreeItemCollapsibleState.Collapsed);
        this.modelName = modelName;
        this.sources = sources;
        const modules = [...new Set(sources.map(s => s.moduleName))];
        this.description = modules.join(', ');
        this.tooltip = `${modelName}\n${sources.map(s => `${s.isInherit ? '↳ inherit' : '✦ defined'} in ${s.moduleName}`).join('\n')}`;
        // Determine dominant type across sources
        const types = [...new Set(sources.map(s => s.modelType || 'model'))];
        const dominantType = types.includes('model') ? 'model' : types[0];
        const iconMap = { model: 'symbol-class', transient: 'symbol-interface', abstract: 'symbol-namespace' };
        this.contextValue = 'odooModel';
        this.modelType = dominantType;
        this.iconPath = new vscode.ThemeIcon(iconMap[dominantType] || 'symbol-class');
        if (sources.length === 1) {
            this.command = { command: 'odooDebugger.modelExplorer.goto', title: 'Go to Model', arguments: [sources[0].filePath, sources[0].line] };
        }
    }
}

class SourceItem extends vscode.TreeItem {
    constructor(source) {
        super(source.moduleName, vscode.TreeItemCollapsibleState.Collapsed);
        this.source = source;
        this.description = source.isInherit ? 'inherit' : 'defined here';
        this.tooltip = source.filePath;
        this.contextValue = 'odooModelSource';
        this.iconPath = new vscode.ThemeIcon(source.isInherit ? 'symbol-interface' : 'symbol-class');
        this.command = { command: 'odooDebugger.modelExplorer.goto', title: 'Go to Definition', arguments: [source.filePath, source.line] };
    }
}

const _FIELD_ICONS = {
    Char: 'symbol-string', Text: 'symbol-string', Html: 'symbol-string',
    Integer: 'symbol-number', Float: 'symbol-number', Monetary: 'symbol-number',
    Boolean: 'symbol-boolean',
    Date: 'symbol-event', Datetime: 'symbol-event',
    Selection: 'symbol-enum',
    Many2one: 'symbol-key',
    One2many: 'symbol-array', Many2many: 'symbol-array',
    Binary: 'symbol-file', Image: 'symbol-file',
    Reference: 'symbol-reference',
};

class FieldItem extends vscode.TreeItem {
    constructor(field) {
        super(field.name, vscode.TreeItemCollapsibleState.None);
        this.field = field;
        this.description = field.type;
        this.tooltip = `${field.name}: fields.${field.type}\n${field.filePath}:${field.line}`;
        this.contextValue = 'odooField';
        this.iconPath = new vscode.ThemeIcon(_FIELD_ICONS[field.type] || 'symbol-field');
        this.command = { command: 'odooDebugger.modelExplorer.goto', title: 'Go to Field', arguments: [field.filePath, field.line] };
    }
}

function _methodIcon(method) {
    const dec = method.decorator || '';
    const name = method.name || '';
    if (dec.includes('api.depends') || dec.includes('api.onchange')) return 'symbol-event';
    if (dec.includes('api.constrains')) return 'symbol-ruler';
    if (dec.includes('api.model')) return 'symbol-class';
    if (dec.includes('staticmethod')) return 'symbol-constant';
    if (dec.includes('classmethod')) return 'symbol-namespace';
    if (/^action_/.test(name)) return 'symbol-event';
    if (/^_compute_/.test(name)) return 'symbol-event';
    if (/^_onchange_/.test(name)) return 'symbol-event';
    if (/^(_check_|_validate_|_constraint_)/.test(name)) return 'symbol-ruler';
    if (/^(write|create|unlink|copy)$/.test(name)) return 'symbol-operator';
    if (/^(name_get|name_search|default_get|fields_get|fields_view_get|read_group)$/.test(name)) return 'symbol-operator';
    if (/^_/.test(name)) return 'symbol-property';
    return 'symbol-method';
}

class MethodItem extends vscode.TreeItem {
    constructor(method) {
        super(method.name, vscode.TreeItemCollapsibleState.None);
        this.method = method;
        this.description = method.decorator ? `@${method.decorator.replace('@', '')}` : (method.params || '');
        this.tooltip = `${method.decorator ? method.decorator + '\n' : ''}def ${method.name}(${method.params})\n${method.filePath}:${method.line}`;
        this.contextValue = 'odooMethod';
        this.iconPath = new vscode.ThemeIcon(_methodIcon(method));
        this.command = { command: 'odooDebugger.modelExplorer.goto', title: 'Go to Method', arguments: [method.filePath, method.line] };
    }
}

class MethodsGroupItem extends vscode.TreeItem {
    constructor(methods, filePath) {
        super(`Methods (${methods.length})`, vscode.TreeItemCollapsibleState.Collapsed);
        this.methods = methods;
        this.filePath = filePath;
        this.contextValue = 'odooMethodsGroup';
        this.iconPath = new vscode.ThemeIcon('symbol-method');
    }
}

// ── Parser ─────────────────────────────────────────────────────────

function parseModelsFromFile(filePath) {
    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch (_) { return []; }
    const lines = content.split('\n');
    const results = [];
    let currentBlock = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^class\s+\w+/.test(line)) {
            if (currentBlock && currentBlock.name) results.push(currentBlock);
            // Detect model type from class parent
            let modelType = 'model';
            if (line.includes('TransientModel')) modelType = 'transient';
            else if (line.includes('AbstractModel')) modelType = 'abstract';
            currentBlock = { classLine: i + 1, name: null, isInherit: false, fields: [], modelType };
            continue;
        }
        if (!currentBlock) continue;
        const nameMatch = line.match(/^\s{4}_name\s*=\s*['"]([^'"]+)['"]/);
        if (nameMatch) { currentBlock.name = nameMatch[1]; currentBlock.isInherit = false; continue; }
        const inheritStr = line.match(/^\s{4}_inherit\s*=\s*['"]([^'"]+)['"]/);
        if (inheritStr && !currentBlock.name) { currentBlock.name = inheritStr[1]; currentBlock.isInherit = true; continue; }
        const inheritList = line.match(/^\s{4}_inherit\s*=\s*\[\s*['"]([^'"]+)['"]/);
        if (inheritList && !currentBlock.name) { currentBlock.name = inheritList[1]; currentBlock.isInherit = true; continue; }
        const fieldMatch = line.match(/^\s{4}(\w+)\s*=\s*fields\.(\w+)\s*\(/);
        if (fieldMatch && fieldMatch[1] !== '_name' && fieldMatch[1] !== '_inherit') {
            currentBlock.fields.push({ name: fieldMatch[1], type: fieldMatch[2], line: i + 1 });
        }
        // Track decorator on the line before def
        const decMatch = line.match(/^\s{4}(@(?:api\.\w+|staticmethod|classmethod)[^\n]*)/);
        if (decMatch) {
            if (!currentBlock._lastDecorator) currentBlock._lastDecorator = [];
            currentBlock._lastDecorator.push(decMatch[1].trim());
        }
        // Method definition: def method_name(self
        const methodMatch = line.match(/^\s{4}def\s+(\w+)\s*\(([^)]*)\)/);
        if (methodMatch) {
            const params = methodMatch[2].replace(/self,?\s*/, '').trim();
            const decorator = (currentBlock._lastDecorator || []).join(' ');
            currentBlock._lastDecorator = null;
            if (!currentBlock.methods) currentBlock.methods = [];
            currentBlock.methods.push({ name: methodMatch[1], params, decorator, line: i + 1 });
        } else if (!line.trim().startsWith('@') && line.trim()) {
            // Non-decorator, non-def line resets decorator accumulator
            currentBlock._lastDecorator = null;
        }
    }
    if (currentBlock && currentBlock.name) results.push(currentBlock);
    return results;
}

function _findPyFiles(dir) {
    const results = [];
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return results; }
    for (const e of entries) {
        if (e.name === '__pycache__') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) results.push(..._findPyFiles(full));
        else if (e.name.endsWith('.py') && e.name !== '__init__.py') results.push(full);
    }
    return results;
}

function scanModels(addonsDirs) {
    const modelMap = new Map();
    for (const addonsDir of addonsDirs) {
        if (!fs.existsSync(addonsDir)) continue;
        let modules;
        try { modules = fs.readdirSync(addonsDir, { withFileTypes: true }); } catch (_) { continue; }
        for (const mod of modules) {
            if (!mod.isDirectory() || mod.name.startsWith('.') || mod.name === '__pycache__') continue;
            const modPath = path.join(addonsDir, mod.name);
            if (!fs.existsSync(path.join(modPath, '__manifest__.py'))) continue;
            const modelsDir = path.join(modPath, 'models');
            if (!fs.existsSync(modelsDir)) continue;
            for (const pyFile of _findPyFiles(modelsDir)) {
                for (const parsed of parseModelsFromFile(pyFile)) {
                    const source = {
                        moduleName: mod.name,
                        filePath: pyFile,
                        line: parsed.classLine,
                        isInherit: parsed.isInherit,
                        modelType: parsed.modelType || 'model',
                        fields: parsed.fields.map(f => ({ ...f, filePath: pyFile })),
                        methods: (parsed.methods || []).map(m => ({ ...m, filePath: pyFile })),
                    };
                    if (!modelMap.has(parsed.name)) modelMap.set(parsed.name, []);
                    modelMap.get(parsed.name).push(source);
                }
            }
        }
    }
    return modelMap;
}

// ── Source picker ──────────────────────────────────────────────────

function _getSourceDirs() {
    const configured = utils.getConfig('modelExplorer.sources') || [];
    if (configured.length) return configured;
    // Default: custom addons + community (user can uncheck community in configureSources)
    const communityAddons = require('path').join(utils.getCommunityPath(), 'addons');
    const custom = utils.getCustomAddonsPaths();
    const dirs = [...custom];
    if (require('fs').existsSync(communityAddons) && !dirs.includes(communityAddons)) {
        dirs.push(communityAddons);
    }
    return dirs;
}

async function configureSources() {
    const communityAddons = path.join(utils.getCommunityPath(), 'addons');
    const allCustom = utils.discoverAllAddonsDirs();
    const current = _getSourceDirs();

    const items = [
        { label: '$(folder-opened) Browse for folder...', _browse: true },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: 'community/addons', description: communityAddons, detail: '⚠ Large — slow to scan', picked: current.includes(communityAddons) },
        ...allCustom.map(dir => ({ label: path.basename(dir), description: dir, picked: current.includes(dir) })),
        ...current
            .filter(p => p !== communityAddons && !allCustom.includes(p))
            .map(p => ({ label: path.basename(p), description: p, picked: true, detail: '(custom)' })),
    ];

    const picks = await vscode.window.showQuickPick(items, {
        title: 'Model Explorer — Select Addons Dirs to Scan',
        placeHolder: 'Check directories to include',
        canPickMany: true,
    });
    if (!picks) return;

    let selected = picks.filter(p => !p._browse && p.description).map(p => p.description);
    if (picks.some(p => p._browse)) {
        const uris = await vscode.window.showOpenDialog({
            title: 'Select Addons Directory',
            canSelectFiles: false, canSelectFolders: true, canSelectMany: true,
        });
        if (uris) selected.push(...uris.map(u => u.fsPath));
    }

    selected = [...new Set(selected)];
    await vscode.workspace.getConfiguration('odooDebugger').update('modelExplorer.sources', selected, vscode.ConfigurationTarget.Workspace);
    vscode.window.showInformationMessage(`Model Explorer sources updated (${selected.length} dirs). Refreshing...`);
    return selected;
}

// ── Tree Data Provider ─────────────────────────────────────────────

class ModelExplorerProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this._cache = null;
        this._filter = '';
        this._typeFilter = 'all'; // 'all' | 'model' | 'transient' | 'abstract'
        this._treeView = null;
        this._revealTimer = null;
        this._itemCache = new Map(); // key -> TreeItem instance for reveal()
    }

    setTreeView(tv) { this._treeView = tv; }

    refresh() {
        this._cache = null;
        this._itemCache.clear();
        this._onDidChangeTreeData.fire();
        this._updateViewDescription();
    }

    setFilter(text) {
        this._filter = text.trim().toLowerCase();
        vscode.commands.executeCommand('setContext', CTX_FILTER_ACTIVE, this._filter.length > 0);
        this._onDidChangeTreeData.fire();
        this._updateViewDescription();
    }

    clearFilter() { this.setFilter(''); }

    setTypeFilter(type) {
        this._typeFilter = type;
        this._onDidChangeTreeData.fire();
        this._updateViewDescription();
    }

    _updateViewDescription() {
        if (!this._treeView) return;
        if (this._filter) {
            const count = this._getFilteredModels().length;
            this._treeView.description = `"${this._filter}" · ${count} model${count !== 1 ? 's' : ''}`;
        } else {
            const total = this._getCache().size;
            this._treeView.description = `${total} model${total !== 1 ? 's' : ''}`;
        }
    }

    getTreeItem(element) { return element; }

    getChildren(element) {
        if (element instanceof ModelItem) {
            if (element.sources.length === 1) return this._fieldsForSource(element.sources[0], element.modelName);
            return element.sources.map(s => {
                const item = new SourceItem(s);
                this._itemCache.set(`source:${s.filePath}`, item);
                return item;
            });
        }
        if (element instanceof SourceItem) return this._fieldsForSource(element.source, null);
        if (element instanceof MethodsGroupItem) {
            return element.methods.map(m => {
                const item = new MethodItem(m);
                this._itemCache.set(`method:${m.filePath}:${m.line}`, item);
                return item;
            });
        }
        return this._getRootItems();
    }

    _fieldsForSource(source, modelName) {
        const items = [];
        if (source.fields.length) {
            source.fields.forEach(f => {
                const item = new FieldItem(f);
                this._itemCache.set(`field:${f.filePath}:${f.line}`, item);
                items.push(item);
            });
        } else {
            const empty = new vscode.TreeItem('No fields');
            empty.iconPath = new vscode.ThemeIcon('dash');
            items.push(empty);
        }
        if (source.methods && source.methods.length) {
            const groupItem = new MethodsGroupItem(source.methods, source.filePath);
            this._itemCache.set(`methodsGroup:${source.filePath}`, groupItem);
            items.push(groupItem);
        }
        return items;
    }

    _getRootItems() {
        const models = this._getFilteredModels();
        if (!models.length) {
            const item = new vscode.TreeItem(this._filter ? `No models match "${this._filter}"` : 'No models found');
            item.iconPath = new vscode.ThemeIcon('info');
            return [item];
        }
        return models.map(([name, sources]) => {
            const item = new ModelItem(name, sources);
            this._itemCache.set(`model:${name}`, item);
            return item;
        });
    }

    _getFilteredModels() {
        const map = this._getCache();
        const filter = this._filter;
        const typeFilter = this._typeFilter;
        let entries = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        if (filter) {
            entries = entries.filter(([name, sources]) =>
                name.includes(filter) || sources.some(s => s.moduleName.toLowerCase().includes(filter))
            );
        }
        if (typeFilter !== 'all') {
            entries = entries.filter(([, sources]) =>
                sources.some(s => s.modelType === typeFilter)
            );
        }
        return entries;
    }

    _getCache() {
        if (!this._cache) {
            this._cache = scanModels(_getSourceDirs());
            this._updateViewDescription();
        }
        return this._cache;
    }

    // ── Cursor auto-reveal ─────────────────────────────────────────

    onCursorMove(editor) {
        if (!this._treeView || !this._treeView.visible) return;
        if (!editor) return;
        const filePath = editor.document.uri.fsPath;
        const cursorLine = editor.selection.active.line + 1; // 1-based

        // Debounce
        if (this._revealTimer) clearTimeout(this._revealTimer);
        this._revealTimer = setTimeout(() => this._doReveal(filePath, cursorLine), 300);
    }

    _doReveal(filePath, cursorLine) {
        const cache = this._getCache();

        if (filePath.endsWith('.py')) {
            this._revealFromPython(filePath, cursorLine, cache);
        } else if (filePath.endsWith('.xml')) {
            this._revealFromXml(filePath, cursorLine, cache);
        }
    }

    _revealFromPython(filePath, cursorLine, cache) {
        for (const [modelName, sources] of cache) {
            for (const source of sources) {
                if (source.filePath !== filePath) continue;

                // Check field line
                const field = source.fields.find(f => f.line === cursorLine);
                if (field) {
                    const item = this._itemCache.get(`field:${filePath}:${field.line}`);
                    if (item) this._treeView.reveal(item, { select: true, focus: false, expand: true }).then(null, () => {});
                    return;
                }

                // Check method line
                const method = (source.methods || []).find(m => m.line === cursorLine);
                if (method) {
                    const item = this._itemCache.get(`method:${filePath}:${method.line}`);
                    if (item) this._treeView.reveal(item, { select: true, focus: false, expand: true }).then(null, () => {});
                    return;
                }

                // Reveal model or source
                if (sources.length > 1) {
                    const item = this._itemCache.get(`source:${filePath}`);
                    if (item) this._treeView.reveal(item, { select: true, focus: false, expand: false }).then(null, () => {});
                } else {
                    const item = this._itemCache.get(`model:${modelName}`);
                    if (item) this._treeView.reveal(item, { select: true, focus: false, expand: false }).then(null, () => {});
                }
                return;
            }
        }
    }

    _revealFromXml(filePath, cursorLine, cache) {
        // Read lines up to cursor to find nearest <record model="...">
        let content;
        try { content = fs.readFileSync(filePath, 'utf8'); } catch (_) { return; }
        const lines = content.split('\n');

        for (let i = cursorLine - 1; i >= 0; i--) {
            const modelMatch = lines[i].match(/model="([^"]+)"/);
            if (modelMatch) {
                const modelName = modelMatch[1];
                if (cache.has(modelName)) {
                    const sources = cache.get(modelName);
                    const modelItem = new ModelItem(modelName, sources);
                    this._treeView.reveal(modelItem, { select: true, focus: false, expand: false }).then(null, () => {});
                }
                return;
            }
            // Stop searching back if we hit another record close tag
            if (lines[i].includes('</record>') && i < cursorLine - 1) return;
        }
    }
}

// ── Navigation commands ────────────────────────────────────────────

async function gotoLocation(filePath, lineNumber) {
    try {
        const doc = await vscode.workspace.openTextDocument(filePath);
        const editor = await vscode.window.showTextDocument(doc);
        const pos = new vscode.Position(Math.max(0, lineNumber - 1), 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    } catch (e) {
        vscode.window.showErrorMessage(`Cannot open file: ${e.message}`);
    }
}

async function openModelInBrowser(item) {
    const modelName = item instanceof ModelItem ? item.modelName : null;
    if (!modelName) return;
    vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${utils.getPort()}/odoo?debug=1#model=${modelName}&view_type=list`));
}

// ── XML search helpers ─────────────────────────────────────────────

/** Find all XML files in a directory recursively. viewsOnly=true skips data/demo/security dirs */
function _findXmlFiles(dir, viewsOnly = false) {
    const results = [];
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return results; }
    const skipDirs = new Set(['data', 'demo', 'security', 'tests', 'migrations', 'static', 'i18n']);
    for (const e of entries) {
        if (e.name.startsWith('.') || e.name === '__pycache__') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (viewsOnly && skipDirs.has(e.name)) continue;
            results.push(..._findXmlFiles(full, viewsOnly));
        } else if (e.name.endsWith('.xml')) {
            results.push(full);
        }
    }
    return results;
}

/**
 * Search XML files for a pattern, return matches:
 * [{ filePath, line, lineText, recordId }]
 */
function _searchXmlFiles(xmlFiles, pattern, onlyInViews = false) {
    const results = [];
    for (const xmlFile of xmlFiles) {
        let content;
        try { content = fs.readFileSync(xmlFile, 'utf8'); } catch (_) { continue; }
        const lines = content.split('\n');
        let currentRecordId = '';
        let insideUiView = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Track record open: <record id="..." model="...">
            if (line.includes('<record')) {
                const idMatch = line.match(/id="([^"]+)"/);
                if (idMatch) currentRecordId = idMatch[1];
                insideUiView = line.includes('model="ir.ui.view"');
            }
            if (line.includes('</record>')) {
                insideUiView = false;
            }
            // Skip if we only want ir.ui.view records and we're not in one
            if (onlyInViews && !insideUiView) continue;
            if (pattern.test(line)) {
                results.push({
                    filePath: xmlFile,
                    line: i + 1,
                    lineText: line.trim(),
                    recordId: currentRecordId,
                });
            }
        }
    }
    return results;
}

/** Get module root from a file path */
function _getModuleRoot(filePath) {
    return utils.detectModuleFromFile(filePath)?.path || null;
}

/** Build QuickPick items from XML search results */
function _buildXmlPickItems(results, label) {
    return results.map(r => ({
        label: r.recordId ? `$(symbol-misc) ${r.recordId}` : `$(file-code) line ${r.line}`,
        description: `${path.basename(r.filePath)}:${r.line}`,
        detail: r.lineText.substring(0, 120),
        filePath: r.filePath,
        line: r.line,
        _group: label,
    }));
}

// ── Model → XML navigation ─────────────────────────────────────────

async function gotoXmlView(item) {
    const modelName = item instanceof ModelItem ? item.modelName : null;
    if (!modelName) return;

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Searching XML for model "${modelName}"...`, cancellable: false },
        async () => {
            const allResults = [];

            // Same-module first
            const sources = item.sources || [];
            const moduleRoots = [...new Set(sources.map(s => _getModuleRoot(s.filePath)).filter(Boolean))];
            // Search for <field name="model">modelName</field> — only inside ir.ui.view records
            const viewPattern = new RegExp(`<field\\s[^>]*name="model"[^>]*>${modelName.replace('.', '\\.')}<`);
            const sameModuleXmls = moduleRoots.flatMap(r => _findXmlFiles(r, true));
            const sameModuleResults = _searchXmlFiles(sameModuleXmls, viewPattern);

            // All addons — views only
            const allAddonsDirs = _getSourceDirs();
            const allXmls = allAddonsDirs.flatMap(d => {
                if (!fs.existsSync(d)) return [];
                let mods;
                try { mods = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return []; }
                return mods
                    .filter(m => m.isDirectory() && !m.name.startsWith('.'))
                    .flatMap(m => _findXmlFiles(path.join(d, m.name), true));
            });
            const allResults2 = _searchXmlFiles(allXmls, viewPattern);

            // Deduplicate: remove same-module results from allResults2
            const sameModulePaths = new Set(sameModuleResults.map(r => `${r.filePath}:${r.line}`));
            const otherResults = allResults2.filter(r => !sameModulePaths.has(`${r.filePath}:${r.line}`));

            const items = [];
            if (sameModuleResults.length) {
                items.push({ label: '── Same Module ──', kind: vscode.QuickPickItemKind.Separator });
                items.push(..._buildXmlPickItems(sameModuleResults, 'same'));
            }
            if (otherResults.length) {
                items.push({ label: '── Other Addons ──', kind: vscode.QuickPickItemKind.Separator });
                items.push(..._buildXmlPickItems(otherResults, 'other'));
            }

            if (!items.length) {
                vscode.window.showInformationMessage(`No XML views found for model "${modelName}".`);
                return;
            }

            const pick = await vscode.window.showQuickPick(items, {
                title: `XML views for ${modelName}`,
                matchOnDescription: true,
                matchOnDetail: true,
            });
            if (pick && pick.filePath) await gotoLocation(pick.filePath, pick.line);
        }
    );
}

// ── Field → XML navigation ─────────────────────────────────────────

async function gotoFieldXml(item) {
    if (!(item instanceof FieldItem)) return;
    const fieldName = item.field.name;
    const filePath = item.field.filePath;

    // Find the model this field belongs to (look up in cache via filePath+line)
    // We pass modelName via item if available — but FieldItem doesn't store it
    // So we detect module root from filePath
    const moduleRoot = _getModuleRoot(filePath);

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Searching XML for field "${fieldName}"...`, cancellable: false },
        async () => {
            // Only match <field name="fieldName" — view field tags, not data record attributes
            const pattern = new RegExp(`<field\\s[^>]*name="${fieldName}"`);
            const viewsOnly = true;

            // Same-module XMLs
            const sameModuleXmls = moduleRoot ? _findXmlFiles(moduleRoot, viewsOnly) : [];
            const sameModuleResults = _searchXmlFiles(sameModuleXmls, pattern, true);

            // All addons XMLs
            const allAddonsDirs = _getSourceDirs();
            const allXmls = allAddonsDirs.flatMap(d => {
                if (!fs.existsSync(d)) return [];
                let mods;
                try { mods = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return []; }
                return mods
                    .filter(m => m.isDirectory() && !m.name.startsWith('.'))
                    .flatMap(m => _findXmlFiles(path.join(d, m.name), viewsOnly));
            });
            const allResults = _searchXmlFiles(allXmls, pattern, true);

            const sameModulePaths = new Set(sameModuleResults.map(r => `${r.filePath}:${r.line}`));
            const otherResults = allResults.filter(r => !sameModulePaths.has(`${r.filePath}:${r.line}`));

            const items = [];
            if (sameModuleResults.length) {
                items.push({ label: '── Same Module ──', kind: vscode.QuickPickItemKind.Separator });
                items.push(..._buildXmlPickItems(sameModuleResults, 'same'));
            }
            if (otherResults.length) {
                items.push({ label: '── Other Addons ──', kind: vscode.QuickPickItemKind.Separator });
                items.push(..._buildXmlPickItems(otherResults, 'other'));
            }

            if (!items.length) {
                vscode.window.showInformationMessage(`No XML usages found for field "${fieldName}".`);
                return;
            }

            const pick = await vscode.window.showQuickPick(items, {
                title: `XML usages of field "${fieldName}"`,
                matchOnDescription: true,
                matchOnDetail: true,
            });
            if (pick && pick.filePath) await gotoLocation(pick.filePath, pick.line);
        }
    );
}

// ── XML Document Symbols (Outline) ────────────────────────────────

class OdooXmlSymbolProvider {
    provideDocumentSymbols(document) {
        const symbols = [];
        const text = document.getText();
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Match <record id="..." model="...">
            const recMatch = line.match(/<record[^>]+id="([^"]+)"[^>]*model="([^"]+)"/);
            if (recMatch) {
                const pos = new vscode.Position(i, 0);
                const sym = new vscode.DocumentSymbol(
                    recMatch[1],
                    recMatch[2],
                    vscode.SymbolKind.Class,
                    new vscode.Range(pos, pos),
                    new vscode.Range(pos, pos)
                );
                symbols.push(sym);
                continue;
            }
            // Match <template id="...">
            const tmplMatch = line.match(/<template[^>]+id="([^"]+)"/);
            if (tmplMatch) {
                const pos = new vscode.Position(i, 0);
                symbols.push(new vscode.DocumentSymbol(
                    tmplMatch[1], 'template',
                    vscode.SymbolKind.Module,
                    new vscode.Range(pos, pos),
                    new vscode.Range(pos, pos)
                ));
                continue;
            }
            // Match <menuitem id="...">
            const menuMatch = line.match(/<menuitem[^>]+id="([^"]+)"/);
            if (menuMatch) {
                const pos = new vscode.Position(i, 0);
                symbols.push(new vscode.DocumentSymbol(
                    menuMatch[1], 'menuitem',
                    vscode.SymbolKind.Enum,
                    new vscode.Range(pos, pos),
                    new vscode.Range(pos, pos)
                ));
            }
        }
        return symbols;
    }
}

// ── XML Hover ─────────────────────────────────────────────────────

class OdooXmlHoverProvider {
    constructor(explorerProvider) {
        this._explorer = explorerProvider;
    }

    provideHover(document, position) {
        const line = document.lineAt(position).text;

        // Hover on ref="module.xml_id"
        const refMatch = line.match(/ref="([^"]+)"/);
        if (refMatch) {
            const xmlId = refMatch[1];
            const md = new vscode.MarkdownString(`**XML ID:** \`${xmlId}\`\n\nRight-click → Go to XML ID, or use \`Ctrl+Shift+X\``);
            return new vscode.Hover(md);
        }

        // Hover on model="res.partner"
        const modelMatch = line.match(/model="([^"]+)"/);
        if (modelMatch) {
            const modelName = modelMatch[1];
            const cache = this._explorer._getCache();
            if (cache.has(modelName)) {
                const sources = cache.get(modelName);
                const lines = sources.map(s => `- \`${s.moduleName}\` (${s.isInherit ? 'inherit' : 'defined'})`).join('\n');
                const md = new vscode.MarkdownString(`**Model:** \`${modelName}\`\n\n${lines}`);
                return new vscode.Hover(md);
            }
            return new vscode.Hover(new vscode.MarkdownString(`**Model:** \`${modelName}\``));
        }

        // Hover on inherit_id ref
        const inheritMatch = line.match(/name="inherit_id"[^>]*ref="([^"]+)"/);
        if (inheritMatch) {
            const md = new vscode.MarkdownString(`**Inherits view:** \`${inheritMatch[1]}\`\n\nUse \`Ctrl+Shift+X\` to navigate`);
            return new vscode.Hover(md);
        }

        return null;
    }
}

// ── Search / filter ────────────────────────────────────────────────

async function searchModels(provider) {
    const input = await vscode.window.showInputBox({
        title: 'Filter Models',
        placeHolder: 'e.g. res.partner or sale',
        prompt: 'Filter by model name or module name (substring match)',
        value: provider._filter,
    });
    if (input === undefined) return;
    provider.setFilter(input);
}

async function findMethodUsages(item) {
    if (!item || !item.method) return;
    const methodName = item.method.name;
    const root = utils.getWorkspaceRoot();
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Finding usages of "${methodName}"...`, cancellable: false },
        async () => {
            try {
                const { execSync } = require('child_process');
                const out = execSync(
                    `grep -rn --include='*.py' -E '\.(${methodName})\s*\(' '${root}'`,
                    { encoding: 'utf8', timeout: 15000 }
                );
                const lines = out.trim().split('\n').filter(Boolean);
                if (!lines.length) {
                    vscode.window.showInformationMessage(`No usages of "${methodName}" found.`);
                    return;
                }
                const items = lines.map(l => {
                    const [file, lineNum, ...rest] = l.split(':');
                    return {
                        label: `$(file-code) ${path.basename(file)}:${lineNum}`,
                        description: rest.join(':').trim().substring(0, 100),
                        detail: file,
                        filePath: file,
                        line: parseInt(lineNum, 10),
                    };
                });
                const pick = await vscode.window.showQuickPick(items, {
                    title: `Usages of .${methodName}() — ${items.length} found`,
                    matchOnDescription: true,
                });
                if (pick) await gotoLocation(pick.filePath, pick.line);
            } catch (_) {
                vscode.window.showInformationMessage(`No usages of "${methodName}" found.`);
            }
        }
    );
}

async function filterModelType(provider) {
    const items = [
        { label: '$(symbol-class) All Models', type: 'all', description: 'Show everything' },
        { label: '$(symbol-class) Regular Models', type: 'model', description: 'models.Model' },
        { label: '$(symbol-interface) Transient Models', type: 'transient', description: 'models.TransientModel (wizards)' },
        { label: '$(symbol-namespace) Abstract Models', type: 'abstract', description: 'models.AbstractModel' },
    ];
    const current = provider._typeFilter;
    const pick = await vscode.window.showQuickPick(
        items.map(i => ({ ...i, picked: i.type === current })),
        { title: 'Filter by Model Type' }
    );
    if (pick) provider.setTypeFilter(pick.type);
}

module.exports = {
    ModelExplorerProvider, FieldItem, ModelItem, SourceItem,
    OdooXmlSymbolProvider, OdooXmlHoverProvider,
    gotoLocation, openModelInBrowser, gotoXmlView, gotoFieldXml, findMethodUsages,
    searchModels, configureSources, filterModelType,
    CTX_FILTER_ACTIVE,
};
