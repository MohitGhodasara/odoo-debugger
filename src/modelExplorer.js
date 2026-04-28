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
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this._cache = null;
        this._filter = '';
        this._typeFilter = 'all'; // 'all' | 'model' | 'transient' | 'abstract'
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

    getChildren(element) {
        if (element instanceof ModelItem) {
            if (element.sources.length === 1 || !this._groupByModule) {
                // Flat: merge all fields from all sources
                if (!this._groupByModule && element.sources.length > 1) {
                    return this._fieldsForSources(element.sources);
                }
                return this._fieldsForSource(element.sources[0], element.modelName);
            }
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
        const activeFilter = this._filter || '';
        const _pq = _parseQuery(activeFilter);
        const fieldQ = _pq.fieldQ !== undefined ? _pq.fieldQ : null;
        const methodQ = _pq.methodQ !== undefined ? _pq.methodQ : null;

        // When # filter active — hide fields entirely, show only matching methods
        // When @ filter active — show only matching fields, hide methods group
        if (!methodQ) {
            const fields = fieldQ
                ? source.fields.filter(f => f.name.toLowerCase().startsWith(fieldQ))
                : source.fields;

            if (fields.length) {
                fields.forEach(f => {
                    const item = new FieldItem(f);
                    this._itemCache.set(`field:${f.filePath}:${f.line}`, item);
                    items.push(item);
                });
            } else if (!fieldQ) {
                const empty = new vscode.TreeItem('No fields');
                empty.iconPath = new vscode.ThemeIcon('dash');
                items.push(empty);
            }
        }

        if (!fieldQ) {
            const methods = methodQ
                ? (source.methods || []).filter(m => m.name.toLowerCase().startsWith(methodQ))
                : (source.methods || []);

            if (methods.length) {
                const groupItem = new MethodsGroupItem(methods, source.filePath);
                this._itemCache.set(`methodsGroup:${source.filePath}`, groupItem);
                items.push(groupItem);
            }
        }
        return items;
    }

    /** Flat merge of fields from all sources (no module grouping) */
    _fieldsForSources(sources) {
        const items = [];
        const activeFilter = this._filter || '';
        const _pq2 = _parseQuery(activeFilter);
        const fieldQ = _pq2.fieldQ !== undefined ? _pq2.fieldQ : null;
        const methodQ = _pq2.methodQ !== undefined ? _pq2.methodQ : null;

        if (!methodQ) {
            const allFields = sources.flatMap(s => s.fields);
            const fields = fieldQ ? allFields.filter(f => f.name.toLowerCase().startsWith(fieldQ)) : allFields;
            if (fields.length) {
                fields.forEach(f => {
                    const item = new FieldItem(f);
                    this._itemCache.set(`field:${f.filePath}:${f.line}`, item);
                    items.push(item);
                });
            } else if (!fieldQ) {
                const empty = new vscode.TreeItem('No fields');
                empty.iconPath = new vscode.ThemeIcon('dash');
                items.push(empty);
            }
        }

        if (!fieldQ) {
            const allMethods = sources.flatMap(s => s.methods || []);
            const methods = methodQ ? allMethods.filter(m => m.name.toLowerCase().startsWith(methodQ)) : allMethods;
            if (methods.length) {
                const groupItem = new MethodsGroupItem(methods, sources[0].filePath);
                this._itemCache.set(`methodsGroup:${sources[0].filePath}`, groupItem);
                items.push(groupItem);
            }
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
        { label: '$(symbol-method) # Methods', description: '# — models with method starting with...', _prefix: '#' },
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
        { label: '$(symbol-method) # Methods', description: '# — search methods (e.g. #action_confirm)', _isHint: true, _prefix: '#' },
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
    OdooXmlSymbolProvider, OdooXmlHoverProvider,
    gotoLocation, openModelInBrowser, gotoXmlView, gotoFieldXml, findMethodUsages,
    searchModels, configureSources, filterModelType, sortModels, toggleGroupByModule, quickFind,
    CTX_FILTER_ACTIVE,
};
