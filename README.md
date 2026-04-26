# Odoo Debugger

All-in-one Odoo development toolkit for VS Code. Run, debug, update modules, navigate code, filter logs, manage breakpoints — all from a single sidebar panel.

## Features

### 🖥️ Server
- **Run Odoo** (`Ctrl+Shift+R`) — Start server in terminal with virtualenv activated
- **Debug Odoo** — Launch with VS Code debugger (breakpoints work)
- **Stop** (`Ctrl+Shift+S`) — Stop running server
- Auto-stops before update/install, auto-restarts after

### 📦 Modules
- **Update Module** (`Ctrl+Shift+U`) — Pick from module list (git-changed shown first)
- **Install Module** — Same picker, runs `--init`
- **Update Changed** (`Ctrl+Shift+G`) — Auto-detects modules with uncommitted git changes
- **Scaffold** — Generate new module from template
- Fast update/install without debugger overhead

### 🧭 Navigation
- **Toggle Model ↔ View** (`Ctrl+Shift+T`) — Jump between `.py` and `_views.xml`
- **Go to Model** (`Ctrl+Shift+M`) — Find `_name = 'model.name'`
- **Go to Function Def** (`Ctrl+Shift+D`) — Find original definition (skips `super()` overrides)
- **Go to XML ID** (`Ctrl+Shift+X`) — Find XML record by id
- Works on **word under cursor** — no need to select text first
- Available in **right-click context menu**

### 📊 Log Filtering
- Filter terminal output by level: `ALL | ERROR | WARNING | INFO | DEBUG`
- Real-time filtering when server is running
- No log file configuration needed — captures directly from terminal

### 🐛 Debugging
- **Breakpoints panel** — View, toggle, remove breakpoints from sidebar
- **Debug controls** — Continue, Step Over/Into/Out, Restart, Stop
- **JS Debugging** — Launch Chrome with debug port, auto-generated pathMapping

### 🔧 Tools
- Switch Database, Open Odoo in Browser, Debug Mode URL
- Clear Asset Bundles, Remove Unused Imports
- Kill Processes, Start PostgreSQL, Drop Database
- Manage Addons Paths, Odoo Shell

## Requirements

- **Odoo source** with `odoo-bin` in your workspace
- **Python** virtualenv (auto-detected from VS Code's selected interpreter)
- **PostgreSQL** for database operations
- **ms-python.debugpy** extension for Python debugging

## Configuration

Open Settings → search "Odoo Debugger":

| Setting | Default | Description |
|---|---|---|
| `odooDev.database` | `odoo18` | PostgreSQL database name |
| `odooDev.venvPath` | (auto-detect) | Virtualenv directory path |
| `odooDev.communityPath` | `${workspaceFolder}/community` | Odoo community source |
| `odooDev.addonsPaths` | `[]` | Custom addons directories |
| `odooDev.configFile` | `.odoorc` | Odoo config file |
| `odooDev.port` | `8069` | HTTP port |

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+R` | Run Odoo |
| `Ctrl+Shift+S` | Stop Odoo |
| `Ctrl+Shift+U` | Update Module |
| `Ctrl+Shift+G` | Update Changed Modules |
| `Ctrl+Shift+T` | Toggle Model ↔ View |
| `Ctrl+Shift+M` | Go to Model |
| `Ctrl+Shift+D` | Go to Function Definition |
| `Ctrl+Shift+X` | Go to XML ID |

## Platform Support

Works on **Linux**, **macOS**, and **Windows**.

## License

MIT © Mohit Ghodasara
