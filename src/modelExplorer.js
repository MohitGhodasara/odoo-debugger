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
        this.contextValue = 'odooModel';
        this.iconPath = new vscode.ThemeIcon('symbol-class');
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

class FieldItem extends vscode.TreeItem {
    constructor(field) {
        super(field.name, vscode.TreeItemCollapsibleState.None);
        this.field = field;
        this.description = field.type;
        this.tooltip = `${field.name}: fields.${field.type}\n${field.filePath}:${field.line}`;
        this.contextValue = 'odooField';
        this.iconPath = new vscode.ThemeIcon('symbol-field');
        this.command = { command: 'odooDebugger.modelExplorer.goto', title: 'Go to Field', arguments: [field.filePath, field.line] };
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
            currentBlock = { classLine: i + 1, name: null, isInherit: false, fields: [] };
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
                        fields: parsed.fields.map(f => ({ ...f, filePath: pyFile })),
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
    const communityAddons = path.join(utils.getCommunityPath(), 'addons');
    const allCustom = utils.discoverAllAddonsDirs();
    const current = _getSourceDirs();
    const items = [
        { label: 'community/addons', description: communityAddons, detail: '⚠ Large — slow to scan', picked: current.includes(communityAddons) },
        ...allCustom.map(dir => ({ label: path.basename(dir), description: dir, picked: current.includes(dir) })),
    ];
    const picks = await vscode.window.showQuickPick(items, {
        title: 'Model Explorer — Select Addons Dirs to Scan',
        placeHolder: 'Check directories to include',
        canPickMany: true,
    });
    if (!picks) return;
    const selected = picks.map(p => p.description);
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
        this._treeView = null;
        this._revealTimer = null;
    }

    setTreeView(tv) { this._treeView = tv; }

    refresh() {
        this._cache = null;
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
            if (element.sources.length === 1) return this._fieldsForSource(element.sources[0]);
            return element.sources.map(s => new SourceItem(s));
        }
        if (element instanceof SourceItem) return this._fieldsForSource(element.source);
        return this._getRootItems();
    }

    _fieldsForSource(source) {
        if (!source.fields.length) {
            const empty = new vscode.TreeItem('No fields');
            empty.iconPath = new vscode.ThemeIcon('dash');
            return [empty];
        }
        return source.fields.map(f => new FieldItem(f));
    }

    _getRootItems() {
        const models = this._getFilteredModels();
        if (!models.length) {
            const item = new vscode.TreeItem(this._filter ? `No models match "${this._filter}"` : 'No models found');
            item.iconPath = new vscode.ThemeIcon('info');
            return [item];
        }
        return models.map(([name, sources]) => new ModelItem(name, sources));
    }

    _getFilteredModels() {
        const map = this._getCache();
        const filter = this._filter;
        const entries = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        if (!filter) return entries;
        return entries.filter(([name, sources]) =>
            name.includes(filter) || sources.some(s => s.moduleName.toLowerCase().includes(filter))
        );
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
        // Find which model+source this file/line belongs to
        for (const [modelName, sources] of cache) {
            for (const source of sources) {
                if (source.filePath !== filePath) continue;

                // Check if cursor is on a field line
                const field = source.fields.find(f => f.line === cursorLine);
                if (field) {
                    const modelItem = new ModelItem(modelName, sources);
                    if (sources.length === 1) {
                        const fieldItem = new FieldItem({ ...field, filePath });
                        this._treeView.reveal(fieldItem, { select: true, focus: false, expand: true }).then(null, () => {});
                    } else {
                        const sourceItem = new SourceItem(source);
                        this._treeView.reveal(sourceItem, { select: true, focus: false, expand: true }).then(null, () => {});
                    }
                    return;
                }

                // Cursor is somewhere in this model's file — reveal the model
                const modelItem = new ModelItem(modelName, sources);
                this._treeView.reveal(modelItem, { select: true, focus: false, expand: false }).then(null, () => {});
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

/** Find all XML files in a directory recursively */
function _findXmlFiles(dir) {
    const results = [];
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return results; }
    for (const e of entries) {
        if (e.name.startsWith('.') || e.name === '__pycache__') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) results.push(..._findXmlFiles(full));
        else if (e.name.endsWith('.xml')) results.push(full);
    }
    return results;
}

/**
 * Search XML files for a pattern, return matches:
 * [{ filePath, line, lineText, recordId }]
 */
function _searchXmlFiles(xmlFiles, pattern) {
    const results = [];
    for (const xmlFile of xmlFiles) {
        let content;
        try { content = fs.readFileSync(xmlFile, 'utf8'); } catch (_) { continue; }
        const lines = content.split('\n');
        // Track current record id for context
        let currentRecordId = '';
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const recMatch = line.match(/id="([^"]+)"/);
            if (recMatch && line.includes('<record')) currentRecordId = recMatch[1];
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
            const sameModuleXmls = moduleRoots.flatMap(r => _findXmlFiles(r));
            const sameModuleResults = _searchXmlFiles(sameModuleXmls, new RegExp(`model="${modelName}"`));

            // All addons
            const allAddonsDirs = _getSourceDirs();
            const allXmls = allAddonsDirs.flatMap(d => {
                if (!fs.existsSync(d)) return [];
                let mods;
                try { mods = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return []; }
                return mods
                    .filter(m => m.isDirectory() && !m.name.startsWith('.'))
                    .flatMap(m => _findXmlFiles(path.join(d, m.name)));
            });
            const allResults2 = _searchXmlFiles(allXmls, new RegExp(`model="${modelName}"`));

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
            // Pattern: <field name="fieldName" or name="fieldName" in various contexts
            const pattern = new RegExp(`name="${fieldName}"`);

            // Same-module XMLs
            const sameModuleXmls = moduleRoot ? _findXmlFiles(moduleRoot) : [];
            const sameModuleResults = _searchXmlFiles(sameModuleXmls, pattern);

            // All addons XMLs
            const allAddonsDirs = _getSourceDirs();
            const allXmls = allAddonsDirs.flatMap(d => {
                if (!fs.existsSync(d)) return [];
                let mods;
                try { mods = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return []; }
                return mods
                    .filter(m => m.isDirectory() && !m.name.startsWith('.'))
                    .flatMap(m => _findXmlFiles(path.join(d, m.name)));
            });
            const allResults = _searchXmlFiles(allXmls, pattern);

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

module.exports = {
    ModelExplorerProvider, FieldItem, ModelItem, SourceItem,
    OdooXmlSymbolProvider, OdooXmlHoverProvider,
    gotoLocation, openModelInBrowser, gotoXmlView, gotoFieldXml,
    searchModels, configureSources,
    CTX_FILTER_ACTIVE,
};
