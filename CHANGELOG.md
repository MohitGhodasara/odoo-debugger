# Changelog

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
- Debug controls (Continue/Step/Stop) now only show when server state is `debugging` — no false positives from unrelated debug sessions
- Breakpoints panel moved to bottom of activity bar panel
- `switchDatabase` and `manageAddonsPaths` shown as icon-only buttons in panel title bar
- DB queries no longer use `ORDER BY id DESC` — works with tables that have no `id` column
- All psql calls use unified `buildPsqlArgs()` with host/port/user/password support
- `configFile` default changed to empty — odoorc is opt-in, not assumed

### Keyboard Shortcuts (updated)
- `Ctrl+Shift+D` — Debug Odoo (was Go to Function Def)
- `Ctrl+Shift+I` — Install Module (new)
- `Ctrl+Shift+B` — Open in Browser (new)
- `Ctrl+Shift+O` — Open Shell (new)
- `Ctrl+Shift+Q` — Run SQL (new)
- `Ctrl+Shift+.` — Go to Function Def (moved from D)
- All shortcuts have proper `when` guards to avoid conflicts

## 1.0.0

### Features
- Server Management — Run, Debug, Stop Odoo
- Module Management — Update, Install, Uninstall, Scaffold
- Code Navigation — Toggle Model/View, Go to Model/XML ID/Function Definition
- Log Filtering — Filter terminal output by level
- JS Debugging — Chrome debug port with auto pathMapping
- Database Switcher, Utilities, Keyboard Shortcuts
