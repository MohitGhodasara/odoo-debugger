const vscode = require('vscode');
const utils = require('./utils');
const dataBrowser = require('./dataBrowser');

const CTX_SQL_FILTER = 'odooDebuggerSqlFilterActive';

// ── Tree items ─────────────────────────────────────────────────────

class SectionItem extends vscode.TreeItem {
    constructor(label, id, icon, collapsible = vscode.TreeItemCollapsibleState.Collapsed) {
        super(label, collapsible);
        this._id = id;
        this.contextValue = 'sqlSection_' + id;
        this.iconPath = new vscode.ThemeIcon(icon);
    }
}

class TableItem extends vscode.TreeItem {
    constructor(tableName) {
        super(tableName, vscode.TreeItemCollapsibleState.None);
        this.tableName = tableName;
        this.tooltip = tableName;
        this.contextValue = 'sqlTable';
        this.iconPath = new vscode.ThemeIcon('table');
        this.command = { command: 'odooDebugger.sqlTools.browseTable', title: 'Browse Table', arguments: [tableName] };
    }
}

class HistoryItem extends vscode.TreeItem {
    constructor(sql, index) {
        const label = sql.length > 60 ? sql.substring(0, 60) + '…' : sql;
        super(label, vscode.TreeItemCollapsibleState.None);
        this.sql = sql;
        this.index = index;
        this.tooltip = sql;
        this.contextValue = 'sqlHistory';
        this.iconPath = new vscode.ThemeIcon('history');
        this.command = { command: 'odooDebugger.sqlTools.runHistoryItem', title: 'Run', arguments: [sql] };
    }
}

// ── Provider ───────────────────────────────────────────────────────

class SqlToolsProvider {
    constructor(context) {
        this._context = context;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this._tableCache = null; // all tables from DB
        this._filter = '';
    }

    refresh() {
        this._tableCache = null;
        this._onDidChangeTreeData.fire();
    }

    setFilter(text) {
        this._filter = text.trim().toLowerCase();
        vscode.commands.executeCommand('setContext', CTX_SQL_FILTER, this._filter.length > 0);
        this._onDidChangeTreeData.fire();
    }

    clearFilter() { this.setFilter(''); }

    getTreeItem(el) { return el; }

    getChildren(element) {
        if (!element) return this._getRoots();
        if (element._id === 'tables') return this._getTables();
        if (element._id === 'history') return this._getHistory();
        return [];
    }

    _getRoots() {
        const db = utils.getDatabase() || 'not configured';
        const history = this._getHistoryItems();
        const tables = this._getFilteredTables();
        const tableLabel = this._filter
            ? `Tables — ${db} (${tables.length} matches)`
            : `Tables — ${db}`;
        return [
            new SectionItem(tableLabel, 'tables', 'table'),
            new SectionItem(`History (${history.length})`, 'history', 'history'),
        ];
    }

    _getTables() {
        return this._getFilteredTables();
    }

    _getFilteredTables() {
        const all = this._getAllTables();
        if (!this._filter) return all;
        return all.filter(t => t.tableName.includes(this._filter));
    }

    _getAllTables() {
        if (this._tableCache) return this._tableCache;
        try {
            const result = dataBrowser.runQuery(
                `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`
            );
            this._tableCache = result.rows.map(r => new TableItem(r[0]));
            return this._tableCache;
        } catch (e) {
            const err = new vscode.TreeItem(`Error: ${e.message}`);
            err.iconPath = new vscode.ThemeIcon('error');
            return [err];
        }
    }

    _getHistory() {
        return this._getHistoryItems().map((sql, i) => new HistoryItem(sql, i));
    }

    _getHistoryItems() {
        return this._context.workspaceState.get('sqlHistory', []);
    }

    addToHistory(sql) {
        const history = this._getHistoryItems().filter(s => s !== sql);
        history.unshift(sql);
        this._context.workspaceState.update('sqlHistory', history.slice(0, 20));
        this._onDidChangeTreeData.fire();
    }

    clearHistory() {
        this._context.workspaceState.update('sqlHistory', []);
        this._onDidChangeTreeData.fire();
    }
}

// ── Commands ───────────────────────────────────────────────────────

async function runSql(provider) {
    const sql = await vscode.window.showInputBox({
        title: 'Run SQL',
        placeHolder: 'SELECT * FROM res_partner LIMIT 10',
        prompt: `Database: ${utils.getDatabase() || 'not configured'}`,
    });
    if (!sql?.trim()) return;
    provider.addToHistory(sql.trim());
    dataBrowser.runSqlQuery(sql.trim());
}

async function filterTables(provider) {
    const input = await vscode.window.showInputBox({
        title: 'Filter Tables',
        placeHolder: 'e.g. res_partner or account',
        value: provider._filter,
        prompt: 'Substring match on table name',
    });
    if (input === undefined) return;
    provider.setFilter(input);
}

async function browseTable(tableName) {
    const sql = `SELECT * FROM ${tableName} LIMIT 100`;
    dataBrowser.runSqlQuery(sql);
}

async function showTableColumns(tableName) {
    try {
        const result = dataBrowser.runQuery(
            `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='${tableName}' ORDER BY ordinal_position`
        );
        const items = result.rows.map(r => ({
            label: r[0],
            description: r[1],
            detail: r[2] === 'YES' ? 'nullable' : 'not null',
        }));
        const pick = await vscode.window.showQuickPick(items, {
            title: `Columns: ${tableName}`,
            placeHolder: 'Select a column to copy its name',
        });
        if (pick) vscode.env.clipboard.writeText(pick.label);
    } catch (e) {
        vscode.window.showErrorMessage(`Failed: ${e.message}`);
    }
}

async function copySelectStatement(tableName) {
    const sql = `SELECT * FROM ${tableName} LIMIT 100;`;
    await vscode.env.clipboard.writeText(sql);
    vscode.window.showInformationMessage(`Copied: ${sql}`);
}

module.exports = {
    SqlToolsProvider, CTX_SQL_FILTER,
    runSql, filterTables, browseTable, showTableColumns, copySelectStatement,
};
