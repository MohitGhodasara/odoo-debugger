# Changelog

## 1.4.0

Major release with background indexing, hover navigation, Model Explorer improvements, and refreshed documentation.

### Background Indexing
- Added parallel Python and XML index workers that run on startup.
- Python indexing builds model, field, and function maps.
- XML indexing builds view inheritance and field usage maps.
- Added debounced file watchers for `.py` and `.xml` changes.
- Hover providers now use indexed lookups instead of scanning files on every hover.

### Hover Navigation
- Added Python hovers for model names, `_name`, `_inherit`, fields, function definitions, and method calls.
- Added XML hovers for view IDs, references, inherited views, and model attributes.
- Added clickable command links for model sources, field XML usages, function definitions, overrides, callers, and view inheritance.
- Function callers now include snippets and skip definition lines.

### Model Explorer
- Added collapsible `Fields`, `Functions`, and `Views` groups.
- Added lazy view loading with inheritance tree display.
- Added default model type filtering and persisted type filter setting.
- Added cursor auto-reveal support through `getParent()`.
- Added direct field and function filtering with `@field` and `#function` prefixes.
- Added option to move Model Explorer to the bottom panel.

### Status Bar
- Merged server state, database name, and indexing status into one Odoo Debugger status bar item.
- Shows indexing progress while workers run and model count when the index is ready.

### Documentation
- Updated README content for the new indexing and hover workflows.
- Added Marketplace screenshots for overview, Model Explorer, log panel, hover navigation, quick find, and module updates.

### Fixes
- Fixed XML reveal so model records are detected from the `<field name="model">` value inside view records.
- Fixed view child icons so children inherit parent view type when not explicitly detected.
- Fixed method caller search to match any variable before `.method(` and avoid full-workspace scans.
- Fixed function hover sections for defined location, overrides, and callers.
- Fixed update/install/build commands so they attach the configured Odoo log file when the log panel is enabled.
- Fixed update/install/build commands so the Odoo Logs panel starts tailing and autofocuses on first log output.

## 1.3.0

Major release with redesigned server management, a dedicated Odoo Logs panel, simpler addons discovery, and improved workflow controls.

### Server Management
- Added immediate `Starting...` feedback when launching Odoo.
- Replaced Run and Debug buttons with a VS Code-style debug toolbar while the server is active.
- Kept Odoo output visible in the integrated terminal.
- Prevented Debug Console and Debug View from stealing focus on launch.

### Odoo Logs Panel
- Added a dedicated file-based Odoo Logs panel.
- Added log level filters for all, critical, error, warning, info, and debug.
- Added structured log columns, traceback grouping, clickable file links, error navigation, wrapping, copy line, and auto-scroll lock.
- Added settings to disable the log panel or use a custom log file path.

### Addons and Launch Configuration
- Simplified setup by removing `communityPath` and `githubPath`.
- Added addons path discovery from Odoo config files, workspace scans, and detected Odoo source paths.
- Made generated Odoo launch arguments minimal by default.
- Added `extraArgs` and `debugOptions` settings for user-controlled launch behavior.

### Fixes
- Fixed tree view load crashes caused by stale utility exports.
- Fixed log panel rendering issues, codicon display, active filter colors, wrap behavior, and error coloring.
- Improved changed-module detection across staged and unstaged changes.

## 1.2.0

Release focused on richer Model Explorer interactions, SQL tooling, and workflow controls.

### New Features
- Added method browsing in Model Explorer with method type icons and usage search.
- Added field type icons and model type filters.
- Added inline action buttons for models, fields, and methods.
- Added SQL table filtering and improved database browsing behavior.
- Added restart controls, interpreter selection, and community path selection from the sidebar.

### Improvements
- Improved multi-version `odoo-bin` detection.
- Improved addons source picking and changed-module validation.
- Refined XML searches, context menu conditions, debug panel behavior, and DB connection testing.

## 1.1.0

Release with expanded Odoo development tooling.

### New Features
- Added Model Explorer with merged model definitions, lazy field loading, and cursor auto-reveal.
- Added XML outline and XML hover support.
- Added model-to-XML and field-to-XML navigation.
- Added Data Browser and SQL Tools.
- Added dedicated Breakpoints Tree.
- Added DB config loading from Odoo config files.
- Added DB connection test and improved interpreter detection.

### Improvements
- Improved debug controls, sidebar actions, psql argument handling, and keyboard shortcuts.

## 1.0.0

Initial complete release of Odoo Debugger for VS Code.

### Features
- Added server management for running, debugging, and stopping Odoo.
- Added module management for update, install, uninstall, and scaffold workflows.
- Added code navigation for models, XML IDs, views, and function definitions.
- Added log filtering, JS debugging helpers, database switching, utility commands, and keyboard shortcuts.
