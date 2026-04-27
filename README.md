# Odoo Debugger

All-in-one Odoo development toolkit for VS Code. Run, debug, update modules, explore models, browse database records, navigate code, and manage your entire Odoo workflow — all from a single activity bar panel.

---

## Panel Layout

The extension adds an **Odoo Debugger** icon to the activity bar with four sections:

| Section | Purpose |
|---|---|
| **Odoo Debugger** | Server controls, module actions, logs, tools |
| **Model Explorer** | Browse all models, fields, and methods — navigate to definitions |
| **SQL Tools** | Browse tables, run queries, view history |
| **Breakpoints** | Manage all breakpoints in one place |

---

## Features

### Server Management

- **Run Odoo** (`Ctrl+Shift+R`) — Start server via debugpy with `noDebug` mode (no debug panel clutter)
- **Debug Odoo** (`Ctrl+Shift+D`) — Full debugpy session with breakpoints active. Floating toolbar still shows
- **Stop Odoo** (`Ctrl+Shift+S`) — Stop running or debugging server
- **Restart Odoo** — Stops and re-launches in the same mode (Run or Debug) with all correct args
- Auto-stops server before update/install, auto-restarts after build completes
- Status badge in panel header: `▶ Running` / `● Debugging` / `► Building...` / `■ Stopped`
- Status bar item shows current DB and server state, click to switch database
- Restarting from VS Code's floating debug toolbar correctly syncs the status badge
- Debug panel does not auto-switch when a breakpoint is hit — stays on your current view

### Module Management

- **Update Module** (`Ctrl+Shift+U`) — QuickPick with git-changed modules shown first (validated against `__manifest__.py`)
- **Install Module** (`Ctrl+Shift+I`) — Same picker, runs `--init`
- **Update Changed** (`Ctrl+Shift+G`) — Auto-detects modules with uncommitted git changes across all repos
- **Uninstall Module** — Opens Odoo shell with the uninstall command pre-filled
- **Scaffold New Module** — Generates full module structure: manifest, model, views, security CSV, menu items
- **Manage Addons Paths** — Multi-select from auto-discovered dirs + browse for any custom folder

### Navigation

- **Toggle Py ↔ XML** (`Ctrl+Shift+T`) — Jump between model file and its views XML
- **Go to Model** (`Ctrl+Shift+M`) — Find `_name = 'model.name'` definition from word under cursor
- **Go to XML ID** (`Ctrl+Shift+X`) — Find `id="xml_id"` in XML files from word under cursor
- **Go to Function Def** (`Ctrl+Shift+.`) — Find original function definition, skipping `super()` overrides
- **Go to All Definitions** — Shows all definitions of a function in a QuickPick
- **Current Module Info** — Shows module name, version, depends, DB state
- All navigation commands work on **word under cursor** — no text selection needed
- Right-click context menu shows relevant commands based on file type (`.py` or `.xml`)

### Model Explorer

A tree view showing all models from your configured addons directories:

**Models:**
- **Merged inheritance** — `_name` and `_inherit` sources merged into one node per model
- **Model type icons** — `symbol-class` for regular, `symbol-interface` for TransientModel (wizards), `symbol-namespace` for AbstractModel
- **Filter by type** — `$(filter)` button → filter by Regular / Transient / Abstract
- **Cursor auto-reveal** — Moving cursor in `.py` or `.xml` automatically highlights the matching model (debounced 300ms)
- **Search / Filter** — `$(search)` button → filter by model name or module name
- **Community addons included by default** — uncheck in Configure Sources if not needed
- **Configure Sources** — `$(settings-gear)` button → multi-select addons dirs + browse for custom folders

**Fields** (expand model):
- Type-specific icons: `Char`/`Text`/`Html` → string, `Integer`/`Float`/`Monetary` → number, `Boolean` → boolean, `Date`/`Datetime` → event, `Selection` → enum, `Many2one` → key, `One2many`/`Many2many` → array, `Binary`/`Image` → file
- Click to navigate to exact field definition line

**Methods** (collapsible folder, collapsed by default):
- Decorator-aware icons: `@api.depends`/`@api.onchange`/`action_*` → event, `@api.constrains` → ruler, `@api.model` → class, `@staticmethod` → constant, CRUD overrides → operator, private helpers → property
- Description shows decorator (e.g. `@api.depends`) when present
- Click to navigate to method definition

**Inline action buttons** (appear on hover):
- Model row: `$(file-code)` Go to XML View, `$(globe)` Open in Browser, `$(table)` Browse Records
- Field row: `$(search)` Find in XML, `$(table)` Browse Values
- Method row: `$(references)` Find Usages

**Right-click model:**
- Go to XML View — finds all `ir.ui.view` records for this model, grouped by same-module / other addons
- Open in Odoo Browser — opens list view
- Browse Records — opens data browser

**Right-click field:**
- Find Field in XML — finds `<field name="...">` inside `ir.ui.view` records only (skips data/demo files)
- Browse Field Values — opens data browser for that field

**Right-click method:**
- Find Method Usages — greps for `.methodName(` across all Python files → QuickPick results

### XML Features

- **Document Symbols (Outline panel)** — All `<record id="...">`, `<template id="...">`, `<menuitem id="...">` entries in VS Code's Outline panel
- **Hover tooltips** — Hover over `model="res.partner"` to see which modules define/inherit it. Hover over `ref="..."` for XML ID info

### Data Browser

Opens a full editor tab with an interactive table:

- **Browse Model Records** — Smart column selection (skips binary blobs, picks up to 12 useful columns)
- **Browse Field Values** — Shows field values for non-null records
- **SQL Result viewer** — Used by SQL Tools for query results
- **Sortable columns** — Click any column header to sort ascending/descending
- **Search bar** — Contains match (`%term%`) WHERE filter
- **Custom SQL bar** — Edit and run any SQL directly, press Enter to execute
- **Open in Odoo** — Row action button opens that record's form view in browser
- **Copy cell** — Double-click any cell to copy its value to clipboard

### SQL Tools

A tree view with two collapsed sections:

- **Tables** — Lists all public tables. `$(search)` filter by name, section label shows match count. Click to browse, right-click for:
  - Browse Table, Show Columns (pick to copy name), Copy SELECT Statement
- **History** — Last 20 SQL queries, click to re-run
- **Title bar:** `$(play)` Run SQL, `$(search)` Filter Tables, `$(refresh)` Refresh, `$(trash)` Clear History
- **Run SQL** (`Ctrl+Shift+Q`) — Input box → result in data browser

### Log Filtering

- Captures output directly from the integrated terminal — no log file needed
- Filter levels: `ALL | ERROR | WARNING | INFO | DEBUG`
- Filter persists across server restarts

### Breakpoints

A dedicated tree view (collapsed by default, at the bottom of the panel):

- Shows all source breakpoints with filename, line number, and condition if set
- Enabled: filled red circle. Disabled: outline circle
- Click to navigate to the breakpoint location
- **Right-click:** Enable/Disable toggle, Remove
- **Title bar:** Enable All (`$(check-all)`), Disable All (`$(circle-slash)`), Clear All (`$(trash)`)

### Debug Controls

When server state is `debugging`, a Debug section appears in the sidebar with:
Continue (`F5`), Step Over (`F10`), Step Into (`F11`), Step Out (`⇧F11`), Stop

### JS Debugging

- **Launch Chrome Debug** — Opens Chrome with remote debugging port, navigates to Odoo with `?debug=assets`
- **Attach JS Debugger** — Attaches VS Code to Chrome, auto-generates `pathMapping` for all custom addons

### Database Tools

- **Switch Database** — Lists all PostgreSQL databases + manual entry option (works even without psql connection)
- **Copy Database** — `createdb -T source newname`, switches to new DB automatically
- **Drop Database** — With confirmation dialog
- **Clear Asset Bundles** — Deletes `ir_attachment` records for `/web/assets/*`
- **Open Odoo** (`Ctrl+Shift+B`) — Opens `http://localhost:<port>/odoo`
- **Open Apps** — Opens module list in debug mode
- **Debug Mode URL** — Opens with `?debug=assets`

### Odoo Shell (`Ctrl+Shift+O`)

Opens an interactive Odoo shell session via debugpy in the integrated terminal.

---

## Sidebar Title Bar Icons

The "Odoo Debugger" panel header has these icon buttons:

| Icon | Action |
|---|---|
| `$(database)` | Switch Database |
| `$(folder)` | Manage Addons Paths |
| `$(symbol-misc)` | Select Python Interpreter (opens VS Code's interpreter picker) |
| `$(folder-library)` | Select Community Path (folder picker) |
| `$(settings-gear)` | Open Settings (filtered to `odooDebugger`) |

---

## Configuration

Open Settings (`Ctrl+,`) and search **Odoo Debugger**, or click `$(settings-gear)` in the panel title bar.

### Core

| Setting | Default | Description |
|---|---|---|
| `odooDebugger.database` | `` | PostgreSQL database name. Auto-read from conf file if set |
| `odooDebugger.communityPath` | `${workspaceFolder}/community` | Path to Odoo community source |
| `odooDebugger.addonsPaths` | `[]` | Custom addons directories |
| `odooDebugger.configFile` | `` | Odoo conf file path. If found, passed as `-c` to odoo-bin and DB details read from it |
| `odooDebugger.port` | `8069` | Odoo HTTP port |
| `odooDebugger.odooBinPath` | `` | Explicit path to `odoo-bin`. Auto-detected if empty. If multiple found, prompts to select |

### Database Connection

All optional. If a conf file is set, DB details are auto-read from it. Explicit settings override.

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
| `odooDebugger.upgradeScript` | `` | Custom upgrade/restart script. If set, used instead of running odoo-bin directly |
| `odooDebugger.modelExplorer.sources` | `[]` | Addons dirs to scan in Model Explorer. Empty = uses addonsPaths + community |
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
- **ms-python.debugpy** extension (auto-installed as dependency)
- Python with Odoo dependencies installed (select interpreter via VS Code's Python extension)
- PostgreSQL with `psql` available on PATH
- Odoo source with `odoo-bin` (auto-detected in workspace, prompts if multiple found)

---

## Quickstart

1. Open your Odoo workspace folder in VS Code
2. Select your Python interpreter (`Ctrl+Shift+P` → "Python: Select Interpreter")
3. If you have an `.odoorc` or conf file → set `odooDebugger.configFile` to its path. DB name, host, port, user, password are all read automatically
4. If no conf file → set `odooDebugger.database` to your DB name (or use the `$(database)` icon in the panel title bar)
5. Press `Ctrl+Shift+R` to run

---

## License

MIT © Mohit Ghodasara
