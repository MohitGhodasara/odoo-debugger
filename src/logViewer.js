const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const utils = require('./utils');

// ── State ──────────────────────────────────────────────────────────
let _panel = null;
let _vscode = null;
let _watcher = null;
let _filePos = 0;
let _debounceTimer = null;
let _firstLines = true; // focus panel on first log output

const LEVEL_PRIORITY = { CRITICAL: 0, ERROR: 1, WARNING: 2, INFO: 3, DEBUG: 4 };

// ── Public API ─────────────────────────────────────────────────────

function isEnabled() {
    return utils.getConfig('logPanel.enabled') !== false;
}

function getLogFile() {
    return utils.getConfig('logPanel.logFile') || '/tmp/odoo-vscode.log';
}

function setPanel(provider, vsCodeRef) {
    _panel = provider;
    _vscode = vsCodeRef;
}

/** Called before server starts — truncate log file */
function onServerStart() {
    if (!isEnabled()) return;
    const logFile = getLogFile();
    try { fs.writeFileSync(logFile, '', { flag: 'w' }); } catch (_) {}
    _filePos = 0;
    _firstLines = true;
    _panel?.clear();
    _startWatcher(logFile);
}

/** Called when server stops */
function onServerStop() {
    _stopWatcher();
}

function dispose() {
    _stopWatcher();
    _panel = null;
}

// ── File watcher ───────────────────────────────────────────────────

function _startWatcher(logFile) {
    _stopWatcher();
    // Wait for file to exist (Odoo may not write immediately)
    const tryWatch = (attempts) => {
        if (!fs.existsSync(logFile)) {
            if (attempts > 20) return; // give up after 10s
            setTimeout(() => tryWatch(attempts + 1), 500);
            return;
        }
        try {
            _watcher = fs.watch(logFile, { persistent: false }, () => {
                if (_debounceTimer) return;
                _debounceTimer = setTimeout(_readNewBytes, 100);
            });
            _watcher.on('error', () => _stopWatcher());
        } catch (_) {}
    };
    tryWatch(0);
}

function _stopWatcher() {
    if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
    if (_watcher) { try { _watcher.close(); } catch (_) {} _watcher = null; }
    _pendingLines = [];
}

function _readNewBytes() {
    _debounceTimer = null;
    const logFile = getLogFile();
    try {
        const stat = fs.statSync(logFile);
        if (stat.size <= _filePos) return;
        const fd = fs.openSync(logFile, 'r');
        const len = stat.size - _filePos;
        const buf = Buffer.alloc(len);
        const bytesRead = fs.readSync(fd, buf, 0, len, _filePos);
        fs.closeSync(fd);
        _filePos += bytesRead;
        const text = buf.slice(0, bytesRead).toString('utf8');
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length) {
            _panel?.appendLines(lines);
            // Focus log panel on first output — event-driven, no delay needed
            if (_firstLines && _vscode) {
                _firstLines = false;
                _vscode.commands.executeCommand('odooDebugger.logPanel.focus');
            }
        }
    } catch (_) {}
}

// ── Exports ────────────────────────────────────────────────────────

module.exports = { isEnabled, getLogFile, setPanel, onServerStart, onServerStop, dispose };
