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

class FieldsGroupItem extends vscode.TreeItem {
    constructor(fields) {
        super(`Fields (${fields.length})`, vscode.TreeItemCollapsibleState.Collapsed);
        this.fields = fields;
        this.contextValue = 'odooFieldsGroup';
        this.iconPath = new vscode.ThemeIcon('symbol-field');
    }
}

class MethodsGroupItem extends vscode.TreeItem {
    constructor(methods, filePath) {
        super(`Functions (${methods.length})`, vscode.TreeItemCollapsibleState.Collapsed);
        this.methods = methods;
        this.filePath = filePath;
        this.contextValue = 'odooMethodsGroup';
        this.iconPath = new vscode.ThemeIcon('symbol-method');
    }
}

// ── View items ─────────────────────────────────────────────────────

const _VIEW_ICONS = {
    form: 'symbol-class', tree: 'list-tree', list: 'list-tree',
    search: 'search', kanban: 'layout', pivot: 'table',
    graph: 'pulse', calendar: 'calendar', activity: 'tasklist',
    qweb: 'code', cohort: 'graph-line', map: 'location',
};

class ViewsFolderItem extends vscode.TreeItem {
    constructor(modelName, addonsDirs) {
        super('Views', vscode.TreeItemCollapsibleState.Collapsed);
        this.modelName = modelName;
        this.addonsDirs = addonsDirs;
        this.contextValue = 'odooViewsFolder';
        this.iconPath = new vscode.ThemeIcon('file-code');
    }
}

class ViewItem extends vscode.TreeItem {
    constructor(view, children = []) {
        const label = view.xmlId || view.name || 'unknown';
        const state = children.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;
        super(label, state);
        this.view = view;
        this.viewChildren = children;
        this.description = `[${view.module}]`;
        this.contextValue = 'odooView';
        if (view._stub) {
            this.tooltip = `External view (not in scanned addons)\n${view.fullXmlId}`;
            this.iconPath = new vscode.ThemeIcon(_VIEW_ICONS[view.viewType] || 'link-external');
        } else {
            this.tooltip = `${view.viewType || 'inherit'} view\n${view.filePath}:${view.line}`;
            this.iconPath = new vscode.ThemeIcon(_VIEW_ICONS[view.viewType] || 'file-code');
            this.command = { command: 'odooDebugger.modelExplorer.goto', title: 'Go to View', arguments: [view.filePath, view.line] };
        }
    }
}

// ── Parser ─────────────────────────────────────────────────────────

// -- View scanner --

function _scanViewsForModel(modelName, addonsDirs) {
    const views = [];
    for (const addonsDir of addonsDirs) {
        if (!fs.existsSync(addonsDir)) continue;
        const xmlFiles = _findXmlFiles(addonsDir, true);
        for (const filePath of xmlFiles) {
            try {
                const content = fs.readFileSync(filePath, "utf8");
                const lines = content.split("\n");
                let i = 0;
                while (i < lines.length) {
                    const line = lines[i];
                    if (!line.includes("ir.ui.view")) { i++; continue; }
                    if (!/<record[^>]+model=["\x27]ir\.ui\.view["\x27]/.test(line)) { i++; continue; }
                    const idM = line.match(/\bid=["\x27]([^"\x27]+)["\x27]/);
                    const xmlId = idM ? idM[1] : "";
                    const recLine = i + 1;
                    let modelVal = "", inheritRef = "", viewType = "", name = "";
                    let j = i;
                    while (j < lines.length && j < i + 60) {
                        const l = lines[j];
                        const mM = l.match(/<field[^>]+name=["\x27]model["\x27][^>]*>([^<]+)</);
                        if (mM) modelVal = mM[1].trim();
                        const nM = l.match(/<field[^>]+name=["\x27]name["\x27][^>]*>([^<]+)</);
                        if (nM) name = nM[1].trim();
                        const iM = l.match(/<field[^>]+name=["\x27]inherit_id["\x27][^>]+ref=["\x27]([^"\x27]+)["\x27]/);
                        if (iM) inheritRef = iM[1];
                        const aM = l.match(/<(form|tree|list|search|kanban|pivot|graph|calendar|activity|qweb)[\s>]/);
                        if (aM && !viewType) viewType = aM[1];
                        const tM = l.match(/<field[^>]+name=["\x27]type["\x27][^>]*>([^<]+)</);
                        if (tM && !viewType) viewType = tM[1].trim();
                        if (l.includes("</record>")) break;
                        j++;
                    }
                    i = j + 1;
                    if (!modelVal || modelVal !== modelName) continue;
                    const parts = filePath.replace(addonsDir + path.sep, "").split(path.sep);
                    const module = parts[0] || "";
                    const displayId = xmlId.includes(".") ? xmlId.split(".").slice(1).join(".") : xmlId;
                    views.push({ xmlId: displayId, fullXmlId: xmlId, name, modelName, inheritRef, viewType, module, filePath, line: recLine });
                }
            } catch (_) {}
        }
    }
    return views;
}

function _buildViewTree(views) {
    const byId = new Map();
    for (const v of views) {
        byId.set(v.xmlId, v);
        if (v.fullXmlId) byId.set(v.fullXmlId, v);
    }
    const roots = [], childrenMap = new Map();
    const stubs = new Map();
    for (const v of views) {
        if (!v.inheritRef) {
            roots.push(v);
        } else {
            const pk = v.inheritRef.includes(".") ? v.inheritRef.split(".").slice(1).join(".") : v.inheritRef;
            const parent = byId.get(pk) || byId.get(v.inheritRef);
            if (parent) {
                // inherit child's viewType from parent if not detected
                if (!v.viewType && parent.viewType) v.viewType = parent.viewType;
                if (!childrenMap.has(parent.xmlId)) childrenMap.set(parent.xmlId, []);
                childrenMap.get(parent.xmlId).push(v);
            } else {
                const stubKey = v.inheritRef;
                if (!stubs.has(stubKey)) {
                    const stub = { xmlId: pk, fullXmlId: v.inheritRef, name: v.inheritRef, modelName: v.modelName, inheritRef: '', viewType: v.viewType, module: v.inheritRef.split('.')[0] || '', filePath: null, line: null, _stub: true };
                    stubs.set(stubKey, stub);
                    roots.push(stub);
                }
                const stub = stubs.get(stubKey);
                if (!v.viewType && stub.viewType) v.viewType = stub.viewType;
                if (!childrenMap.has(stub.xmlId)) childrenMap.set(stub.xmlId, []);
                childrenMap.get(stub.xmlId).push(v);
            }
        }
    }
    return { roots, childrenMap };
}

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
    return utils.getCustomAddonsPaths();
}

async function configureSources() {
    const allCustom = utils.discoverAllAddonsDirs();
    const current = _getSourceDirs();

    const items = [
        { label: '$(folder-opened) Browse for folder...', _browse: true },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        ...allCustom.map(dir => ({ label: path.basename(dir), description: dir, picked: current.includes(dir) })),
        ...current
            .filter(p => !allCustom.includes(p))
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
    constructor(indexMgr) {
        this._indexMgr = indexMgr || null;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this._cache = null;
        this._filter = '';
        this._typeFilter = utils.getConfig('modelExplorer.typeFilter') || 'model';
        this._sortOrder = utils.getConfig('modelExplorer.sortOrder') || 'alpha';
        this._groupByModule = utils.getConfig('modelExplorer.groupByModule') !== false;
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
        vscode.workspace.getConfiguration('odooDebugger').update('modelExplorer.typeFilter', type, 1);
        this._onDidChangeTreeData.fire();
        this._updateViewDescription();
    }

    setSortOrder(order) {
        this._sortOrder = order;
        vscode.workspace.getConfiguration('odooDebugger').update('modelExplorer.sortOrder', order, 1);
        this._itemCache.clear();
        this._onDidChangeTreeData.fire();
        this._updateViewDescription();
    }

    setGroupByModule(val) {
        this._groupByModule = val;
        vscode.workspace.getConfiguration('odooDebugger').update('modelExplorer.groupByModule', val, 1); // Workspace
        this._itemCache.clear();
        this._onDidChangeTreeData.fire();
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

    getParent(element) { return element._parent || null; }

    getChildren(element) {
        if (element instanceof ModelItem) {
            if (element.sources.length === 1 || !this._groupByModule) {
                if (!this._groupByModule && element.sources.length > 1) {
                    return this._fieldsForSources(element.sources, element.modelName, element);
                }
                return this._fieldsForSource(element.sources[0], element.modelName, element);
            }
            const { fieldQ: fq2, methodQ: mq2 } = _parseQuery(this._filter || '');
            const fieldQ2 = fq2 !== undefined ? fq2 : null;
            const methodQ2 = mq2 !== undefined ? mq2 : null;
            return element.sources.filter(s => {
                if (fieldQ2 !== null && fieldQ2) return s.fields.some(f => f.name.toLowerCase().startsWith(fieldQ2));
                if (methodQ2 !== null && methodQ2) return (s.methods || []).some(m => m.name.toLowerCase().startsWith(methodQ2));
                return true;
            }).map(s => {
                const item = new SourceItem(s);
                item._parent = element;
                item.source._modelName = element.modelName;
                this._itemCache.set(`source:${s.filePath}`, item);
                return item;
            });
        }
        if (element instanceof SourceItem) return this._fieldsForSource(element.source, element.source._modelName || null, element);
        if (element instanceof FieldsGroupItem) {
            return element.fields.map(f => {
                const item = new FieldItem(f);
                item._parent = element;
                this._itemCache.set(`field:${f.filePath}:${f.line}`, item);
                return item;
            });
        }
        if (element instanceof MethodsGroupItem) {
            return element.methods.map(m => {
                const item = new MethodItem(m);
                item._parent = element;
                this._itemCache.set(`method:${m.filePath}:${m.line}`, item);
                return item;
            });
        }
        if (element instanceof ViewsFolderItem) {
            const views = _scanViewsForModel(element.modelName, element.addonsDirs);
            element.label = `Views (${views.length})`;
            if (!views.length) return [];
            const { roots, childrenMap } = _buildViewTree(views);
            const makeViewItem = (v, parent) => {
                const children = childrenMap.get(v.xmlId) || [];
                const item = new ViewItem(v, children);
                item._parent = parent;
                item._childrenMap = childrenMap;
                this._itemCache.set(`view:${v.fullXmlId || v.xmlId}`, item);
                return item;
            };
            return roots.map(v => makeViewItem(v, element));
        }
        if (element instanceof ViewItem) {
            return (element.viewChildren || []).map(v => {
                if (!v.viewType && element.view && element.view.viewType) v.viewType = element.view.viewType;
                const children = (element._childrenMap || new Map()).get(v.xmlId) || [];
                const item = new ViewItem(v, children);
                item._parent = element;
                item._childrenMap = element._childrenMap;
                this._itemCache.set(`view:${v.fullXmlId || v.xmlId}`, item);
                return item;
            });
        }
        return this._getRootItems();
    }

    _fieldsForSource(source, modelName, parentElement) {
        const items = [];
        const activeFilter = this._filter || '';
        const { fieldQ: fq, methodQ: mq } = _parseQuery(activeFilter);
        const fieldQ = fq !== undefined ? fq : null;
        const methodQ = mq !== undefined ? mq : null;

        if (fieldQ !== null) {
            const fields = fieldQ ? source.fields.filter(f => f.name.toLowerCase().startsWith(fieldQ)) : source.fields;
            fields.forEach(f => {
                const item = new FieldItem(f);
                item._parent = parentElement;
                this._itemCache.set(`field:${f.filePath}:${f.line}`, item);
                items.push(item);
            });
            return items;
        }
        if (methodQ !== null) {
            const methods = methodQ ? (source.methods || []).filter(m => m.name.toLowerCase().startsWith(methodQ)) : (source.methods || []);
            methods.forEach(m => {
                const item = new MethodItem(m);
                item._parent = parentElement;
                this._itemCache.set(`method:${m.filePath}:${m.line}`, item);
                items.push(item);
            });
            return items;
        }
        if (source.fields.length) {
            const groupItem = new FieldsGroupItem(source.fields);
            groupItem._parent = parentElement;
            this._itemCache.set(`fieldsGroup:${source.filePath}`, groupItem);
            items.push(groupItem);
        }
        if ((source.methods || []).length) {
            const groupItem = new MethodsGroupItem(source.methods, source.filePath);
            groupItem._parent = parentElement;
            this._itemCache.set(`methodsGroup:${source.filePath}`, groupItem);
            items.push(groupItem);
        }
        if (utils.getConfig('modelExplorer.showViews') !== false) {
            const vf = new ViewsFolderItem(modelName || source.moduleName, _getSourceDirs());
            vf._parent = parentElement;
            items.push(vf);
        }
        return items;
    }

    _fieldsForSources(sources, modelName, parentElement) {
        const items = [];
        const activeFilter = this._filter || '';
        const { fieldQ: fq, methodQ: mq } = _parseQuery(activeFilter);
        const fieldQ = fq !== undefined ? fq : null;
        const methodQ = mq !== undefined ? mq : null;
        const allFields = sources.flatMap(s => s.fields);
        const allMethods = sources.flatMap(s => s.methods || []);

        if (fieldQ !== null) {
            const fields = fieldQ ? allFields.filter(f => f.name.toLowerCase().startsWith(fieldQ)) : allFields;
            fields.forEach(f => {
                const item = new FieldItem(f);
                item._parent = parentElement;
                this._itemCache.set(`field:${f.filePath}:${f.line}`, item);
                items.push(item);
            });
            return items;
        }
        if (methodQ !== null) {
            const methods = methodQ ? allMethods.filter(m => m.name.toLowerCase().startsWith(methodQ)) : allMethods;
            methods.forEach(m => {
                const item = new MethodItem(m);
                item._parent = parentElement;
                this._itemCache.set(`method:${m.filePath}:${m.line}`, item);
                items.push(item);
            });
            return items;
        }
        if (allFields.length) {
            const groupItem = new FieldsGroupItem(allFields);
            groupItem._parent = parentElement;
            this._itemCache.set(`fieldsGroup:${sources[0].filePath}`, groupItem);
            items.push(groupItem);
        }
        if (allMethods.length) {
            const groupItem = new MethodsGroupItem(allMethods, sources[0].filePath);
            groupItem._parent = parentElement;
            this._itemCache.set(`methodsGroup:${sources[0].filePath}`, groupItem);
            items.push(groupItem);
        }
        if (utils.getConfig('modelExplorer.showViews') !== false) {
            const vf = new ViewsFolderItem(modelName, _getSourceDirs());
            vf._parent = parentElement;
            items.push(vf);
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
            item._parent = null;
            this._itemCache.set(`model:${name}`, item);
            return item;
        });
    }

    _getFilteredModels() {
        const map = this._getCache();
        const filter = this._filter;
        const typeFilter = this._typeFilter;
        let entries = [...map.entries()];

        if (filter) {
            const { modelQ, fieldQ, methodQ, moduleQ } = _parseQuery(filter);
            // Filter by model name
            if (modelQ) entries = entries.filter(([name]) => _matchesModel(name, modelQ));
            // Filter by module
            if (moduleQ) entries = entries.filter(([, sources]) =>
                sources.some(s => s.moduleName.toLowerCase().includes(moduleQ))
            );
            // Filter by field presence (fieldQ='' means show all fields of matched models)
            if (fieldQ !== undefined) {
                if (fieldQ) entries = entries.filter(([, sources]) =>
                    sources.some(s => s.fields.some(f => f.name.toLowerCase().startsWith(fieldQ)))
                );
                // fieldQ='' with modelQ: keep all matched models (show all their fields)
            }
            // Filter by method presence
            if (methodQ !== undefined) {
                if (methodQ) entries = entries.filter(([, sources]) =>
                    sources.some(s => (s.methods || []).some(m => m.name.toLowerCase().startsWith(methodQ)))
                );
            }
            // Plain model search (no field/method/module qualifier)
            if (!modelQ && !moduleQ && fieldQ === undefined && methodQ === undefined) {
                entries = entries.filter(([name, sources]) =>
                    _matchesModel(name, filter) || sources.some(s => s.moduleName.toLowerCase().includes(filter))
                );
            }
        }
        if (typeFilter !== 'all') {
            entries = entries.filter(([, sources]) =>
                sources.some(s => s.modelType === typeFilter)
            );
        }

        if (this._sortOrder === 'recent') {
            // Sort by most recently modified source file
            const fs = require('fs');
            entries.sort((a, b) => {
                const mtimeA = Math.max(...a[1].map(s => { try { return fs.statSync(s.filePath).mtimeMs; } catch(_) { return 0; } }));
                const mtimeB = Math.max(...b[1].map(s => { try { return fs.statSync(s.filePath).mtimeMs; } catch(_) { return 0; } }));
                return mtimeB - mtimeA;
            });
        } else {
            entries.sort((a, b) => a[0].localeCompare(b[0]));
        }

        return entries;
    }

    _getCache() {
        if (!this._cache) {
            // Use index if ready, fall back to synchronous scan
            const idx = this._indexMgr;
            if (idx && idx.isReady()) {
                this._cache = idx.getModelsMap();
            } else {
                this._cache = scanModels(_getSourceDirs());
            }
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

                const field = source.fields.find(f => f.line === cursorLine);
                if (field) {
                    const item = this._itemCache.get(`field:${filePath}:${field.line}`);
                    if (item) this._treeView.reveal(item, { select: true, focus: false, expand: true }).then(null, () => {});
                    else {
                        const group = this._itemCache.get(`fieldsGroup:${filePath}`);
                        if (group) this._treeView.reveal(group, { select: true, focus: false, expand: true }).then(null, () => {});
                    }
                    return;
                }

                const method = (source.methods || []).find(m => m.line === cursorLine);
                if (method) {
                    const item = this._itemCache.get(`method:${filePath}:${method.line}`);
                    if (item) this._treeView.reveal(item, { select: true, focus: false, expand: true }).then(null, () => {});
                    else {
                        const group = this._itemCache.get(`methodsGroup:${filePath}`);
                        if (group) this._treeView.reveal(group, { select: true, focus: false, expand: true }).then(null, () => {});
                    }
                    return;
                }

                if (sources.length > 1 && this._groupByModule) {
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
        let content;
        try { content = fs.readFileSync(filePath, 'utf8'); } catch (_) { return; }
        const lines = content.split('\n');

        // Find the enclosing <record> block, then extract <field name="model">
        let recordStart = -1;
        for (let i = cursorLine - 1; i >= 0; i--) {
            if (lines[i].includes('</record>') && i < cursorLine - 1) return; // inside a different record
            if (/<record[\s>]/.test(lines[i])) { recordStart = i; break; }
        }
        if (recordStart === -1) return;

        // Scan forward from record start to find <field name="model">...
        for (let i = recordStart; i < lines.length && i < recordStart + 60; i++) {
            if (lines[i].includes('</record>') && i > recordStart) break;
            const m = lines[i].match(/<field[^>]+name=["']model["'][^>]*>([^<]+)</);
            if (m) {
                const modelName = m[1].trim();
                if (cache.has(modelName)) {
                    const item = this._itemCache.get(`model:${modelName}`);
                    if (item) this._treeView.reveal(item, { select: true, focus: false, expand: false }).then(null, () => {});
                }
                return;
            }
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
            if (line.includes('<record')) {
                const idMatch = line.match(/id="([^"]+)"/);
                if (idMatch) currentRecordId = idMatch[1];
                insideUiView = line.includes('model="ir.ui.view"');
            }
            if (line.includes('</record>')) insideUiView = false;
            if (onlyInViews && !insideUiView) continue;
            if (pattern.test(line)) {
                results.push({ filePath: xmlFile, line: i + 1, lineText: line.trim(), recordId: currentRecordId });
            }
        }
    }
    return results;
}

/**
 * Parse XML files for ir.ui.view records that contain a specific field in their arch.
 * Returns [{ filePath, line, recordId, modelName, viewType }]
 * - line points to the matching <field name="fieldName"> inside arch
 */
function _searchFieldInViews(xmlFiles, fieldName, filterModel) {
    const results = [];
    const fieldRe = new RegExp('<field[^>]+name="' + fieldName + '"[^>]*/?>');

    for (const xmlFile of xmlFiles) {
        let text;
        try { text = require("fs").readFileSync(xmlFile, "utf8"); } catch (_) { continue; }
        const lines = text.split("\n");

        let inRecord = false, inUiView = false, inArch = false, archDepth = 0;
        let recordId = "", recordModel = "", viewType = "";

        for (let i = 0; i < lines.length; i++) {
            const t = lines[i].trim();

            if (!inRecord) {
                if (t.includes("<record")) {
                    inRecord = true;
                    inUiView = t.includes('model="ir.ui.view"');
                    inArch = false; archDepth = 0;
                    recordId = ""; recordModel = ""; viewType = "";
                    const m = t.match(/id="([^"]+)"/);
                    if (m) recordId = m[1];
                }
                continue;
            }

            if (t.includes("</record>")) {
                inRecord = false; inUiView = false; inArch = false;
                archDepth = 0; recordId = ""; recordModel = ""; viewType = "";
                continue;
            }

            if (!inUiView) continue;

            if (!inArch) {
                let m;
                m = t.match(/<field[^>]+name="model"[^>]*>([^<]+)<\/field>/);
                if (m) { recordModel = m[1].trim(); continue; }
                m = t.match(/<field[^>]+name="type"[^>]*>([^<]+)<\/field>/);
                if (m) { viewType = m[1].trim(); continue; }
                if (t.match(/<field[^>]+name="arch"/)) {
                    inArch = true; archDepth = 0;
                    if (t.includes("</field>")) inArch = false;
                    continue;
                }
                continue;
            }

            // inside arch — detect view type from root tag if not already set
            const VIEW_TAGS = ['list','form','kanban','tree','search','graph','pivot','calendar','gantt','activity','qweb'];
            if (inArch && !viewType && archDepth === 0) {
                const rootTag = t.match(/^<(\w+)[\s>]/);
                if (rootTag && VIEW_TAGS.includes(rootTag[1])) viewType = rootTag[1];
            }

            if (t === "</field>" && archDepth === 0) { inArch = false; continue; }
            if (t.match(/^<field[^>]+>/) && !t.includes("/>") && !t.includes("</field>")) archDepth++;
            if (t.includes("</field>") && archDepth > 0) archDepth--;

            if (fieldRe.test(t)) {
                if (filterModel && recordModel && recordModel !== filterModel) continue;
                results.push({
                    filePath: xmlFile, line: i + 1, lineText: t,
                    recordId, recordModel, viewType: viewType || '',
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

/** Build QuickPick items for model→XML navigation */
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

/** Build QuickPick items for field-in-view results with rich display */
function _buildFieldXmlPickItems(results) {
    const wsRoot = utils.getWorkspaceRoot();
    return results.map(r => {
        const parts = [r.recordModel, r.recordId, r.viewType].filter(Boolean);
        const relPath = wsRoot ? r.filePath.replace(wsRoot + '/', '') : r.filePath;
        return {
            label: `$(symbol-misc) ${parts.join(' · ')}`,
            description: `line ${r.line}`,
            detail: relPath,
            filePath: r.filePath,
            line: r.line,
        };
    });
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

async function gotoFieldXml(item, modelName) {
    if (!(item instanceof FieldItem)) return;
    const fieldName = item.field.name;
    const filePath = item.field.filePath;
    const moduleRoot = _getModuleRoot(filePath);
    const titleSuffix = modelName ? ` in ${modelName} views` : '';

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Searching XML views for field "${fieldName}"${titleSuffix}...`, cancellable: false },
        async () => {
            // Same-module XMLs (views/ only)
            const sameModuleXmls = moduleRoot ? _findXmlFiles(moduleRoot, true) : [];
            const sameModuleResults = _searchFieldInViews(sameModuleXmls, fieldName, modelName);

            // All addons XMLs (views/ only)
            const allAddonsDirs = _getSourceDirs();
            const allXmls = allAddonsDirs.flatMap(d => {
                if (!fs.existsSync(d)) return [];
                let mods;
                try { mods = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return []; }
                return mods
                    .filter(m => m.isDirectory() && !m.name.startsWith('.'))
                    .flatMap(m => _findXmlFiles(path.join(d, m.name), true));
            });
            const allResults = _searchFieldInViews(allXmls, fieldName, modelName);

            const sameModulePaths = new Set(sameModuleResults.map(r => `${r.filePath}:${r.line}`));
            const otherResults = allResults.filter(r => !sameModulePaths.has(`${r.filePath}:${r.line}`));

            const items = [];
            if (sameModuleResults.length) {
                items.push({ label: '── Same Module ──', kind: vscode.QuickPickItemKind.Separator });
                items.push(..._buildFieldXmlPickItems(sameModuleResults));
            }
            if (otherResults.length) {
                items.push({ label: '── Other Addons ──', kind: vscode.QuickPickItemKind.Separator });
                items.push(..._buildFieldXmlPickItems(otherResults));
            }

            if (!items.length) {
                vscode.window.showInformationMessage(`No XML views found using field "${fieldName}".`);
                return;
            }

            const pick = await vscode.window.showQuickPick(items, {
                title: `Views using "${fieldName}"`,
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

// ── Hover helpers ─────────────────────────────────────────────────

function _gotoLink(label, filePath, line) {
    const args = encodeURIComponent(JSON.stringify([filePath, line]));
    return `[${label}](command:odooDebugger.modelExplorer.goto?${args})`;
}

function _relPath(filePath) {
    const root = utils.getWorkspaceRoot();
    return root ? filePath.replace(root + '/', '') : path.basename(filePath);
}

// ── XML Hover ─────────────────────────────────────────────────────

class OdooXmlHoverProvider {
    constructor(explorerProvider, indexMgr) {
        this._explorer = explorerProvider;
        this._idx = indexMgr;
    }

    provideHover(document, position) {
        if (!this._idx.isReady()) return null;
        const line = document.lineAt(position).text;

        // inherit_id ref="..."
        const inheritMatch = line.match(/name=["']inherit_id["'][^>]+ref=["']([^"']+)["']/);
        if (inheritMatch) return this._viewHover(inheritMatch[1], document.uri.fsPath);

        // id="xml_id"
        const idMatch = line.match(/\bid=["']([^"']+)["']/);
        if (idMatch) return this._viewHover(idMatch[1], document.uri.fsPath);

        // ref="module.xml_id"
        const refMatch = line.match(/\bref=["']([^"']+)["']/);
        if (refMatch) return this._viewHover(refMatch[1], document.uri.fsPath);

        // model="res.partner"
        const modelMatch = line.match(/model=["']([^"']+)["']/);
        if (modelMatch && modelMatch[1] !== 'ir.ui.view') return this._modelHover(modelMatch[1], document.uri.fsPath);

        return null;
    }

    _viewHover(xmlId, currentFile) {
        const tree = this._idx.buildViewTree(xmlId);
        if (!tree) return null;

        const lines2 = [];
        const render = (v, depth) => {
            const isRoot = depth === 0;
            const isCurrent = v.filePath === currentFile;
            const indent = depth === 0 ? '' : ('  '.repeat(depth - 1) + (depth === 1 ? '└─ ' : '   └─ '));

            if (v._stub) {
                lines2.push(`${indent}\`${v.fullXmlId}\` *(external)*`);
            } else {
                const rel = _relPath(v.filePath);
                const label = `${rel}:${v.line}`;
                // Don't link the current file — user is already there
                const entry = isCurrent ? `**${rel}:${v.line}**` : _gotoLink(label, v.filePath, v.line);
                lines2.push(`${indent}${entry}`);
            }
            for (const child of (tree.childrenMap.get(v.xmlId) || [])) render(child, depth + 1);
        };

        const rootLabel = tree.root.xmlId || xmlId;
        const vt = tree.root.viewType ? ` \`[${tree.root.viewType}]\`` : '';
        lines2.push(`**View:** \`${rootLabel}\`${vt}`);
        render(tree.root, 0);

        const md = new vscode.MarkdownString(lines2.join('\n\n'));
        md.isTrusted = true;
        return new vscode.Hover(md);
    }

    _modelHover(modelName, currentFile) {
        const sources = this._idx.getModel(modelName);
        if (!sources.length) return null;
        const lines2 = [`**Model:** \`${modelName}\``];
        for (const s of sources) {
            const rel = _relPath(s.filePath);
            const isCurrent = s.filePath === currentFile;
            const tag = s.isInherit ? '↳' : '✦';
            const label = `${rel}:${s.line}`;
            lines2.push(`${tag} ${isCurrent ? `**${label}**` : _gotoLink(label, s.filePath, s.line)}`);
        }
        const md = new vscode.MarkdownString(lines2.join('\n\n'));
        md.isTrusted = true;
        return new vscode.Hover(md);
    }
}

// ── Python Hover ──────────────────────────────────────────────────

class OdooPyHoverProvider {
    constructor(explorerProvider, indexMgr) {
        this._explorer = explorerProvider;
        this._idx = indexMgr;
    }

    provideHover(document, position) {
        if (!this._idx.isReady()) return null;
        const line = document.lineAt(position).text;
        const filePath = document.uri.fsPath;

        // class ClassName(models.Model):
        const classMatch = line.match(/^class\s+(\w+)\s*\(.*models\.(Model|TransientModel|AbstractModel)/);
        if (classMatch) {
            const modelName = this._modelNameFromClass(document, position.line);
            if (modelName) return this._modelHover(modelName, filePath);
        }

        // _name = 'x' or _inherit = 'x'
        const nameMatch = line.match(/^\s*_(?:name|inherit)\s*=\s*["']([^"']+)["']/);
        if (nameMatch) return this._modelHover(nameMatch[1], filePath);

        // field = fields.Type(
        const fieldMatch = line.match(/^\s*(\w+)\s*=\s*fields\.(\w+)\s*\(/);
        if (fieldMatch) return this._fieldHover(fieldMatch[1], fieldMatch[2], filePath, position);

        // def method_name( — definition
        const defMatch = line.match(/^\s*def\s+(\w+)\s*\(/);
        if (defMatch) return this._functionHover(defMatch[1], filePath, document, position);

        // method call: self.method( or rec.method( or any.method(
        const callRange = document.getWordRangeAtPosition(position, /[a-zA-Z_]\w*/);
        if (callRange) {
            const word = document.getText(callRange);
            // check char before word is '.' and char after is '('
            const lineText = line;
            const wordStart = callRange.start.character;
            const wordEnd = callRange.end.character;
            const before = wordStart > 0 ? lineText[wordStart - 1] : '';
            const after = lineText[wordEnd] || '';
            if (before === '.' && (after === '(' || lineText.slice(wordEnd).trimStart().startsWith('('))) {
                // it's a method call — show same hover as definition
                return this._functionHover(word, filePath, document, position);
            }
        }

        // 'res.partner' quoted model string
        const wordRange = document.getWordRangeAtPosition(position, /["'][a-z][a-z0-9_.]+["']/);
        if (wordRange) {
            const word = document.getText(wordRange).replace(/["']/g, '');
            if (word.includes('.') && this._idx.getModel(word).length) return this._modelHover(word, filePath);
        }

        return null;
    }

    _modelNameFromClass(document, classLineIdx) {
        for (let i = classLineIdx + 1; i < Math.min(classLineIdx + 20, document.lineCount); i++) {
            const l = document.lineAt(i).text;
            if (/^class\s+/.test(l)) break;
            const m = l.match(/^\s*_(?:name|inherit)\s*=\s*["']([^"']+)["']/);
            if (m) return m[1];
        }
        return null;
    }

    _modelHover(modelName, currentFile) {
        const sources = this._idx.getModel(modelName);
        if (!sources.length) return null;
        const lines2 = [`**Model:** \`${modelName}\``];
        for (const s of sources) {
            const rel = _relPath(s.filePath);
            const isCurrent = s.filePath === currentFile;
            const tag = s.isInherit ? '↳' : '✦';
            const label = `${rel}:${s.line}`;
            lines2.push(`${tag} ${isCurrent ? `**${label}**` : _gotoLink(label, s.filePath, s.line)}`);
        }
        const md = new vscode.MarkdownString(lines2.join('\n\n'));
        md.isTrusted = true;
        return new vscode.Hover(md);
    }

    _fieldHover(fieldName, fieldType, filePath, position) {
        const modelName = this._idx.findModelForField(filePath, fieldName);
        const lines2 = [`**Field:** \`${fieldName}\` — \`fields.${fieldType}\``];
        if (modelName) lines2.push(`Model: \`${modelName}\``);

        // XML usages from index — O(1)
        const usages = modelName ? this._idx.getFieldXml(modelName, fieldName) : [];
        if (usages.length) {
            lines2.push('**Used in views:**');
            for (const u of usages.slice(0, 12)) {
                const rel = _relPath(u.filePath);
                const vt = u.viewType ? ` [${u.viewType}]` : '';
                const id = u.recordId ? u.recordId.split('.').pop() : '';
                const label = `${id}${vt}  ${rel}:${u.line}`;
                lines2.push(`└─ ${_gotoLink(label, u.filePath, u.line)}`);
            }
            if (usages.length > 12) lines2.push(`*...and ${usages.length - 12} more*`);
        } else {
            lines2.push('*No XML views found*');
        }

        const md = new vscode.MarkdownString(lines2.join('\n\n'));
        md.isTrusted = true;
        return new vscode.Hover(md);
    }

    _functionHover(methodName, filePath, document, position) {
        const modelName = this._idx.findModelForMethod(filePath, methodName);

        let decorator = '';
        for (let i = position.line - 1; i >= Math.max(0, position.line - 3); i--) {
            const prev = document.lineAt(i).text.trim();
            if (prev.startsWith('@')) { decorator = prev; break; }
            if (prev && !prev.startsWith('#')) break;
        }

        const lines2 = [`**Function:** \`${methodName}\``];
        if (decorator) lines2.push(`\`${decorator}\``);
        if (modelName) lines2.push(`Model: \`${modelName}\``);

        // Override chain — separate defined vs overrides
        const overrides = modelName ? this._idx.getFunction(modelName, methodName) : [];
        const defined = overrides.find(o => !o.isInherit);
        const inherited = overrides.filter(o => o.isInherit);

        if (defined) {
            const rel = _relPath(defined.filePath);
            const isCurrent = defined.filePath === filePath;
            const label = `${rel}:${defined.line}`;
            lines2.push(`**Defined:** ${isCurrent ? `**${label}**` : _gotoLink(label, defined.filePath, defined.line)}`);
        }
        if (inherited.length) {
            lines2.push('**Overridden in:**');
            for (const o of inherited) {
                const rel = _relPath(o.filePath);
                const isCurrent = o.filePath === filePath;
                const label = `${rel}:${o.line}`;
                lines2.push(`↳ ${isCurrent ? `**${label}**` : _gotoLink(label, o.filePath, o.line)}`);
            }
        }

        // Callers — grep for .methodName( across workspace
        const callers = this._findCallers(methodName);
        if (callers.length) {
            lines2.push('**Called from:**');
            for (const c of callers.slice(0, 8)) {
                const rel = _relPath(c.filePath);
                const snippet = c.snippet ? `  \`${c.snippet}\`` : '';
                lines2.push(`└─ ${_gotoLink(`${rel}:${c.line}`, c.filePath, c.line)}${snippet}`);
            }
            if (callers.length > 8) lines2.push(`*...and ${callers.length - 8} more*`);
        }

        const md = new vscode.MarkdownString(lines2.join('\n\n'));
        md.isTrusted = true;
        return new vscode.Hover(md);
    }

    _findCallers(methodName) {
        // Search only in configured addons dirs, not entire workspace
        const dirs = _getSourceDirs();
        if (!dirs.length) return [];
        try {
            const { execSync } = require('child_process');
            const dirArgs = dirs.map(d => `'${d}'`).join(' ');
            // Simple pattern: .methodName( — fast, no complex regex
            const out = execSync(
                `grep -rn --include='*.py' '\.${methodName}(' ${dirArgs}`,
                { encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024 }
            );
            return out.trim().split('\n').filter(Boolean).map(l => {
                const colonIdx = l.indexOf(':');
                const secondColon = l.indexOf(':', colonIdx + 1);
                if (colonIdx === -1 || secondColon === -1) return null;
                const filePath = l.slice(0, colonIdx);
                const line = parseInt(l.slice(colonIdx + 1, secondColon), 10);
                const snippet = l.slice(secondColon + 1).trim().slice(0, 80);
                if (!filePath || isNaN(line)) return null;
                // skip def lines (the definition itself)
                if (/^\s*def\s+/.test(snippet)) return null;
                // skip comment lines
                if (/^\s*#/.test(snippet)) return null;
                return { filePath, line, snippet };
            }).filter(Boolean);
        } catch (_) { return []; }
    }
}


// ── Search / filter ────────────────────────────────────────────────

/**
 * Unified search QuickPick used by both searchModels (tree filter) and quickFind (navigate).
 * mode='filter' -> sets tree filter. mode='navigate' -> navigates to definition.
 * Prefix system: @ = fields, # = methods, : = modules, plain = models
 */
/**
 * Unified search QuickPick.
 * mode='filter': updates tree filter live, Enter keeps filter, navigate on field/method pick.
 * mode='navigate': just navigate to definition.
 * Prefixes: @ = fields (startsWith), # = methods (startsWith), : = modules, plain = models
 */
/**
 * Parse compound query: modelQ@fieldQ, modelQ#methodQ, :moduleQ@fieldQ, etc.
 * Returns { modelQ, fieldQ, methodQ, moduleQ } — all optional strings.
 * fieldQ/methodQ = '' means "show all fields/methods" (just @ or # with no query)
 */
function _normalizeModelName(s) {
    return s.toLowerCase().replace(/[._\s-]/g, '');
}

function _matchesModel(name, q) {
    if (!q) return true;
    if (name.includes(q)) return true;
    return _normalizeModelName(name).includes(_normalizeModelName(q));
}


function _parseQuery(val) {
    if (!val) return {};
    const v = val.trim();

    // Module prefix: :sale, :sale@code, :sale#action
    if (v.startsWith(':')) {
        const rest = v.slice(1);
        const atIdx = rest.indexOf('@');
        const hashIdx = rest.indexOf('#');
        if (atIdx !== -1) return { moduleQ: rest.slice(0, atIdx).toLowerCase(), fieldQ: rest.slice(atIdx + 1).toLowerCase() };
        if (hashIdx !== -1) return { moduleQ: rest.slice(0, hashIdx).toLowerCase(), methodQ: rest.slice(hashIdx + 1).toLowerCase() };
        return { moduleQ: rest.toLowerCase() };
    }

    // Field prefix only: @code
    if (v.startsWith('@')) return { fieldQ: v.slice(1).toLowerCase() };

    // Method prefix only: #action
    if (v.startsWith('#')) return { methodQ: v.slice(1).toLowerCase() };

    // Compound: res.partner@code, res.partner#action, res.partner@
    const atIdx = v.indexOf('@');
    const hashIdx = v.indexOf('#');
    if (atIdx !== -1) return { modelQ: v.slice(0, atIdx).toLowerCase(), fieldQ: v.slice(atIdx + 1).toLowerCase() };
    if (hashIdx !== -1) return { modelQ: v.slice(0, hashIdx).toLowerCase(), methodQ: v.slice(hashIdx + 1).toLowerCase() };

    // Plain model search
    return { modelQ: v.toLowerCase() };
}


async function _unifiedSearch(cache, mode, provider, initialValue) {
    const qp = vscode.window.createQuickPick();
    qp.placeholder = 'Search models  ·  @field  ·  #method  ·  :module';
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;
    qp.keepScrollPosition = true;

    const HINT_ITEMS = [
        { label: '$(symbol-class) Models', description: 'plain text — search by model name', _prefix: '' },
        { label: '$(symbol-field) @ Fields', description: '@ — models with field starting with...', _prefix: '@' },
        { label: '$(symbol-method) # Functions', description: '# — models with function starting with...', _prefix: '#' },
        { label: '$(folder) : Modules', description: ': — filter by module name', _prefix: ':' },
    ];

    function buildItems(query) {
        if (!query) return HINT_ITEMS;
        const q = query.toLowerCase();
        const items = [];

        if (query.startsWith('@')) {
            const fq = q.slice(1);
            if (!fq) return HINT_ITEMS;
            for (const [modelName, sources] of cache) {
                for (const source of sources) {
                    for (const field of source.fields) {
                        if (field.name.toLowerCase().startsWith(fq)) {
                            items.push({
                                label: '$(symbol-field) ' + field.name,
                                description: modelName + ' · ' + field.type,
                                detail: source.moduleName,
                                _filePath: field.filePath, _line: field.line,
                            });
                        }
                    }
                }
                if (items.length >= 100) break;
            }
        } else if (query.startsWith('#')) {
            const mq = q.slice(1);
            if (!mq) return HINT_ITEMS;
            for (const [modelName, sources] of cache) {
                for (const source of sources) {
                    for (const method of (source.methods || [])) {
                        if (method.name.toLowerCase().startsWith(mq)) {
                            items.push({
                                label: '$(symbol-method) ' + method.name,
                                description: modelName,
                                detail: source.moduleName + (method.decorator ? ' · ' + method.decorator : ''),
                                _filePath: method.filePath, _line: method.line,
                            });
                        }
                    }
                }
                if (items.length >= 100) break;
            }
        } else if (query.startsWith(':')) {
            const moq = q.slice(1);
            if (!moq) return HINT_ITEMS;
            const seen = new Set();
            for (const [, sources] of cache) {
                for (const source of sources) {
                    if (source.moduleName.toLowerCase().includes(moq) && !seen.has(source.moduleName)) {
                        seen.add(source.moduleName);
                        items.push({
                            label: '$(folder) ' + source.moduleName,
                            description: source.filePath.split('/').slice(-3, -1).join('/'),
                            _filePath: source.filePath, _line: source.line,
                        });
                    }
                }
                if (items.length >= 50) break;
            }
        } else {
            for (const [name, sources] of cache) {
                if (name.toLowerCase().includes(q)) {
                    const modules = [...new Set(sources.map(s => s.moduleName))];
                    items.push({
                        label: '$(symbol-class) ' + name,
                        description: modules.join(', '),
                        _filePath: sources[0].filePath, _line: sources[0].line,
                        _isModel: true,
                    });
                }
                if (items.length >= 100) break;
            }
            items.sort((a, b) => a.label.localeCompare(b.label));
        }

        if (!items.length) {
            return [{ label: '$(info) No results for "' + query + '"', _noResult: true }];
        }
        return items;
    }

    // Track what the user actually typed (separate from qp.value which VS Code
    // overwrites with the selected item label on arrow key navigation)
    let _typedVal = initialValue || '';

    qp.items = _typedVal ? buildItems(_typedVal) : HINT_ITEMS;
    if (_typedVal) qp.value = _typedVal;

    qp.onDidChangeValue(val => {
        // Only update _typedVal when the change looks like real typing
        // (not VS Code overwriting qp.value with a selected item label)
        _typedVal = val;
        qp.items = buildItems(val);
        if (mode === 'filter' && provider) {
            provider.setFilter(val);
        }
    });

    qp.onDidAccept(() => {
        const item = qp.selectedItems[0];

        // No item or no-result — Enter = close and keep filter using _typedVal
        if (!item || item._noResult) {
            qp.hide();
            if (mode === 'filter' && provider) provider.setFilter(_typedVal || '');
            return;
        }

        // Hint/autocomplete item — insert prefix and show next results
        if (item._prefix !== undefined && !item._filePath) {
            _typedVal = item._prefix;
            qp.value = item._prefix;
            qp.items = buildItems(item._prefix);
            if (mode === 'filter' && provider) provider.setFilter(item._prefix);
            return;
        }

        // Close and keep filter using _typedVal (not qp.value which may be label text)
        qp.hide();
        if (mode === 'filter' && provider) provider.setFilter(_typedVal || '');
        if (item._filePath && (mode === 'navigate' || !item._isModel)) {
            gotoLocation(item._filePath, item._line);
        }
    });

    qp.onDidHide(() => qp.dispose());

    qp.show();
}


async function searchModels(provider) {
    await _unifiedSearch(provider._getCache(), 'filter', provider, provider._filter || '');
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

async function sortModels(provider) {
    const items = [
        { label: '$(sort-precedence) Alphabetical', order: 'alpha', description: 'A → Z' },
        { label: '$(history) Recently Modified', order: 'recent', description: 'Last edited file first' },
    ];
    const pick = await vscode.window.showQuickPick(
        items.map(i => ({ ...i, picked: i.order === provider._sortOrder })),
        { title: 'Sort Models By' }
    );
    if (pick) provider.setSortOrder(pick.order);
}

async function toggleGroupByModule(provider) {
    provider.setGroupByModule(!provider._groupByModule);
    vscode.window.showInformationMessage(
        provider._groupByModule ? 'Model Explorer: Grouped by module' : 'Model Explorer: Flat (all fields merged)'
    );
}

/**
 * Quick Find — fully independent from model explorer filter.
 * Opens a dedicated QuickPick with live suggestions as you type.
 * Prefixes: @ = fields, # = methods, : = modules, plain = models
 */
/**
 * Quick Find — fully independent, accepts a cache getter so it always has fresh data.
 * Shows hint items on open. Results update synchronously as you type.
 */
async function quickFind(getCache) {
    // Accept either a getter function or a direct Map
    const cache = typeof getCache === 'function' ? getCache() : getCache;

    if (!cache || cache.size === 0) {
        vscode.window.showWarningMessage(
            'Model Explorer has no data yet. Expand the Model Explorer tree first to populate the cache.',
            'Open Model Explorer'
        ).then(pick => {
            if (pick) vscode.commands.executeCommand('odooDebugger.modelExplorer.search');
        });
        return;
    }

    const qp = vscode.window.createQuickPick();
    qp.title = 'Odoo Quick Find  ·  ' + cache.size + ' models loaded';
    qp.placeholder = 'Type model name  ·  @field  ·  #method  ·  :module';
    qp.matchOnDescription = false;
    qp.matchOnDetail = false;

    const HINTS = [
        { label: '$(symbol-class) Models', description: 'plain text — search by model name', _isHint: true, _prefix: '' },
        { label: '$(symbol-field) @ Fields', description: '@ — search fields (e.g. @name)', _isHint: true, _prefix: '@' },
        { label: '$(symbol-method) # Functions', description: '# — search functions (e.g. #action_confirm)', _isHint: true, _prefix: '#' },
        { label: '$(folder) : Modules', description: ': — search by module (e.g. :sale)', _isHint: true, _prefix: ':' },
    ];

    function getResults(query) {
        if (!query) return HINTS;
        const { modelQ, fieldQ, methodQ, moduleQ } = _parseQuery(query);
        const results = [];

        // Filter entries by model/module
        let entries = [...cache.entries()];
        if (modelQ) entries = entries.filter(([name]) => _matchesModel(name, modelQ));
        if (moduleQ) entries = entries.filter(([, srcs]) => srcs.some(s => s.moduleName.toLowerCase().includes(moduleQ)));

        if (fieldQ !== undefined) {
            // Show fields — fieldQ='' means all fields of matched models
            for (const [modelName, sources] of entries) {
                for (const source of sources) {
                    for (const field of source.fields) {
                        if (!fieldQ || field.name.toLowerCase().startsWith(fieldQ)) {
                            results.push({
                                label: '$(symbol-field) ' + field.name,
                                description: modelName + ' · ' + field.type,
                                detail: source.moduleName,
                                alwaysShow: true,
                                _filePath: field.filePath, _line: field.line,
                            });
                        }
                    }
                }
                if (results.length >= 100) break;
            }
            // Hint: suggest adding # for methods
            if (modelQ && !results.length && !fieldQ) {
                return [{ label: '$(info) No fields found in ' + modelQ, _noResult: true, alwaysShow: true }];
            }
        } else if (methodQ !== undefined) {
            // Show methods
            for (const [modelName, sources] of entries) {
                for (const source of sources) {
                    for (const method of (source.methods || [])) {
                        if (!methodQ || method.name.toLowerCase().startsWith(methodQ)) {
                            results.push({
                                label: '$(symbol-method) ' + method.name,
                                description: modelName,
                                detail: source.moduleName + (method.decorator ? ' · ' + method.decorator : ''),
                                alwaysShow: true,
                                _filePath: method.filePath, _line: method.line,
                            });
                        }
                    }
                }
                if (results.length >= 100) break;
            }
        } else if (moduleQ && !modelQ) {
            // Module-only search: show matching modules
            const seen = new Set();
            for (const [, sources] of entries) {
                for (const source of sources) {
                    if (!seen.has(source.moduleName)) {
                        seen.add(source.moduleName);
                        results.push({
                            label: '$(folder) ' + source.moduleName,
                            description: source.filePath.split('/').slice(-3, -1).join('/'),
                            alwaysShow: true,
                            _isModule: true, _moduleName: source.moduleName,
                            _filePath: source.filePath, _line: source.line,
                        });
                    }
                }
                if (results.length >= 50) break;
            }
        } else {
            // Model search
            for (const [name, sources] of entries) {
                if (results.length < 100) {
                    results.push({
                        label: '$(symbol-class) ' + name,
                        description: [...new Set(sources.map(s => s.moduleName))].join(', '),
                        alwaysShow: true,
                        _isModel: true, _modelName: name,
                        _filePath: sources[0].filePath, _line: sources[0].line,
                    });
                }
            }
            results.sort((a, b) => a.label.localeCompare(b.label));
            // Compound hints shown when user selects a model item (via onDidAccept)
        }

        return results.length ? results : [{ label: '$(info) No results for "' + query + '"', _noResult: true, alwaysShow: true }];
    }

    let _qfTyped = '';

    qp.items = HINTS;

    qp.onDidChangeValue(val => {
        _qfTyped = val;
        qp.items = val ? getResults(val) : HINTS;
    });

    qp.onDidAccept(() => {
        const item = qp.selectedItems[0];
        if (!item) return;

        // Hint item (@ # : prefixes) — insert prefix
        if (item._isHint) {
            _qfTyped = item._prefix;
            qp.value = item._prefix;
            qp.items = getResults(item._prefix);
            return;
        }

        if (item._noResult) return;

        // Model item — show ONLY the two autocomplete hints, nothing else
        if (item._isModel) {
            const modelName = item._modelName || item.label.replace('$(symbol-class) ', '');
            _qfTyped = modelName;
            qp.value = modelName;
            qp.items = [
                { label: '$(symbol-field) ' + modelName + '@ — show fields', _isHint: true, _prefix: modelName + '@', alwaysShow: true },
                { label: '$(symbol-method) ' + modelName + '# — show methods', _isHint: true, _prefix: modelName + '#', alwaysShow: true },
            ];
            return;
        }

        // Module item — show ONLY the two autocomplete hints
        if (item._isModule) {
            const modName = item._moduleName || item.label.replace('$(folder) ', '');
            _qfTyped = ':' + modName;
            qp.value = ':' + modName;
            qp.items = [
                { label: '$(symbol-field) :' + modName + '@ — fields in module', _isHint: true, _prefix: ':' + modName + '@', alwaysShow: true },
                { label: '$(symbol-method) :' + modName + '# — methods in module', _isHint: true, _prefix: ':' + modName + '#', alwaysShow: true },
            ];
            return;
        }

        // Field or method — navigate
        qp.hide();
        if (item._filePath) gotoLocation(item._filePath, item._line);
    });

    qp.onDidHide(() => qp.dispose());
    qp.show();
}


module.exports = {
    ModelExplorerProvider, FieldItem, ModelItem, SourceItem,
    OdooXmlSymbolProvider, OdooXmlHoverProvider, OdooPyHoverProvider,
    gotoLocation, openModelInBrowser, gotoXmlView, gotoFieldXml, findMethodUsages,
    searchModels, configureSources, filterModelType, sortModels, toggleGroupByModule, quickFind,
    CTX_FILTER_ACTIVE,
};
