# Odoo Debugger

Your complete Odoo development environment inside VS Code. Run and debug the server, explore models with full inheritance chains, hover over any symbol for instant navigation, browse database records, watch live logs — all without leaving your editor.

![Overview — editor in debug mode with side panel, breakpoint hit, Odoo Logs at bottom](https://raw.githubusercontent.com/MohitGhodasara/odoo-debugger/main/resources/screenshots/overview.png)

*Full editor view: side panel with Odoo Debugger, server stopped at a breakpoint, Odoo Logs panel at the bottom.*

---

## Setup

### 1 — Install the extension

Install from the VS Code marketplace. `ms-python.debugpy` is automatically installed as a dependency.

### 2 — Select Python interpreter

`Ctrl+Shift+P` → **Python: Select Interpreter** → pick your Odoo virtualenv.

### 3 — Point to your Odoo conf file *(recommended)*

```json
"odooDebugger.configFile": "/path/to/.odoorc"
```

The extension reads `db_name`, `db_host`, `db_port`, `db_user`, `db_password`, `addons_path`, and `http_port` directly from the conf file. No other settings needed.

> **Without a conf file:** Set `odooDebugger.database` to your DB name manually.

### 4 — Configure addons paths

Click the **folder icon** in the panel title bar → **Manage Addons Paths**, or set directly:

```json
"odooDebugger.addonsPaths": [
    "/path/to/odoo/community/addons",
    "/path/to/custom-addons"
]
```

### 5 — Run Odoo

Press `Ctrl+Shift+R` or click **▶ Run** in the panel.

---

## Panel Layout

| Section | Purpose |
|---|---|
| **Odoo Debugger** | Server controls, module actions, tools |
| **Model Explorer** | Browse all models, fields, functions, views |
| **SQL Tools** | Browse tables, run queries |
| **Tools** | JS debug, utilities, scaffold |
| **Breakpoints** | Manage all breakpoints |
| **Odoo Logs** | Live log panel at the bottom |

---

## Features

### Server Management

- **Run** (`Ctrl+Shift+R`) — Starts Odoo via debugpy in noDebug mode
- **Debug** (`Ctrl+Shift+D`) — Full debugpy session with breakpoints active. Debug button shown as a **yellow dot** `●`
- **Stop** (`Ctrl+Shift+S`) — Stops the running server
- **Restart** — Stops and re-launches in the same mode
- When server is active, Run/Debug buttons are replaced by a **debug toolbar**:
  - Run mode: Continue/Step disabled, Restart + Stop active
  - Debug mode: All 6 buttons — Continue, Step Over, Step Into, Step Out, Restart, Stop
- **Status bar** (bottom left) — Shows server state + DB name + index count: `$(database) Odoo: mydb | 245m`

---

### Module Management

![Update Module — changed modules shown at top, all others below](https://raw.githubusercontent.com/MohitGhodasara/odoo-debugger/main/resources/screenshots/update-module.png)

*Update Module picker: git-changed modules appear at the top for quick access.*

- **Update** (`Ctrl+Shift+U`) — QuickPick with git-changed modules shown first
- **Install** (`Ctrl+Shift+I`) — Same picker, runs `--init`
- **Changed** (`Ctrl+Shift+G`) — Auto-detects modules with uncommitted git changes
- **Uninstall** — Opens Odoo shell with uninstall command
- **Scaffold** — Generates full module: manifest, model, views, security CSV, menu, action

---

### Model Explorer

![Model Explorer — side panel with expanded model showing Fields, Functions, Views sections](https://raw.githubusercontent.com/MohitGhodasara/odoo-debugger/main/resources/screenshots/model-explorer.png)

*Model Explorer with a model expanded showing Fields, Functions, and Views folders.*

Tree view of all models from your configured addons with full inheritance support:

- **Fields folder** — `Fields (N)` — collapsible, shows all field definitions with type icons
- **Functions folder** — `Functions (N)` — collapsible, decorator-aware icons
- **Views folder** — `Views (N)` — lazy-loaded, shows full inheritance tree with `└─` indentation
- **Model type icons** — Regular / TransientModel (wizard) / AbstractModel
- **Filter by type** — Default shows only `models.Model`. Change via filter button
- **Sort** — Alphabetical or Recently Modified
- **Group by module** — Toggle grouped/flat view
- **Cursor auto-reveal** — Moving cursor in `.py` or `.xml` auto-highlights the matching item
- **Move to Panel** — Button to move Model Explorer to the bottom panel for more space

**Right-click model:** Go to XML View, Open in Browser, Browse Records, Copy Model Name

**Right-click field:** Find in XML Views, Browse Field Values

**Right-click function:** Find Function Usages

---

### Quick Find

![Quick Find — filter using model name and field prefix](https://raw.githubusercontent.com/MohitGhodasara/odoo-debugger/main/resources/screenshots/quick-find.png)

*Quick Find with compound search: model name + `@` field prefix filtering.*

`Ctrl+Alt+N` — Live search picker with compound syntax:

| Input | Result |
|---|---|
| `res.partner` | Models matching name |
| `@name` | Models with field starting with `name` |
| `#action` | Functions starting with `action` |
| `:sale` | Models from module `sale` |
| `res.partner@name` | Fields in `res.partner` only |
| `res.partner#action` | Functions in `res.partner` only |

---

### Hover Navigation

Hover over any Odoo symbol for instant navigation with clickable links. Current file shown in **bold** (not a link). All other locations are clickable.

#### View hover (XML)

![XML hover — id attribute showing view inheritance hierarchy](https://raw.githubusercontent.com/MohitGhodasara/odoo-debugger/main/resources/screenshots/hover-xml-view.png)

*Hovering an XML `id=` attribute shows the full view inheritance tree with clickable file:line links.*

Hover `id="view_id"`, `ref="module.view_id"`, or `inherit_id ref="..."`:

```
View: `sale_order_form` `[form]`

sale/views/order_views.xml:10
└─ sale_stock/views/order_views.xml:5
   └─ sale_mrp/views/order_views.xml:3
└─ account/views/order_views.xml:7
```

External views (community Odoo) shown as `` `module.view_id` *(external)* ``.

#### Model hover (Python + XML)

Hover `_name`, `_inherit`, `class MyModel(models.Model)`, `model="res.partner"`, or any `'res.partner'` string:

```
Model: `res.partner`

✦ base/models/res_partner.py:45
↳ sale/models/res_partner.py:12
↳ account/models/res_partner.py:8
```

#### Field hover

Hover any `field = fields.Type(` line — shows all XML views that use this field:

```
Field: `partner_id` — `fields.Many2one`
Model: `sale.order`

Used in views:
└─ sale_order_form [form]  sale/views/order_views.xml:45
└─ sale_order_tree [list]  sale/views/order_views.xml:12
```

#### Function hover

Hover any `def method_name(` line — shows definition, overrides, and callers:

```
Function: `action_confirm`
`@api.multi`
Model: `sale.order`

Defined: sale/models/order.py:120
Overridden in:
↳ sale_stock/models/order.py:45

Called from:
└─ sale/wizard/confirm.py:34  `order.action_confirm()`
```

---

### Log Panel

![Odoo Logs — log panel with filter buttons and colored log lines](https://raw.githubusercontent.com/MohitGhodasara/odoo-debugger/main/resources/screenshots/log-panel.png)

*Odoo Logs panel showing live log output with filter buttons, colored levels, and traceback grouping.*

Live log panel at the bottom (next to Terminal):

- **Filter buttons** — ALL / CRITICAL / ERROR / WARNING / INFO / DEBUG with counts
- **Search** — Live search with highlight
- **▲ Err / ▼ Err** — Jump to previous/next error
- **Traceback grouping** — Collapsed by default, click `▶` to expand
- **Navigate to file** — `File "/path/file.py", line 42` are clickable links
- **Auto-scroll** with lock when scrolling up
- **Truncated on restart** — Log cleared on every server start
- **Disable** — `odooDebugger.logPanel.enabled: false` for zero overhead

---

### Background Indexing

On startup, two background workers run in parallel:

- **Python worker** — scans all model files, builds models + fields + functions index
- **XML worker** — scans all view files, builds views inheritance tree + field-usage index

Status bar shows `$(sync~spin)` while indexing, then model count when ready (`| 245m`). All hover features use the index for **O(1) lookups** — zero file IO on hover.

Index automatically re-runs when any `.py` or `.xml` file is saved (600ms debounce).

---

### Data Browser

Interactive table in an editor tab:

- Browse model records or field values from DB
- Sortable columns, `%term%` search, custom SQL bar
- Open in Odoo (form view), copy cell on double-click

### SQL Tools

- **Tables** — All public tables, filterable. Browse, show columns, copy SELECT
- **History** — Last 20 queries, click to re-run
- **Run SQL** (`Ctrl+Shift+Q`) — Result in data browser

### Navigation

- **Toggle Py ↔ XML** (`Ctrl+Shift+T`) — Jump between model `.py` and `_views.xml`
- **Go to Model** (`Ctrl+Shift+M`) — Find `_name = 'model.name'` from word under cursor
- **Go to XML ID** (`Ctrl+Shift+X`) — Find `id="xml_id"` from word under cursor
- **Go to Function Def** (`Ctrl+Shift+.`) — Find original definition
- **Go to All Definitions** — All definitions in a QuickPick

### JS Debugging

- **Launch Chrome Debug** — Opens Chrome with remote debugging + `?debug=assets`
- **Attach JS Debugger** — Attaches VS Code to Chrome with auto-generated `pathMapping`

### Database Tools

- **Switch Database** — Lists all PostgreSQL DBs (click status bar)
- **Copy Database** — `createdb -T source newname`
- **Drop Database** — With confirmation
- **Clear Asset Bundles** — Deletes `/web/assets/*` attachments

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+R` | Run Odoo |
| `Ctrl+Shift+D` | Debug Odoo |
| `Ctrl+Shift+S` | Stop Odoo |
| `Ctrl+Shift+U` | Update Module |
| `Ctrl+Shift+I` | Install Module |
| `Ctrl+Shift+G` | Update Changed Modules |
| `Ctrl+Shift+B` | Open Odoo in Browser |
| `Ctrl+Shift+O` | Open Odoo Shell |
| `Ctrl+Shift+Q` | Run SQL |
| `Ctrl+Shift+M` | Go to Model |
| `Ctrl+Shift+X` | Go to XML ID |
| `Ctrl+Shift+T` | Toggle Py ↔ XML |
| `Ctrl+Shift+.` | Go to Function Definition |
| `Ctrl+Alt+N` | Quick Find |
| `Ctrl+Alt+E` | Focus Panel |

---

## Settings Reference

| Setting | Default | Description |
|---|---|---|
| `odooDebugger.configFile` | `.odoorc` | Odoo conf file path |
| `odooDebugger.database` | `` | DB name (auto-read from conf) |
| `odooDebugger.addonsPaths` | `[]` | Addons directories |
| `odooDebugger.odooBinPath` | `` | Path to `odoo-bin` (auto-detected) |
| `odooDebugger.venvPath` | `` | Python interpreter (auto-detected) |
| `odooDebugger.port` | `8069` | Odoo HTTP port |
| `odooDebugger.extraArgs` | `[]` | Extra odoo-bin args |
| `odooDebugger.debugOptions` | `{justMyCode:false}` | debugpy launch options |
| `odooDebugger.dbHost` | `` | PostgreSQL host |
| `odooDebugger.dbPort` | `` | PostgreSQL port |
| `odooDebugger.dbUser` | `` | PostgreSQL user |
| `odooDebugger.dbPassword` | `` | PostgreSQL password |
| `odooDebugger.logPanel.enabled` | `true` | Enable log panel |
| `odooDebugger.logPanel.logFile` | `/tmp/odoo-vscode.log` | Log file path |
| `odooDebugger.modelExplorer.sources` | `[]` | Addons dirs to scan |
| `odooDebugger.modelExplorer.groupByModule` | `true` | Group by module |
| `odooDebugger.modelExplorer.sortOrder` | `alpha` | `alpha` or `recent` |
| `odooDebugger.modelExplorer.typeFilter` | `model` | Default type filter on startup |
| `odooDebugger.modelExplorer.showViews` | `true` | Show Views folder |
| `odooDebugger.upgradeScript` | `` | Custom upgrade script |
| `odooDebugger.chromePath` | `` | Chrome binary path |
| `odooDebugger.chromeDebugPort` | `9222` | Chrome debug port |

---

## Requirements

- VS Code `1.85.0` or later
- `ms-python.debugpy` extension (auto-installed)
- Python with Odoo dependencies installed
- PostgreSQL with `psql` on PATH
- Odoo source with `odoo-bin`

---

## License

MIT © Mohit Ghodasara
