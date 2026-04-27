const vscode = require('vscode');
const path = require('path');

class BreakpointItem extends vscode.TreeItem {
    constructor(bp, index) {
        const uri = bp.location.uri;
        const line = bp.location.range.start.line + 1;
        const fname = path.basename(uri.fsPath);
        super(`${fname}:${line}`, vscode.TreeItemCollapsibleState.None);

        this.bpIndex = index;
        this.bp = bp;
        this.description = bp.condition ? `if ${bp.condition}` : path.dirname(uri.fsPath).split(path.sep).slice(-2).join('/');
        this.tooltip = `${uri.fsPath}:${line}${bp.condition ? `\nCondition: ${bp.condition}` : ''}`;
        this.contextValue = bp.enabled ? 'breakpointEnabled' : 'breakpointDisabled';
        this.iconPath = new vscode.ThemeIcon(
            bp.enabled ? 'circle-filled' : 'circle-outline',
            new vscode.ThemeColor(bp.enabled ? 'debugIcon.breakpointForeground' : 'disabledForeground')
        );
        this.command = {
            command: 'odooDebugger.breakpoints.goto',
            title: 'Go to Breakpoint',
            arguments: [bp],
        };
    }
}

class BreakpointExplorerProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;

        vscode.debug.onDidChangeBreakpoints(() => this._onDidChangeTreeData.fire());
    }

    refresh() { this._onDidChangeTreeData.fire(); }

    getTreeItem(element) { return element; }

    getChildren() {
        const bps = vscode.debug.breakpoints.filter(bp => bp instanceof vscode.SourceBreakpoint);
        if (!bps.length) {
            const empty = new vscode.TreeItem('No breakpoints set');
            empty.iconPath = new vscode.ThemeIcon('info');
            return [empty];
        }
        return bps.map((bp, i) => new BreakpointItem(bp, i));
    }
}

// ── Commands ───────────────────────────────────────────────────────

async function gotoBreakpoint(bp) {
    if (!(bp instanceof vscode.SourceBreakpoint)) return;
    try {
        const doc = await vscode.workspace.openTextDocument(bp.location.uri);
        const editor = await vscode.window.showTextDocument(doc);
        const pos = bp.location.range.start;
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    } catch (_) {}
}

function toggleBreakpoint(bp) {
    if (!(bp instanceof vscode.SourceBreakpoint)) return;
    const newBp = new vscode.SourceBreakpoint(bp.location, !bp.enabled, bp.condition, bp.hitCondition, bp.logMessage);
    vscode.debug.removeBreakpoints([bp]);
    vscode.debug.addBreakpoints([newBp]);
}

function removeBreakpoint(bp) {
    if (bp instanceof vscode.SourceBreakpoint) vscode.debug.removeBreakpoints([bp]);
}

function enableAllBreakpoints() {
    const bps = vscode.debug.breakpoints.filter(bp => bp instanceof vscode.SourceBreakpoint && !bp.enabled);
    const newBps = bps.map(bp => new vscode.SourceBreakpoint(bp.location, true, bp.condition, bp.hitCondition, bp.logMessage));
    vscode.debug.removeBreakpoints(bps);
    vscode.debug.addBreakpoints(newBps);
}

function disableAllBreakpoints() {
    const bps = vscode.debug.breakpoints.filter(bp => bp instanceof vscode.SourceBreakpoint && bp.enabled);
    const newBps = bps.map(bp => new vscode.SourceBreakpoint(bp.location, false, bp.condition, bp.hitCondition, bp.logMessage));
    vscode.debug.removeBreakpoints(bps);
    vscode.debug.addBreakpoints(newBps);
}

function clearAllBreakpoints() {
    vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
}

module.exports = {
    BreakpointExplorerProvider,
    gotoBreakpoint, toggleBreakpoint, removeBreakpoint,
    enableAllBreakpoints, disableAllBreakpoints, clearAllBreakpoints,
};
