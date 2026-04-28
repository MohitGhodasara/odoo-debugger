# Changelog

## 1.3.0

Major release — complete overhaul of server management, log viewing, UI consistency, and developer workflow features.

### Server Management

- **Starting state** — Sidebar shows `⟳ Starting...` immediately on button press before `startDebugging` resolves. No more wondering if the button registered
- **Debug toolbar** — When server is active, Run/Debug buttons replaced by a native-style debug toolbar matching VS Code's debugpy floating toolbar. Uses VS Code codicon font for icons
  - Run mode: Continue/Step buttons disabled (no debugger attached), Restart + Stop active
  - Debug mode: All 6 buttons active — Continue, Step Over, Step Into, Step Out, Restart, Stop
  - Starting/Building: all buttons disabled except Stop
- **`internalConsole` removed** — Reverted to `integratedTerminal` so terminal output is always visible. Focus stolen back to editor after launch via `workbench.action.focusFirstEditorGroup`
- **Auto-focus log panel** — When first log line arrives from file, log panel is focused automatically (event-driven, no fixed delay)
- **`suppressDebugView: true`** on all launch configs — Debug Console no longer auto-focuses on session start

### Odoo Logs Panel

New dedicated panel tab at the bottom (next to Terminal/Output) replacing the broken terminal-capture approach:

- **File-based tailing** — Injects `--logfile=/tmp/odoo-vscode.log` into launch args. Uses `fs.watch` (OS inotify) with 100ms debounce — zero polling, zero CPU when idle
- **Truncated on every server start** — Log file cleared before launch, panel resets
- **Filter buttons** — ALL / CRITICAL / ERROR / WARNING / INFO / DEBUG
  - Always colored matching Odoo's own logger colors: CRITICAL=dark red `#c0392b`, ERROR=salmon `#f48771`, WARNING=yellow `#cca700`, INFO=green `#89d185`, DEBUG=blue `#75beff`
  - Active = filled solid background in level color
  - Count shown when errors/warnings exist: `ERROR(3)`, `WARN(12)` with underline indicator
  - CRITICAL and ERROR tracked separately
- **Structured line parsing** — Each line split into timestamp / level badge / logger / message columns
- **Traceback grouping** — Consecutive traceback lines collapsed into one clickable group. Click `▶` to expand
- **Navigate to file** — `File "/path/file.py", line 42` patterns are clickable links → opens file at that line in editor
- **▲ Err / ▼ Err** — Jump to previous/next ERROR or CRITICAL line
- **Wrap toggle** — Toggle `white-space: pre-wrap` for long lines. Properly overrides `min-width: max-content` on container
- **Horizontal scroll** — Lines render at full width, panel scrolls horizontally
- **Auto-scroll with lock** — Scrolling up auto-locks, button to re-enable
- **Copy line** — Hover any line → `copy` button appears
- **3000 line cap** — Oldest lines trimmed automatically, no unbounded DOM growth
- **Disable option** — `odooDebugger.logPanel.enabled: false` skips `--logfile` injection entirely, zero overhead
- **Custom log path** — `odooDebugger.logPanel.logFile` setting

### UI — Consistent Button Theme

All buttons across the sidebar panel now use the same dark toolbar aesthetic:

- Same background (`--vscode-debugToolBar-background`), same border, same hover effect
- All buttons use VS Code **codicon font** (bundled from VS Code installation — no external dependency)
- Uniform `height: 28px` across toolbar buttons and sidebar action buttons
- **Color scheme** using VS Code semantic tokens:
  - Stop: `--vscode-debugIcon-stopForeground`
  - Restart: `--vscode-debugIcon-restartForeground`
  - Run: `--vscode-debugIcon-startForeground`
  - Debug: `#e8c44d` (matches `● Debugging` status bar color)
  - Step buttons: `--vscode-foreground` (neutral)

### Addons Path Discovery

- **Removed `githubPath` and `communityPath`** settings entirely — simpler setup
- **Auto-discovery from conf file** — `addons_path` read directly from `.odoorc`. If `addonsPaths` setting is empty, conf file value is used automatically
- **Workspace scan** — `discoverAllAddonsDirs()` scans workspace root (depth 2) for directories containing modules with `__manifest__.py`
- **Community addons** — Discovered from `<odooBinPath-dir>/addons` and `<odooBinPath-dir>/odoo/addons`
- **`--addons-path` always passed on CLI** — Overrides conf file value, ensuring extension-selected paths take priority. Conf file handles everything else (`-c configFile`)

### Changed Modules Detection

- **Staged changes included** — Now runs both `git diff --name-only HEAD` (unstaged) and `git diff --name-only --cached HEAD` (staged)
- **Workspace root fallback** — If `addonsPaths` is not configured, walks up from workspace root to find git repo. Fixes detection on machines without explicit addons path configuration
- **`_findGitRootUp`** — Walks up directory tree from each addons path to find git repo root. Works regardless of folder structure

### `buildOdooArgs` — Minimal by Default

- No hardcoded `--dev=all`, `--limit-time-real`, `--max-cron-threads`, `-s`
- When conf file exists: passes only `--addons-path` + `-c configFile`. Conf file handles everything else
- When no conf file: builds full args from settings
- `--database` only added if explicitly set in extension settings (not duplicated from conf)
- `--logfile` injected automatically when log panel is enabled
- `extraArgs` setting (default `[]`) — user controls all extra arguments

### New Features

- **Copy Model Name** — Right-click any model in Model Explorer → copies `res.partner` to clipboard. Also available as inline icon button. Status bar flashes confirmation
- **Open Config File** — Gear icon in sidebar title bar opens `.odoorc` directly in editor. Also available as "Config" button in Tools section
- **`debugOptions` setting** — Object spread directly into debugpy launch config. Default `{justMyCode: false, subProcess: false}`. User can add any valid debugpy key

### Bug Fixes

- **`getGithubPath` removed** — Was exported but function deleted, causing `utils.js` module load crash that broke all tree views ("There is no data provider registered")
- **`_findGitRepos` removed** — Dead code after `_findGitRootUp` replaced it
- **logPanel.js template literal** — Regex character class `}` inside `<script>` in template literal caused silent JS syntax error crashing entire extension module on load. Rewrote HTML generation as plain string concatenation
- **Traceback toggle onclick** — Nested quotes in `onclick="this.parentNode.classList.toggle('open')"` inside HTML string broke webview JS. Replaced with named function `toggleTb(el)`
- **Codicon icons showing squares** — Icon unicode chars rendered in body font. Fixed by wrapping all icons in `<span class="ic">` with `font-family: codicon`
- **Filter button active state invisible** — Active class was overriding colored text to `--vscode-button-foreground` (white), making text invisible. Fixed to use solid filled background per level color
- **Wrap not working** — `#log` had `white-space: nowrap` overriding `.lm` pre-wrap. Added `#log.wrap { white-space: normal }` and `#log.wrap .ln { min-width: unset }`
- **ERROR color wrong** — `--vscode-editorError-foreground` resolved to dark red in some themes, same as CRITICAL. Hardcoded `#f48771` for ERROR everywhere
- **Port polling removed** — Replaced 5×200ms polling loop with fixed 500ms delay. No `net` module needed
- **`django: true` removed** from `_buildModule` launch config

## 1.2.x

- Quick Find button renamed, addons/community path selection fixed, `getFullAddonsPath()` existence check

## 1.1.0

- Model Explorer, Cursor Auto-Reveal, XML Outline, XML Hover, Data Browser, SQL Tools, Breakpoints Tree, DB Config from Conf File

## 1.0.0

- Server Management, Module Management, Code Navigation, Log Filtering, JS Debugging, Database Switcher
