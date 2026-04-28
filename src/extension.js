const vscode = require('vscode');
const server = require('./server');
const navigation = require('./navigation');
const utilities = require('./utilities');
const logViewer = require('./logViewer');
const { OdooSidebarProvider } = require('./sidebarPanel');
const { OdooLogPanelProvider } = require('./logPanel');
const { ModelExplorerProvider, FieldItem, ModelItem, OdooXmlSymbolProvider, OdooXmlHoverProvider, gotoLocation, openModelInBrowser, gotoXmlView, gotoFieldXml, findMethodUsages, searchModels, configureSources, filterModelType, sortModels, toggleGroupByModule, quickFind, CTX_FILTER_ACTIVE } = require('./modelExplorer');
const { BreakpointExplorerProvider, gotoBreakpoint, toggleBreakpoint, removeBreakpoint, enableAllBreakpoints, disableAllBreakpoints, clearAllBreakpoints } = require('./breakpointExplorer');
const { SqlToolsProvider, CTX_SQL_FILTER, runSql, filterTables, browseTable, showTableColumns, copySelectStatement } = require('./sqlTools');
const dataBrowser = require('./dataBrowser');
const utils = require('./utils');

function activate(context) {
    // Status bar
    const statusBar = utilities.createStatusBar();
    context.subscriptions.push(statusBar);

    // Sidebar webview panel (replaces tree views)
    const sidebarProvider = new OdooSidebarProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('odooDebugger.sidebar', sidebarProvider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    // Model Explorer tree view
    const modelExplorer = new ModelExplorerProvider();
    const modelExplorerView = vscode.window.createTreeView('odooDebugger.modelExplorer', {
        treeDataProvider: modelExplorer,
        showCollapseAll: true,
    });
    modelExplorer.setTreeView(modelExplorerView);
    context.subscriptions.push(modelExplorerView);
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (doc.fileName.endsWith('.py')) modelExplorer.refresh();
        })
    );

    // Cursor sync — auto-reveal in Model Explorer
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(e => {
            modelExplorer.onCursorMove(e.textEditor);
        })
    );

    // XML Document Symbol provider (Outline panel)
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            { language: 'xml', pattern: '**/*.xml' },
            new OdooXmlSymbolProvider()
        )
    );

    // XML Hover provider
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            { language: 'xml', pattern: '**/*.xml' },
            new OdooXmlHoverProvider(modelExplorer)
        )
    );

    // Breakpoint Explorer tree view
    const bpExplorer = new BreakpointExplorerProvider();
    const bpView = vscode.window.createTreeView('odooDebugger.breakpoints', {
        treeDataProvider: bpExplorer,
        showCollapseAll: false,
    });
    context.subscriptions.push(bpView);
    vscode.commands.executeCommand('setContext', CTX_FILTER_ACTIVE, false);
    vscode.commands.executeCommand('setContext', CTX_SQL_FILTER, false);

    // SQL Tools tree view
    const sqlToolsProvider = new SqlToolsProvider(context);
    const sqlView = vscode.window.createTreeView('odooDebugger.sqlTools', {
        treeDataProvider: sqlToolsProvider,
        showCollapseAll: false,
    });
    context.subscriptions.push(sqlView);

    // Log Panel (bottom panel)
    const logPanelProvider = new OdooLogPanelProvider(context);
    logViewer.setPanel(logPanelProvider, vscode);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('odooDebugger.logPanel', logPanelProvider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    // Register all commands
    const commands = {
        // Server
        'odooDebugger.runOdoo': server.runOdoo,
        'odooDebugger.debugOdoo': server.debugOdoo,
        'odooDebugger.stopOdoo': server.stopOdoo,
        'odooDebugger.restartOdoo': server.restartOdoo,
        'odooDebugger.openShell': server.openShell,
        // Logs
        'odooDebugger.openLogPanel': () => vscode.commands.executeCommand('odooDebugger.logPanel.focus'),
        'odooDebugger.modelExplorer.copyModelName': (item) => {
            const name = item?.modelName || item?.label;
            if (name) {
                vscode.env.clipboard.writeText(name);
                vscode.window.setStatusBarMessage(`Copied: ${name}`, 2000);
            }
        },
        'odooDebugger.openConfFile': async () => {
            const cf = utils.getConfigFile();
            if (!cf) {
                vscode.window.showWarningMessage('No config file configured. Set odooDebugger.configFile in settings.');
                return;
            }
            const fs = require('fs');
            if (!fs.existsSync(cf)) {
                vscode.window.showWarningMessage(`Config file not found: ${cf}`);
                return;
            }
            const doc = await vscode.workspace.openTextDocument(cf);
            await vscode.window.showTextDocument(doc);
        },
        'odooDebugger.logPanel.gotoFile': async (file, line) => {
            try {
                const doc = await vscode.workspace.openTextDocument(file);
                const editor = await vscode.window.showTextDocument(doc);
                const pos = new vscode.Position(Math.max(0, (parseInt(line) || 1) - 1), 0);
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
            } catch (_) {}
        },
        // JS Debug
        'odooDebugger.launchChromeDebug': server.launchChromeDebug,
        'odooDebugger.attachJsDebugger': server.attachJsDebugger,
        // Modules
        'odooDebugger.updateModule': server.updateModule,
        'odooDebugger.installModule': server.installModule,
        'odooDebugger.updateChangedModules': server.updateChangedModules,
        'odooDebugger.uninstallModule': server.uninstallModule,
        'odooDebugger.scaffoldModule': server.scaffoldModule,
        'odooDebugger.manageAddonsPaths': server.manageAddonsPaths,
        // Navigation
        'odooDebugger.toggleModelView': navigation.toggleModelView,
        'odooDebugger.gotoModel': navigation.gotoModel,
        'odooDebugger.gotoModelFromSelection': navigation.gotoModelFromSelection,
        'odooDebugger.gotoXmlId': navigation.gotoXmlId,
        'odooDebugger.gotoXmlIdFromSelection': navigation.gotoXmlIdFromSelection,
        'odooDebugger.gotoFunctionDef': navigation.gotoFunctionDef,
        'odooDebugger.gotoFunctionDefAll': navigation.gotoFunctionDefAll,
        'odooDebugger.currentModuleInfo': navigation.currentModuleInfo,
        // Utilities
        'odooDebugger.killPython': utilities.killPython,
        'odooDebugger.startPostgres': utilities.startPostgres,
        'odooDebugger.openOdoo': utilities.openOdoo,
        'odooDebugger.openApps': utilities.openApps,
        'odooDebugger.openDebugMode': utilities.openDebugMode,
        'odooDebugger.clearAssets': utilities.clearAssets,
        'odooDebugger.removeUnusedImports': utilities.removeUnusedImports,
        'odooDebugger.dropDatabase': utilities.dropDatabase,
        'odooDebugger.copyDatabase': utilities.copyDatabase,
        'odooDebugger.switchDatabase': utilities.switchDatabase,
        'odooDebugger.openSettings': () => vscode.commands.executeCommand('workbench.action.openSettings', 'odooDebugger'),
        'odooDebugger.selectInterpreter': () => vscode.commands.executeCommand('python.setInterpreter'),
        'odooDebugger.selectCommunityPath': () => vscode.commands.executeCommand('odooDebugger.manageAddonsPaths'),
        // Model Explorer
        'odooDebugger.refreshModelExplorer': () => modelExplorer.refresh(),
        'odooDebugger.modelExplorer.goto': gotoLocation,
        'odooDebugger.modelExplorer.gotoXmlView': (item) => gotoXmlView(item),
        'odooDebugger.modelExplorer.openInBrowser': (item) => openModelInBrowser(item),
        'odooDebugger.modelExplorer.gotoFieldXml': (item) => {
            // Look up model name from cache by matching field filePath+name
            let modelName = '';
            for (const [mn, srcs] of modelExplorer._getCache()) {
                if (srcs.some(s => s.fields.some(f => f.name === item.field.name && f.filePath === item.field.filePath))) {
                    modelName = mn; break;
                }
            }
            gotoFieldXml(item, modelName);
        },
        'odooDebugger.modelExplorer.findMethodUsages': (item) => findMethodUsages(item),
        'odooDebugger.modelExplorer.search': () => searchModels(modelExplorer),
        'odooDebugger.modelExplorer.clearFilter': () => modelExplorer.clearFilter(),
        'odooDebugger.modelExplorer.filterType': () => filterModelType(modelExplorer),
        'odooDebugger.modelExplorer.sortModels': () => sortModels(modelExplorer),
        'odooDebugger.modelExplorer.toggleGroupByModule': () => toggleGroupByModule(modelExplorer),
        'odooDebugger.quickFind': () => quickFind(() => modelExplorer._getCache()),
        'odooDebugger.focusPanel': () => vscode.commands.executeCommand('workbench.view.extension.odoo-dev'),
        'odooDebugger.modelExplorer.configureSources': async () => { await configureSources(); modelExplorer.refresh(); },
        // Breakpoints
        'odooDebugger.breakpoints.goto': gotoBreakpoint,
        'odooDebugger.breakpoints.toggle': (item) => toggleBreakpoint(item.bp),
        'odooDebugger.breakpoints.remove': (item) => removeBreakpoint(item.bp),
        'odooDebugger.breakpoints.enableAll': enableAllBreakpoints,
        'odooDebugger.breakpoints.disableAll': disableAllBreakpoints,
        'odooDebugger.breakpoints.clearAll': clearAllBreakpoints,
        // Model data browser
        'odooDebugger.modelExplorer.browseRecords': (item) => dataBrowser.browseModel(item.modelName),
        'odooDebugger.modelExplorer.browseFieldValues': (item) => dataBrowser.browseField(
            // find parent model name by looking up field in cache
            (() => { for (const [mn, srcs] of modelExplorer._getCache()) { if (srcs.some(s => s.fields.some(f => f.name === item.field.name && f.filePath === item.field.filePath))) return mn; } return ''; })(),
            item.field.name, item.field.type
        ),
        // SQL Tools
        'odooDebugger.sqlTools.runSql': () => runSql(sqlToolsProvider),
        'odooDebugger.sqlTools.refresh': () => sqlToolsProvider.refresh(),
        'odooDebugger.sqlTools.filterTables': () => filterTables(sqlToolsProvider),
        'odooDebugger.sqlTools.clearFilter': () => sqlToolsProvider.clearFilter(),
        'odooDebugger.sqlTools.browseTable': (item) => browseTable(typeof item === 'string' ? item : item.tableName),
        'odooDebugger.sqlTools.showColumns': (item) => showTableColumns(item.tableName),
        'odooDebugger.sqlTools.copySelect': (item) => copySelectStatement(item.tableName),
        'odooDebugger.sqlTools.runHistoryItem': (sql) => dataBrowser.runSqlQuery(sql),
        'odooDebugger.sqlTools.clearHistory': () => sqlToolsProvider.clearHistory(),
    };

    for (const [id, handler] of Object.entries(commands)) {
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    }

    // State tracking: debug session STARTED — handles restart from VS Code toolbar
    context.subscriptions.push(
        vscode.debug.onDidStartDebugSession(session => {
            if (session.name === 'Debug Odoo') {
                utils.setServerState('debugging', session);
            } else if (session.name === 'Run Odoo') {
                utils.setServerState('running', null);
            } else if (session.name === 'Odoo Build') {
                utils.setServerState('building', null);
            }
        })
    );

    // State tracking: terminal closed
    context.subscriptions.push(
        vscode.window.onDidCloseTerminal(terminal => {
            if (terminal === utils.getServerTerminal()) {
                utils.setServerState('stopped', null);
            }
        })
    );

    // State tracking: debug session ended
    context.subscriptions.push(
        vscode.debug.onDidTerminateDebugSession(session => {
            if (session.name === 'Debug Odoo' || session.name === 'Run Odoo' || session === utils.getDebugSession()) {
                utils.setServerState('stopped', null);
                logViewer.onServerStop();
            }
            // Auto-restart after build completes
            if (session.name === 'Odoo Build') {
                utils.setServerState('stopped', null);
                const prev = server.getBuildPrevState();
                if (prev === 'running') server.runOdoo();
                else if (prev === 'debugging') server.debugOdoo();
            }
        })
    );

    // Start log panel tailing when server starts
    utils.onServerStateChange(state => {
        if (state === 'running' || state === 'debugging') logViewer.onServerStart();
        else if (state === 'stopped') logViewer.onServerStop();
    });

    // Config change listener — odooDebugger settings + python interpreter (all strategies)
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('odooDebugger') || e.affectsConfiguration('python')) {
                utilities.updateStatusBar();
                sidebarProvider.refresh();
            }
        })
    );

    // Python extension interpreter change event — multiple strategies for different versions
    try {
        const pyExt = vscode.extensions.getExtension('ms-python.python');
        if (pyExt) {
            // Strategy 1: ms-python >= 2023.x environments API
            const onEnvChanged = pyExt.exports?.environments?.onDidChangeActiveEnvironmentPath
                ?? pyExt.exports?.onDidChangeActiveEnvironmentPath;
            if (onEnvChanged) {
                context.subscriptions.push(
                    onEnvChanged(() => {
                        utilities.updateStatusBar();
                        sidebarProvider.refresh();
                    })
                );
            }
        }
    } catch (_) {}

    // Strategy 3: re-check interpreter when any terminal opens (user may have switched)
    context.subscriptions.push(
        vscode.window.onDidOpenTerminal(() => {
            utilities.updateStatusBar();
            sidebarProvider.refresh();
        })
    );

    // Prevent VS Code from auto-switching to Debug panel when a breakpoint is hit.
    // workbench.debug.openDebug only controls panel auto-reveal — does NOT affect the floating toolbar.
    const debugCfg = vscode.workspace.getConfiguration('workbench.debug');
    const prevOpenDebug = debugCfg.inspect('openDebug')?.workspaceValue;
    debugCfg.update('openDebug', 'neverOpen', vscode.ConfigurationTarget.Workspace);
    context.subscriptions.push({
        dispose: () => debugCfg.update('openDebug', prevOpenDebug, vscode.ConfigurationTarget.Workspace)
    });

    // DB connection test — non-blocking, warn if psql fails
    setTimeout(() => {
        const err = utils.testDbConnection();
        if (err) {
            vscode.window.showWarningMessage(
                `Odoo Debugger: Cannot connect to PostgreSQL (${utils.getDatabase()}). ${err.split('\n')[0]}`,
                'Configure DB Settings'
            ).then(pick => {
                if (pick) vscode.commands.executeCommand('workbench.action.openSettings', 'odooDebugger.db');
            });
        }
    }, 2000);

    // First-run: prompt to configure addons paths
    const configured = utils.getConfig('addonsPaths') || [];
    if (!configured.length) {
        const allDirs = utils.discoverAllAddonsDirs();
        if (allDirs.length) {
            vscode.window.showInformationMessage(
                'Odoo Dev Tools: No addons paths configured. Set them up now?',
                'Configure', 'Later'
            ).then(pick => {
                if (pick === 'Configure') {
                    vscode.commands.executeCommand('odooDebugger.manageAddonsPaths');
                }
            });
        }
    }

    // Cleanup on deactivate
    context.subscriptions.push({ dispose: () => logViewer.dispose() });

    console.log('Odoo Debugger v1.3.5 activated');
}

function deactivate() {
    logViewer.dispose();
}

module.exports = { activate, deactivate };
