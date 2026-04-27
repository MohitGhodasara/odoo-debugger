# Odoo Debugger

All-in-one Odoo development toolkit for VS Code. Run, debug, update modules, explore models, browse database records, navigate code, and manage your entire Odoo workflow — all from a single activity bar panel.

---

## Panel Layout

The extension adds an **Odoo Debugger** icon to the activity bar with four sections:

| Section | Purpose |
|---|---|
| **Odoo Debugger** | Server controls, module actions, logs, tools |
| **Model Explorer** | Browse all models and fields, navigate to definitions |
| **SQL Tools** | Browse tables, run queries, view history |
| **Breakpoints** | Manage all breakpoints in one place |

---

## Features

### Server Management

- **Run Odoo** (`Ctrl+Shift+R`) — Start server via debugpy with `noDebug` mode (no debug panel clutter)
- **Debug Odoo** (`Ctrl+Shift+D`) — Full debugpy session with breakpoints active
- **Stop Odoo** (`Ctrl+Shift+S`) — Stop running or debugging server
- Auto-stops server before update/install, auto-restarts after build completes
- Status badge in panel header: `▶ Running` / `● Debugging` / `► Building...` / `■ Stopped`
- Status bar item shows current DB and server state, click to switch database

### Module Management

- **Update Module** (`Ctrl+Shift+U`) — QuickPick with git-changed modules shown first
- **Install Module** (`Ctrl+Shift+I`) — Same picker, runs `--init`
- **Update Changed** (`Ctrl+Shift+G`) — Auto-detects modules with uncommitted git changes across all repos
- **Uninstall Module** — Opens Odoo shell with the uninstall command pre-filled
- **Scaffold New Module** — Generates full module structure: manifest, model, views, security CSV, menu items
- **Manage Addons Paths** — Multi-select from auto-discovered dirs + browse for any custom folder

### Navigation

- **Toggle Py ↔ XML** (`Ctrl+Shift+T`) — Jump between model file and its views XML (works in `.py` and `.xml` files)
- **Go to Model** (`Ctrl+Shift+M`) — Find `_name = 'model.name'` definition from word under cursor
- **Go to XML ID** (`Ctrl+Shift+X`) — Find `id="xml_id"` in XML files from word under cursor
- **Go to Function Def** (`Ctrl+Shift+.`) — Find original function definition, skipping `super()` overrides
- **Go to All Definitions** — Shows all definitions of a function across the codebase in a QuickPick
- All navigation commands work on **word under cursor** — no text selection needed
- All available in **right-click context menu** under the `Odoo` group

### Model Explorer

A tree view showing all models from your configured addons directories:

- **Merged inheritance** — Models defined with `_name` and extended with `_inherit` are merged into one node. Each source file shown separately with `✦ defined` or `↳ inherit` indicator
- **Lazy field loading** — Expand a model to see all its fields with type as description
- **Click to navigate** — Click any model or field to jump to its exact definition line
- **Cursor auto-reveal** — Moving cursor in a `.py` or `.xml` file automatically highlights the matching model in the tree (debounced 300ms, only when tree is visible)
- **Search / Filter** (`$(search)` button) — Filter by model name or module name, substring match. Active filter shown in tree description with match count
- **Configure Sources** (`$(settings-gear)` button) — Choose which addons directories to scan. Community addons opt-in (marked as slow). Custom paths supported
- **Auto-refresh** on `.py` file save
- **Right-click model:**
  - Go to XML View — searches all XML files for `model="..."`, shows results grouped by same-module / other addons with record ID and line
  - Open in Odoo Browser — opens list view in browser
  - Browse Records — opens data browser with all records from the DB table
- **Right-click field:**
  - Find Field in XML — searches all XML files for `name="field_name"`, grouped by same-module / other addons
  - Browse Field Values — opens data browser showing field values from DB

### XML Features

- **Document Symbols (Outline panel)** — All `<record id="...">`, `<template id="...">`, `<menuitem id="...">` entries appear in VS Code's Outline panel, clickable to navigate
- **Hover tooltips** — Hover over `model="res.partner"` to see which modules define/inherit it. Hover over `ref="..."` for XML ID info
- **XML ID navigation** — `Ctrl+Shift+X` on any XML ID reference jumps to its definition

### Data Browser

Opens a full editor tab with an interactive table:

- **Browse Model Records** — Smart column selection (skips binary blobs, picks up to 12 useful columns)
- **Browse Field Values** — Shows field values for non-null records
- **SQL Result viewer** — Used by SQL Tools for query results
- **Sortable columns** — Click any column header to sort ascending/descending
- **Search bar** — Adds a WHERE filter to the query
- **Custom SQL bar** — Edit and run any SQL directly, press Enter to execute
- **Open in Odoo** — Row action button opens that record's form view in browser
- **Copy cell** — Double-click any cell to copy its value to clipboard

### SQL Tools

A tree view with two collapsed sections:

- **Tables** — Lists all public tables in the current database. Click to browse, right-click for:
  - Browse Table — opens data browser with `SELECT * LIMIT 100`
  - Show Columns — QuickPick with column names and types, pick to copy name
  - Copy SELECT Statement — copies `SELECT * FROM table LIMIT 100` to clipboard
- **History** — Last 20 SQL queries run, click to re-run
- **Title bar:** `$(play)` Run SQL (input box), `$(refresh)` refresh tables, `$(trash)` clear history
- **Run SQL** (`Ctrl+Shift+Q`) — Input box → result in data browser

### Log Filtering

- Captures output directly from the integrated terminal — no log file needed
- Filter levels: `ALL | ERROR | WARNING | INFO | DEBUG`
- Filter persists across server restarts

### Breakpoints

A dedicated tree view (collapsed by default, at the bottom of the panel):

- Shows all source breakpoints with filename, line number, and condition if set
- Enabled breakpoints show filled red circle, disabled show outline
- Click to navigate to the breakpoint location
- **Right-click:** Enable/Disable toggle, Remove
- **Title bar:** Enable All, Disable All, Clear All

### Debug Controls

When server state is `debugging`, a Debug section appears in the sidebar with:
Continue, Step Over, Step Into, Step Out, Restart, Stop

### JS Debugging

- **Launch Chrome Debug** — Opens Chrome with remote debugging port, navigates to Odoo with `?debug=assets`
- **Attach JS Debugger** — Attaches VS Code to Chrome, auto-generates `pathMapping` for all custom addons

### Database Tools

- **Switch Database** — Lists all PostgreSQL databases, updates workspace setting
- **Copy Database** — `createdb -T source newname`, switches to new DB automatically
- **Drop Database** — With confirmation dialog
- **Clear Asset Bundles** — Deletes `ir_attachment` records for `/web/assets/*`
- **Open Odoo** (`Ctrl+Shift+B`) — Opens `http://localhost:<port>/odoo`
- **Open Apps** — Opens module list in debug mode
- **Debug Mode URL** — Opens with `?debug=assets`

### Odoo Shell (`Ctrl+Shift+O`)

Opens an interactive Odoo shell session via debugpy in the integrated terminal.

---

## Configuration

Open Settings (`Ctrl+,`) and search **Odoo Debugger**, or click the `$(settings-gear)` icon in the panel title bar.

### Core

| Setting | Default | Description |
|---|---|---|
| `odooDebugger.database` | `odoo18` | PostgreSQL database name. Auto-read from conf file if set |
| `odooDebugger.communityPath` | `${workspaceFolder}/community` | Path to Odoo community source |
| `odooDebugger.addonsPaths` | `[]` | Custom addons directories. Use Manage Addons Paths to configure |
| `odooDebugger.configFile` | `.odoorc` | Odoo conf file path (relative or absolute). If found, passed as `-c` to odoo-bin |
| `odooDebugger.port` | `8069` | Odoo HTTP port |
| `odooDebugger.odooBinPath` | `` | Explicit path to `odoo-bin`. Auto-detected if empty |

### Database Connection

All settings are optional. If a conf file is configured, DB details are auto-read from it. Explicit settings override conf file values.

| Setting | Default | Description |
|---|---|---|
| `odooDebugger.dbHost` | `` | PostgreSQL host (empty = local socket) |
| `odooDebugger.dbPort` | `` | PostgreSQL port (empty = 5432) |
| `odooDebugger.dbUser` | `` | PostgreSQL user (empty = OS user) |
| `odooDebugger.dbPassword` | `` | PostgreSQL password (empty = trust auth) |

### Advanced

| Setting | Default | Description |
|---|---|---|
| `odooDebugger.venvPath` | `` | Override Python interpreter path. Auto-detected from VS Code's selected interpreter if empty |
| `odooDebugger.githubPath` | `${workspaceFolder}/github` | Parent directory for addons auto-discovery |
| `odooDebugger.limitTimeReal` | `10000` | Request time limit in seconds |
| `odooDebugger.maxCronThreads` | `0` | Max cron threads (0 = disable cron during development) |
| `odooDebugger.upgradeScript` | `` | Custom upgrade/restart script path. If set, used instead of running odoo-bin directly |
| `odooDebugger.modelExplorer.sources` | `[]` | Addons dirs to scan in Model Explorer. Empty = uses addonsPaths |
| `odooDebugger.chromePath` | `` | Chrome binary path for JS debugging. Auto-detected if empty |
| `odooDebugger.chromeDebugPort` | `9222` | Chrome remote debugging port |

---

## Keyboard Shortcuts

| Shortcut | Action | Context |
|---|---|---|
| `Ctrl+Shift+R` | Run Odoo | Global |
| `Ctrl+Shift+D` | Debug Odoo | Not in editor |
| `Ctrl+Shift+S` | Stop Odoo | Global |
| `Ctrl+Shift+U` | Update Module | Global |
| `Ctrl+Shift+I` | Install Module | Not in editor |
| `Ctrl+Shift+G` | Update Changed Modules | Editor not focused |
| `Ctrl+Shift+B` | Open Odoo in Browser | Not in editor |
| `Ctrl+Shift+O` | Open Odoo Shell | Not in editor |
| `Ctrl+Shift+Q` | Run SQL | Global |
| `Ctrl+Shift+M` | Go to Model (word/selection) | Editor text focus |
| `Ctrl+Shift+X` | Go to XML ID (word/selection) | Editor text focus |
| `Ctrl+Shift+T` | Toggle Py ↔ XML | `.py` or `.xml` file |
| `Ctrl+Shift+.` | Go to Function Definition | Editor text focus |

---

## Requirements

- VS Code `1.85.0` or later
- **ms-python.debugpy** extension (listed as dependency, auto-installed)
- Python with Odoo dependencies installed (select interpreter via VS Code's Python extension)
- PostgreSQL with `psql` available on PATH
- Odoo source with `odoo-bin` (auto-detected in workspace)

---

## How It Works — No Config Needed for Most Setups

1. Open your Odoo workspace folder in VS Code
2. Select your Python interpreter (`Ctrl+Shift+P` → "Python: Select Interpreter")
3. If you have an `.odoorc` or conf file, set `odooDebugger.configFile` to its path — DB name, host, port, user, password are all read from it automatically
4. If no conf file, set `odooDebugger.database` to your DB name
5. Press `Ctrl+Shift+R` to run

---

## License

MIT © Mohit Ghodasara
