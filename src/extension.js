const vscode = require('vscode');
const server = require('./server');
const navigation = require('./navigation');
const utilities = require('./utilities');
const logViewer = require('./logViewer');
const { OdooSidebarProvider } = require('./sidebarPanel');
const utils = require('./utils');

function activate(context) {
    // Status bar
    const statusBar = utilities.createStatusBar();
    context.subscriptions.push(statusBar);

    // Sidebar webview panel (replaces tree views)
    const sidebarProvider = new OdooSidebarProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('odooDev.sidebar', sidebarProvider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    // Register all commands
    const commands = {
        // Server
        'odooDev.runOdoo': server.runOdoo,
        'odooDev.debugOdoo': server.debugOdoo,
        'odooDev.stopOdoo': server.stopOdoo,
        'odooDev.openShell': server.openShell,
        // Logs
        'odooDev.logFilterAll': () => { logViewer.setFilter('ALL'); logViewer.startTailing(); sidebarProvider.refresh(); },
        'odooDev.logFilterError': () => { logViewer.setFilter('ERROR'); logViewer.startTailing(); sidebarProvider.refresh(); },
        'odooDev.logFilterWarning': () => { logViewer.setFilter('WARNING'); logViewer.startTailing(); sidebarProvider.refresh(); },
        'odooDev.logFilterInfo': () => { logViewer.setFilter('INFO'); logViewer.startTailing(); sidebarProvider.refresh(); },
        'odooDev.logFilterDebug': () => { logViewer.setFilter('DEBUG'); logViewer.startTailing(); sidebarProvider.refresh(); },
        // JS Debug
        'odooDev.launchChromeDebug': server.launchChromeDebug,
        'odooDev.attachJsDebugger': server.attachJsDebugger,
        // Modules
        'odooDev.updateModule': server.updateModule,
        'odooDev.installModule': server.installModule,
        'odooDev.updateChangedModules': server.updateChangedModules,
        'odooDev.uninstallModule': server.uninstallModule,
        'odooDev.scaffoldModule': server.scaffoldModule,
        'odooDev.manageAddonsPaths': server.manageAddonsPaths,
        // Navigation
        'odooDev.toggleModelView': navigation.toggleModelView,
        'odooDev.gotoModel': navigation.gotoModel,
        'odooDev.gotoModelFromSelection': navigation.gotoModelFromSelection,
        'odooDev.gotoXmlId': navigation.gotoXmlId,
        'odooDev.gotoXmlIdFromSelection': navigation.gotoXmlIdFromSelection,
        'odooDev.gotoFunctionDef': navigation.gotoFunctionDef,
        'odooDev.gotoFunctionDefAll': navigation.gotoFunctionDefAll,
        'odooDev.currentModuleInfo': navigation.currentModuleInfo,
        // Utilities
        'odooDev.killPython': utilities.killPython,
        'odooDev.startPostgres': utilities.startPostgres,
        'odooDev.openOdoo': utilities.openOdoo,
        'odooDev.openApps': utilities.openApps,
        'odooDev.openDebugMode': utilities.openDebugMode,
        'odooDev.clearAssets': utilities.clearAssets,
        'odooDev.removeUnusedImports': utilities.removeUnusedImports,
        'odooDev.dropDatabase': utilities.dropDatabase,
        'odooDev.copyDatabase': utilities.copyDatabase,
        'odooDev.switchDatabase': utilities.switchDatabase,
    };

    for (const [id, handler] of Object.entries(commands)) {
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    }

    // State tracking: terminal closed
    context.subscriptions.push(
        vscode.window.onDidCloseTerminal(terminal => {
            if (terminal === utils.getServerTerminal()) {
                utils.setServerState('stopped', null);
                logViewer.stopTerminalCapture();
            }
        })
    );

    // State tracking: debug session ended
    context.subscriptions.push(
        vscode.debug.onDidTerminateDebugSession(session => {
            if (session.name === 'Debug Odoo' || session.name === 'Run Odoo' || session === utils.getDebugSession()) {
                utils.setServerState('stopped', null);
                logViewer.stopTerminalCapture();
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

    // Start terminal log capture when server state changes to running
    utils.onServerStateChange(state => {
        if (state === 'running') {
            logViewer.clearCaptured();
            logViewer.startTerminalCapture();
        }
    });

    // Config change listener
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('odooDev')) {
                utilities.updateStatusBar();
                sidebarProvider.refresh();
            }
        })
    );

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
                    vscode.commands.executeCommand('odooDev.manageAddonsPaths');
                }
            });
        }
    }

    // Cleanup on deactivate
    context.subscriptions.push({ dispose: () => logViewer.dispose() });

    console.log('Odoo Dev Tools v0.3.0 activated');
}

function deactivate() {
    logViewer.dispose();
}

module.exports = { activate, deactivate };
