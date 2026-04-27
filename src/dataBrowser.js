const vscode = require('vscode');
const { execSync } = require('child_process');
const utils = require('./utils');

// ── psql query runner ──────────────────────────────────────────────

function runQuery(sql) {
    const { args, env } = utils.buildPsqlArgs();
    try {
        const out = execSync(
            `psql ${args.map(a => JSON.stringify(a)).join(' ')} --csv -c ${JSON.stringify(sql)}`,
            { encoding: 'utf8', timeout: 10000, env }
        );
        return parseCsv(out.trim());
    } catch (e) {
        throw new Error(e.stderr || e.message);
    }
}

function parseCsv(text) {
    if (!text) return { columns: [], rows: [] };
    const lines = text.split('\n').filter(Boolean);
    if (!lines.length) return { columns: [], rows: [] };
    const columns = splitCsvLine(lines[0]);
    const rows = lines.slice(1).map(l => splitCsvLine(l));
    return { columns, rows };
}

function splitCsvLine(line) {
    const result = [];
    let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
            else inQuote = !inQuote;
        } else if (c === ',' && !inQuote) {
            result.push(cur); cur = '';
        } else {
            cur += c;
        }
    }
    result.push(cur);
    return result;
}

// ── Webview panel ──────────────────────────────────────────────────

let _panel = null;

function openDataBrowser(title, sql, context) {
    if (_panel) {
        _panel.reveal(vscode.ViewColumn.One);
    } else {
        _panel = vscode.window.createWebviewPanel(
            'odooDataBrowser',
            title,
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        _panel.onDidDispose(() => { _panel = null; });
    }
    _panel.title = title;
    _panel.webview.html = _getLoadingHtml(title);

    // Handle messages from webview
    _panel.webview.onDidReceiveMessage(async msg => {
        if (msg.type === 'query') {
            try {
                const result = runQuery(msg.sql);
                _panel.webview.postMessage({ type: 'result', result, sql: msg.sql });
            } catch (e) {
                _panel.webview.postMessage({ type: 'error', message: e.message });
            }
        } else if (msg.type === 'openInOdoo') {
            const port = utils.getPort();
            vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}/odoo?debug=1#id=${msg.id}&model=${msg.model}&view_type=form`));
        } else if (msg.type === 'copyCell') {
            vscode.env.clipboard.writeText(msg.value);
        }
    });

    // Initial query
    try {
        const result = runQuery(sql);
        _panel.webview.html = _getPanelHtml(title, result, sql, context);
    } catch (e) {
        _panel.webview.html = _getErrorHtml(title, e.message, sql);
    }
}

function _getLoadingHtml(title) {
    return `<!DOCTYPE html><html><body style="padding:20px;font-family:var(--vscode-font-family);color:var(--vscode-foreground)">
    <h3>${title}</h3><p>Loading...</p></body></html>`;
}

function _getErrorHtml(title, error, sql) {
    return `<!DOCTYPE html><html><body style="padding:20px;font-family:var(--vscode-font-family);color:var(--vscode-foreground)">
    <h3>${title}</h3>
    <div style="color:#f48771;background:#5a1d1d;padding:12px;border-radius:4px;margin:8px 0">${escHtml(error)}</div>
    <pre style="opacity:0.6;font-size:11px">${escHtml(sql)}</pre>
    </body></html>`;
}

function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _getPanelHtml(title, result, initialSql, context) {
    const { columns, rows } = result;
    const db = utils.getDatabase();
    const hasId = columns.includes('id');
    const modelName = context?.modelName || '';

    return `<!DOCTYPE html>
<html>
<head>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family); font-size: 13px; color: var(--vscode-foreground); background: var(--vscode-editor-background); display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
.toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--vscode-widget-border, #3c3c3c); flex-shrink: 0; flex-wrap: wrap; }
.toolbar h3 { font-size: 13px; font-weight: 600; margin-right: 4px; white-space: nowrap; }
.toolbar input { flex: 1; min-width: 160px; padding: 4px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #3c3c3c); border-radius: 3px; font-size: 12px; font-family: inherit; }
.toolbar input:focus { outline: 1px solid var(--vscode-focusBorder); }
.toolbar button { padding: 4px 10px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid var(--vscode-widget-border, #3c3c3c); border-radius: 3px; cursor: pointer; font-size: 12px; white-space: nowrap; }
.toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground); }
.toolbar button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
.toolbar .count { font-size: 11px; opacity: 0.7; white-space: nowrap; }
.sql-bar { display: flex; gap: 6px; padding: 6px 12px; background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--vscode-widget-border, #3c3c3c); flex-shrink: 0; }
.sql-bar input { flex: 1; padding: 4px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #3c3c3c); border-radius: 3px; font-size: 12px; font-family: monospace; }
.table-wrap { flex: 1; overflow: auto; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
thead { position: sticky; top: 0; z-index: 1; }
th { background: var(--vscode-sideBar-background); padding: 6px 10px; text-align: left; font-weight: 600; border-bottom: 2px solid var(--vscode-widget-border, #3c3c3c); white-space: nowrap; cursor: pointer; user-select: none; }
th:hover { background: var(--vscode-list-hoverBackground); }
td { padding: 5px 10px; border-bottom: 1px solid var(--vscode-widget-border, #3c3c3c22); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
tr:hover td { background: var(--vscode-list-hoverBackground); }
tr:hover .row-actions { opacity: 1; }
.row-actions { opacity: 0; display: flex; gap: 4px; }
.row-actions button { padding: 1px 6px; font-size: 11px; }
.empty { padding: 20px; opacity: 0.6; font-style: italic; }
.error { color: #f48771; padding: 12px; }
</style>
</head>
<body>
<div class="toolbar">
    <h3>${escHtml(title)}</h3>
    <input id="search" placeholder="Search (WHERE filter)..." value="" />
    <button class="primary" onclick="applySearch()">Search</button>
    <button onclick="resetQuery()">Reset</button>
    <span class="count" id="count">${rows.length} rows</span>
</div>
<div class="sql-bar">
    <input id="sqlInput" value="${escHtml(initialSql)}" placeholder="Custom SQL..." onkeydown="if(event.key==='Enter') runCustomSql()" />
    <button onclick="runCustomSql()">▶ Run</button>
</div>
<div class="table-wrap">
    <div id="tableContainer"></div>
</div>

<script>
const vscode = acquireVsCodeApi();
let _data = ${JSON.stringify({ columns, rows })};
let _baseSql = ${JSON.stringify(initialSql)};
let _modelName = ${JSON.stringify(modelName)};
let _sortCol = -1, _sortAsc = true;

function render(data) {
    _data = data;
    document.getElementById('count').textContent = data.rows.length + ' rows';
    const cols = data.columns;
    const rows = data.rows;
    if (!cols.length) { document.getElementById('tableContainer').innerHTML = '<div class="empty">No results</div>'; return; }
    const hasId = cols.includes('id');
    const idIdx = cols.indexOf('id');
    let html = '<table><thead><tr>';
    cols.forEach((c, i) => { html += '<th onclick="sortBy(' + i + ')">' + esc(c) + (_sortCol===i ? (_sortAsc?' ↑':' ↓'):'') + '</th>'; });
    if (hasId && _modelName) html += '<th></th>';
    html += '</tr></thead><tbody>';
    rows.forEach(row => {
        html += '<tr>';
        row.forEach(cell => { html += '<td title="' + esc(cell) + '" ondblclick="copyCell(this)">' + esc(cell) + '</td>'; });
        if (hasId && _modelName) {
            const id = row[idIdx];
            html += '<td><div class="row-actions"><button onclick="openInOdoo(' + esc(id) + ')">Open</button></div></td>';
        }
        html += '</tr>';
    });
    html += '</tbody></table>';
    document.getElementById('tableContainer').innerHTML = html;
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function sortBy(colIdx) {
    if (_sortCol === colIdx) _sortAsc = !_sortAsc;
    else { _sortCol = colIdx; _sortAsc = true; }
    const sorted = [..._data.rows].sort((a, b) => {
        const av = a[colIdx] || '', bv = b[colIdx] || '';
        const n = parseFloat(av) - parseFloat(bv);
        const cmp = isNaN(n) ? av.localeCompare(bv) : n;
        return _sortAsc ? cmp : -cmp;
    });
    render({ columns: _data.columns, rows: sorted });
}

function applySearch() {
    const term = document.getElementById('search').value.trim();
    if (!term) { runSql(_baseSql); return; }
    // Inject WHERE clause — simple approach: wrap as subquery
    const sql = 'SELECT * FROM (' + _baseSql + ') _q WHERE CAST(_q::text AS text) ILIKE ' + "'%" + term.replace(/'/g,"''") + "%'";
    runSql(sql);
}

function resetQuery() {
    document.getElementById('search').value = '';
    document.getElementById('sqlInput').value = _baseSql;
    runSql(_baseSql);
}

function runCustomSql() {
    const sql = document.getElementById('sqlInput').value.trim();
    if (sql) runSql(sql);
}

function runSql(sql) {
    document.getElementById('tableContainer').innerHTML = '<div class="empty">Running...</div>';
    vscode.postMessage({ type: 'query', sql });
}

function openInOdoo(id) { vscode.postMessage({ type: 'openInOdoo', id, model: _modelName }); }
function copyCell(td) { vscode.postMessage({ type: 'copyCell', value: td.title }); }

window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'result') {
        if (msg.sql !== _baseSql) document.getElementById('sqlInput').value = msg.sql;
        render(msg.result);
    } else if (msg.type === 'error') {
        document.getElementById('tableContainer').innerHTML = '<div class="error">' + esc(msg.message) + '</div>';
    }
});

render(_data);
document.getElementById('search').addEventListener('keydown', e => { if (e.key === 'Enter') applySearch(); });
</script>
</body>
</html>`;
}

// ── Public API ─────────────────────────────────────────────────────

function browseModel(modelName) {
    const table = modelName.replace(/\./g, '_');
    // Get columns first to build a smart query
    let sql;
    try {
        const cols = runQuery(`SELECT column_name FROM information_schema.columns WHERE table_name='${table}' ORDER BY ordinal_position LIMIT 20`);
        const colNames = cols.rows.map(r => r[0]);
        // Pick useful columns: id, name/display_name, state, active, create_date — skip binary/text blobs
        const skip = ['arch', 'arch_base', 'arch_db', 'arch_fs', 'arch_prev', 'website_description', 'description_html'];
        const selected = colNames.filter(c => !skip.includes(c)).slice(0, 12);
        sql = `SELECT ${selected.join(', ')} FROM ${table} LIMIT 100`;
    } catch (_) {
        sql = `SELECT * FROM ${table} LIMIT 100`;
    }
    openDataBrowser(`Records: ${modelName}`, sql, { modelName });
}

function browseField(modelName, fieldName, fieldType) {
    const table = modelName.replace(/\./g, '_');
    const sql = `SELECT id, ${fieldName} FROM ${table} WHERE ${fieldName} IS NOT NULL LIMIT 100`;
    openDataBrowser(`Field: ${modelName}.${fieldName} (${fieldType})`, sql, { modelName });
}

function runSqlQuery(sql) {
    if (!sql) return;
    openDataBrowser('SQL Result', sql, {});
}

module.exports = { browseModel, browseField, runSqlQuery, runQuery };
