# Odoo Debugger

Your Odoo development workflow, entirely inside VS Code. Run and debug the server, watch live logs with filtering, update modules, explore models and fields, browse database records — without leaving your editor or touching a terminal.

---

## Setup Guide

### Step 1 — Install the extension

Install from the VS Code marketplace. `ms-python.debugpy` is automatically installed as a dependency.

---

### Step 2 — Select Python interpreter

Press `Ctrl+Shift+P` → **Python: Select Interpreter** → pick your Odoo virtualenv (e.g. `/home/user/envs/odoo18-env/bin/python`).

The extension reads the interpreter automatically from VS Code's Python extension — no separate setting needed.

---

### Step 3 — Point to your Odoo conf file *(recommended)*

If you have an `.odoorc` or `odoo.conf` file, set it once and everything else is auto-configured:

```json
"odooDebugger.configFile": "/path/to/.odoorc"
```

The extension reads `db_name`, `db_host`, `db_port`, `db_user`, `db_password`, `addons_path`, and `http_port` directly from the conf file. You don't need to set any of those separately.

> **Without a conf file:** Set `odooDebugger.database` to your DB name manually.

---

### Step 4 — Configure addons paths

Click the **folder icon** in the Odoo Debugger panel title bar → **Manage Addons Paths**.

Select **all** directories you want Odoo to load modules from — including community addons if needed. The picker shows paths discovered from your conf file, workspace, and `odoo-bin` location as suggestions, but nothing is included automatically.

```json
"odooDebugger.addonsPaths": [
    "/path/to/odoo/community/addons",
    "/path/to/custom-addons"
]
```

> If your conf file already has `addons_path` set with all the paths you need, this step is optional — the extension reads it automatically as a fallback when `addonsPaths` is empty.

---

### Step 5 — Run Odoo

Press `Ctrl+Shift+R` or click **▶ Run** in the panel.

The launch command is built automatically:
```
odoo-bin --addons-path=... -c /path/to/.odoorc
```

When the server starts writing logs, the **Odoo Logs** panel opens automatically at the bottom.

---

### Optional — Disable the log panel

The log panel injects `--logfile` into every launch. If you prefer to use the terminal output only, disable it:
```json
"odooDebugger.logPanel.enabled": false
```

When disabled: no `--logfile` argument is added, zero overhead, terminal behaves as normal.

---

### Optional — Extra launch arguments

Add any odoo-bin arguments via `extraArgs`:
```json
"odooDebugger.extraArgs": ["--dev=all", "--workers=0"]
```

Default is empty — the conf file handles everything.

---

### Optional — Database connection (without conf file)

```json
"odooDebugger.database":   "odoo18",
"odooDebugger.dbHost":     "localhost",
"odooDebugger.dbPort":     "5432",
"odooDebugger.dbUser":     "odoo",
"odooDebugger.dbPassword": "odoo"
```

---

### Optional — JS debugging

Chrome is auto-detected. If not found:
```json
"odooDebugger.chromePath": "/usr/bin/google-chrome"
```

---

## Panel Layout

The extension adds an **Odoo Debugger** icon to the activity bar with these sections:

| Section | Purpose |
|---|---|
| **Odoo Debugger** | Server controls, module actions, logs, tools |
| **Model Explorer** | Browse all models, fields, methods — navigate to definitions |
| **SQL Tools** | Browse tables, run queries, view history |
| **Breakpoints** | Manage all breakpoints in one place |
| **Odoo Logs** | Live log panel at the bottom (next to Terminal) |

---

## Features

### Server Management

- **Run** (`Ctrl+Shift+R`) — Starts Odoo via debugpy in noDebug mode. Logs go to the Odoo Logs panel
- **Debug** (`Ctrl+Shift+D`) — Full debugpy session with breakpoints active
- **Stop** (`Ctrl+Shift+S`) — Stops the running server
- **Restart** — Stops and re-launches in the same mode (Run or Debug)
- **Starting...** state — Sidebar shows `⟳ Starting...` immediately on button press so you know it registered
- When server is active, the Run/Debug buttons are replaced by a **debug toolbar** matching VS Code's native debugpy toolbar style:
  - Run mode: Continue/Step buttons disabled (no debugger), Restart + Stop active
  - Debug mode: All 6 buttons active — Continue, Step Over, Step Into, Step Out, Restart, Stop
- Auto-stops server before update/install, auto-restarts after build completes
- Status badge: `▶ Running` / `● Debugging` / `⟳ Starting...` / `► Building...` / `■ Stopped`

### Log Panel (Odoo Logs)

A dedicated panel tab at the bottom (next to Terminal/Output) that tails the Odoo log file in real time:

- **Auto-opens** when the first log line arrives — no manual action needed
- **Filter buttons** — ALL / CRITICAL / ERROR / WARNING / INFO / DEBUG
  - Always colored: CRITICAL=dark red, ERROR=salmon, WARNING=yellow, INFO=green, DEBUG=blue
  - Active filter = filled solid background
  - Count shown on button when errors/warnings exist: `ERROR(3)`, `WARN(12)`
- **Search** — Live search with highlight. Filters visible lines as you type
- **▲ Err / ▼ Err** — Jump to previous/next ERROR or CRITICAL line
- **Wrap** — Toggle line wrapping for long SQL/XML lines
- **⬇ Auto / ⏸ Locked** — Auto-scroll toggle. Scrolling up auto-locks
- **Traceback grouping** — Consecutive traceback lines collapsed into one clickable group showing the last line (the actual error). Click `▶` to expand
- **Navigate to file** — `File "/path/file.py", line 42` in tracebacks are clickable links → opens file at that line
- **Copy line** — Hover any line → `copy` button appears
- **Log colors** match Odoo's own logger:
  - CRITICAL: white text on dark red background
  - ERROR: salmon `#f48771`
  - WARNING: yellow `#cca700`
  - INFO: green `#89d185`
  - DEBUG: blue `#75beff`
- **Truncated on restart** — Log file cleared on every server start, panel resets
- **Disable** — Set `odooDebugger.logPanel.enabled: false` for zero overhead (no `--logfile` injected)
- **Custom log path** — `odooDebugger.logPanel.logFile` (default `/tmp/odoo-vscode.log`)

### Module Management

- **Update** (`Ctrl+Shift+U`) — QuickPick with git-changed modules shown first
- **Install** (`Ctrl+Shift+I`) — Same picker, runs `--init`
- **Changed** (`Ctrl+Shift+G`) — Auto-detects modules with uncommitted or staged git changes. Works with flat repos (`module/file.py`) and nested repos (`addons/module/file.py`). Falls back to workspace root if no addons paths configured
- **Uninstall** — Opens Odoo shell with uninstall command pre-filled
- **Scaffold** — Generates full module: manifest, model, views (form/tree/search), security CSV, menu, action

### Model Explorer

Tree view showing all models from your configured addons:

- **Merged inheritance** — `_name` and `_inherit` sources merged into one node per model
- **Model type icons** — Regular / TransientModel (wizard) / AbstractModel
- **Filter by type** — `$(filter)` button
- **Sort** — Alphabetical or Recently Modified
- **Group by module** — Toggle grouped/flat view
- **Cursor auto-reveal** — Moving cursor in `.py` or `.xml` highlights matching model/field/method
- **Copy Model Name** — Right-click any model → copies `res.partner` to clipboard. Also available as inline icon button

**Fields** (expand model):
- Type-specific icons, click to navigate to definition
- Inline: Find in XML, Browse Values

**Methods** (collapsible folder):
- Decorator-aware icons, click to navigate
- Inline: Find Usages

**Right-click model:** Go to XML View, Open in Browser, Browse Records, Copy Model Name

**Right-click field:** Find in XML, Browse Field Values

**Right-click method:** Find Method Usages

### Quick Find (`Ctrl+Alt+N`)

Live search picker with compound syntax:

| Input | Result |
|---|---|
| `res.partner` | Models matching name |
| `@name` | Models with field starting with `name` |
| `#action` | Models with method starting with `action` |
| `:sale` | Models from module `sale` |
| `res.partner@name` | Fields in `res.partner` only |
| `res.partner#action` | Methods in `res.partner` only |

### Navigation

- **Toggle Py ↔ XML** (`Ctrl+Shift+T`) — Jump between model `.py` and `_views.xml`
- **Go to Model** (`Ctrl+Shift+M`) — Find `_name = 'model.name'` from word under cursor
- **Go to XML ID** (`Ctrl+Shift+X`) — Find `id="xml_id"` from word under cursor
- **Go to Function Def** (`Ctrl+Shift+.`) — Find original definition, skipping `super()` overrides
- **Go to All Definitions** — All definitions in a QuickPick
- **Current Module Info** — Shows module name, version, depends from manifest

### Data Browser

Interactive table in an editor tab:

- Browse model records or field values from DB
- Sortable columns, `%term%` search, custom SQL bar
- Open in Odoo (form view), copy cell on double-click

### SQL Tools

- **Tables** — All public tables, filterable. Browse, show columns, copy SELECT
- **History** — Last 20 queries, click to re-run
- **Run SQL** (`Ctrl+Shift+Q`) — Result in data browser

### Database Tools

- **Switch Database** — Lists all PostgreSQL DBs + manual entry
- **Copy Database** — `createdb -T source newname`
- **Drop Database** — With confirmation
- **Clear Asset Bundles** — Deletes `/web/assets/*` attachments
- **Open Odoo** (`Ctrl+Shift+B`), **Open Apps**, **Debug Mode URL**

### Odoo Shell (`Ctrl+Shift+O`)

Interactive Odoo shell via debugpy in the integrated terminal.

### Open Config File

Click the gear icon in the sidebar title bar to open your `.odoorc` directly in the editor.

### JS Debugging

- **Launch Chrome Debug** — Opens Chrome with remote debugging, navigates to Odoo with `?debug=assets`
- **Attach JS Debugger** — Attaches VS Code to Chrome, auto-generates `pathMapping` for all addons

### Breakpoints

Tree view with all breakpoints — enable/disable/remove, Enable All / Disable All / Clear All.

---

## Keyboard Shortcuts

| Shortcut | Action | When |
|---|---|---|
| `Ctrl+Shift+R` | Run Odoo | Always |
| `Ctrl+Shift+D` | Debug Odoo | When editor not focused |
| `Ctrl+Shift+S` | Stop Odoo | Always |
| `Ctrl+Shift+U` | Update Module | Always |
| `Ctrl+Shift+I` | Install Module | When editor not focused |
| `Ctrl+Shift+G` | Update Changed Modules | When editor not focused |
| `Ctrl+Shift+B` | Open Odoo in Browser | When editor not focused |
| `Ctrl+Shift+O` | Open Odoo Shell | When editor not focused |
| `Ctrl+Shift+Q` | Run SQL | Always |
| `Ctrl+Shift+M` | Go to Model (word/selection) | Editor text focus |
| `Ctrl+Shift+X` | Go to XML ID (word/selection) | Editor text focus |
| `Ctrl+Shift+T` | Toggle Py ↔ XML | `.py` or `.xml` file focused |
| `Ctrl+Shift+.` | Go to Function Definition | Editor text focus |
| `Ctrl+Alt+N` | Quick Find | Always |
| `Ctrl+Alt+E` | Focus Odoo Debugger Panel | Always |

---

## Settings Reference

| Setting | Default | Description |
|---|---|---|
| `odooDebugger.configFile` | `.odoorc` | Odoo conf file. DB details, addons_path, port auto-read from it |
| `odooDebugger.database` | `` | DB name override (auto-read from conf file if set) |
| `odooDebugger.addonsPaths` | `[]` | Addons directories. Auto-discovered from conf file if empty |
| `odooDebugger.odooBinPath` | `` | Path to `odoo-bin`. Auto-detected in workspace if empty |
| `odooDebugger.venvPath` | `` | Python interpreter override. Auto-detected from VS Code if empty |
| `odooDebugger.port` | `8069` | Odoo HTTP port |
| `odooDebugger.extraArgs` | `[]` | Extra odoo-bin args e.g. `["--dev=all"]` |
| `odooDebugger.debugOptions` | `{justMyCode:false, subProcess:false}` | debugpy launch options |
| `odooDebugger.dbHost` | `` | PostgreSQL host |
| `odooDebugger.dbPort` | `` | PostgreSQL port |
| `odooDebugger.dbUser` | `` | PostgreSQL user |
| `odooDebugger.dbPassword` | `` | PostgreSQL password |
| `odooDebugger.logPanel.enabled` | `true` | Enable Odoo Logs panel. False = no `--logfile`, zero overhead |
| `odooDebugger.logPanel.logFile` | `/tmp/odoo-vscode.log` | Log file path. Truncated on every server start |
| `odooDebugger.modelExplorer.sources` | `[]` | Addons dirs to scan. Empty = uses addonsPaths |
| `odooDebugger.modelExplorer.groupByModule` | `true` | Group by module or flat |
| `odooDebugger.modelExplorer.sortOrder` | `alpha` | `alpha` or `recent` |
| `odooDebugger.upgradeScript` | `` | Custom upgrade script. Used instead of odoo-bin if set |
| `odooDebugger.chromePath` | `` | Chrome binary. Auto-detected if empty |
| `odooDebugger.chromeDebugPort` | `9222` | Chrome remote debugging port |

---

## Requirements

- VS Code `1.85.0` or later
- `ms-python.debugpy` extension (auto-installed)
- Python with Odoo dependencies installed
- PostgreSQL with `psql` on PATH (for SQL Tools and DB management)
- Odoo source with `odoo-bin` (auto-detected in workspace)

---

## License

MIT © Mohit Ghodasara
