# Changelog

## 1.2.0

### New Features

- **Methods in Model Explorer** — Expand any model to see its methods in a collapsible `Methods (N)` folder (collapsed by default). Click to navigate to definition line
- **Method type icons** — Icons reflect method type: `@api.depends`/`@api.onchange`/`action_*` → event, `@api.constrains`/`_check_*` → ruler, `@api.model` → class, `@staticmethod` → constant, `@classmethod` → namespace, CRUD overrides → operator, private helpers → property
- **Field type icons** — Each field shows an icon matching its type: `Char`/`Text`/`Html` → string, `Integer`/`Float`/`Monetary` → number, `Boolean` → boolean, `Date`/`Datetime` → event, `Selection` → enum, `Many2one` → key, `One2many`/`Many2many` → array, `Binary`/`Image` → file
- **Model type filter** — `$(filter)` button in Model Explorer title bar → filter by Regular / Transient (wizard) / Abstract models. Icons change by type: `symbol-class` / `symbol-interface` / `symbol-namespace`
- **Inline action buttons** — Hover over any model/field/method row to see icon buttons: model gets XML View + Browser + Browse Records, field gets Find in XML + Browse Values, method gets Find Usages
- **Find Method Usages** — Right-click any method → grep for `.methodName(` across all Python files → QuickPick with file:line results
- **SQL Tools filter** — `$(search)` button filters table list by name. `$(clear-all)` appears when filter active. Section label shows match count
- **Restart Odoo button** — Server section shows `⟳ Restart` alongside `■ Stop` when running or debugging. Uses our own restart (stop + re-launch with same mode and all correct args)
- **Interpreter selection** — `$(symbol-misc)` icon in sidebar title bar → opens VS Code's standard Python interpreter picker
- **Community path selection** — `$(folder-library)` icon in sidebar title bar → folder picker to set `odooDebugger.communityPath`
- **Restart from VS Code toolbar syncs status** — `onDidStartDebugSession` now updates our state badge correctly when session is restarted from VS Code's floating debug toolbar

### Improvements

- **Debug panel no longer auto-switches** when a breakpoint is hit — `workbench.debug.openDebug` set to `neverOpen` while extension is active, restored on deactivate. Floating toolbar still works normally
- **Changed modules validation** — `getChangedModules()` now validates each module name has a `__manifest__.py` before including it. No more false positives from deleted files or non-module dirs. Uses `git diff --name-only HEAD`
- **odoo-bin multi-version support** — Scans workspace for all `odoo-bin` files. If multiple found, shows QuickPick to select. Validates file is executable. Saves selection to `odooBinPath`
- **Switch Database works without SQL** — Always shows "Enter database name manually..." option. Falls back to input box if psql unreachable
- **DB connection test** — Now connects to `postgres` maintenance DB instead of configured DB, so it works even if target DB doesn't exist yet
- **Database default removed** — No longer defaults to `odoo18`. Forces explicit configuration to avoid accidentally connecting to wrong DB
- **Model Explorer community default** — Community addons included in scan by default. Uncheck in Configure Sources if not needed
- **Model Explorer addons source picker** — "Browse for folder..." option added. Shows currently configured custom paths not in auto-discovered list
- **Field XML search — views only** — Searches only inside `<record model="ir.ui.view">` blocks, skips `data/`, `demo/`, `security/` directories. No more data record noise
- **Model XML search — views only** — Searches for `<field name="model">modelName</field>` pattern, only returns actual view definitions
- **Data browser search** — Fixed to use `%term%` (contains match) instead of `term%` (starts-with)
- **Right-click context menu** — All editor context commands now have proper `when` conditions (`.py` only for model/function nav, `.py`+`.xml` for XML ID/toggle). Added `gotoFunctionDefAll` and `currentModuleInfo` to context menu
- **Interpreter detection simplified** — Uses VS Code Python extension API directly. No more filesystem scanning for venvs

### Bug Fixes

- Debug controls (step/continue) no longer show after debug session ends when switching back to panel
- `ORDER BY id DESC` removed from data browser queries — works with tables that have no `id` column

## 1.1.0

### New Features
- **Model Explorer** — Tree view of all models from custom addons. Merged `_name`/`_inherit` sources, lazy field loading, click to navigate to exact definition line
- **Cursor Auto-Reveal** — Moving cursor in `.py` or `.xml` files auto-highlights the matching model in Model Explorer
- **XML Outline** — VS Code Outline panel shows all `<record>`, `<template>`, `<menuitem>` IDs in XML files
- **XML Hover** — Hover over `model="..."` or `ref="..."` in XML for definition info
- **Model → XML Navigation** — Right-click model → find all XML views, grouped by same-module / other addons with exact line navigation
- **Field → XML Navigation** — Right-click field → find all XML usages across addons
- **Data Browser** — Browse model records or field values from the DB in a full editor tab. Sortable columns, search/filter, custom SQL bar, open record in Odoo
- **SQL Tools** — Tree view with Tables (lazy-loaded), Query History. Run SQL (`Ctrl+Shift+Q`), browse any table, show columns, copy SELECT statement
- **Breakpoints Tree** — Dedicated tree view with enable/disable/remove per breakpoint, Enable All / Disable All / Clear All
- **DB Config from Conf File** — Auto-reads `db_name`, `db_host`, `db_port`, `db_user`, `db_password` from `.odoorc` / conf file. Explicit settings override
- **DB Connection Test** — Warns on startup if PostgreSQL connection fails with link to settings
- **odoo-bin Auto-Detection** — Searches workspace up to depth 3. Prompts with Browse/Enter Path if not found, saves to settings
- **Manage Addons Paths** — Now includes "Browse for folder..." option for custom directories not in auto-discovered list
- **Interpreter Detection** — Uses VS Code's selected Python interpreter directly via Python extension API

### Improvements
- Debug controls (Continue/Step/Stop) now only show when server state is `debugging`
- Breakpoints panel moved to bottom of activity bar panel
- `switchDatabase` and `manageAddonsPaths` shown as icon-only buttons in panel title bar
- All psql calls use unified `buildPsqlArgs()` with host/port/user/password support

### Keyboard Shortcuts (updated)
- `Ctrl+Shift+D` — Debug Odoo
- `Ctrl+Shift+I` — Install Module
- `Ctrl+Shift+B` — Open in Browser
- `Ctrl+Shift+O` — Open Shell
- `Ctrl+Shift+Q` — Run SQL
- `Ctrl+Shift+.` — Go to Function Def

## 1.0.0

### Features
- Server Management — Run, Debug, Stop Odoo
- Module Management — Update, Install, Uninstall, Scaffold
- Code Navigation — Toggle Model/View, Go to Model/XML ID/Function Definition
- Log Filtering — Filter terminal output by level
- JS Debugging — Chrome debug port with auto pathMapping
- Database Switcher, Utilities, Keyboard Shortcuts
