const fs = require('fs');
const vscode = require('vscode');
const utils = require('./utils');

// ── State ──────────────────────────────────────────────────────────
let _panel      = null;
let _vscode     = null;
let _watcher    = null;   // fs.watch (inotify/FSEvents/ReadDirChanges)
let _pollTimer  = null;   // fs.watchFile fallback interval
let _debounce   = null;
let _filePos    = 0;
let _firstLines = true;
let _safetyTimer = null;

// ── Public API ─────────────────────────────────────────────────────

function isEnabled() {
    return utils.getConfig('logPanel.enabled') !== false;
}

function getLogFile() {
    return utils.getConfig('logPanel.logFile') || '/tmp/odoo-vscode.log';
}

function setPanel(provider, vsCodeRef) {
    _panel   = provider;
    _vscode  = vsCodeRef;
}

/** Called when server starts */
function onServerStart() {
    if (!isEnabled()) return;
    _stopWatcher();
    _firstLines = true;
    _panel?.clear();

    const logFile = getLogFile();

    // Don't truncate — record current file size as start position.
    // This skips old content and only reads new output from this server launch.
    try {
        _filePos = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
    } catch (_) {
        _filePos = 0;
    }

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

// ── Watcher ────────────────────────────────────────────────────────

function _startWatcher(logFile) {
    // Strategy 1: fs.watch — instant notification (inotify/FSEvents)
    // Works on Linux/macOS reliably. Windows temp files can be flaky.
    try {
        _watcher = fs.watch(logFile, { persistent: false }, () => {
            _scheduleRead();
        });
        _watcher.on('error', () => {
            // fs.watch failed — rely on polling fallback only
            if (_watcher) { try { _watcher.close(); } catch (_) {} _watcher = null; }
        });
    } catch (_) {
        _watcher = null; // fs.watch unavailable — polling will handle it
    }

    // Strategy 2: polling fallback — works on ALL platforms, 100% reliable.
    // Fires every 1000ms regardless of fs.watch. Catches any missed events.
    _pollTimer = setInterval(() => {
        _scheduleRead();
    }, 1000);

    // Immediate read — catch bytes written before watcher registered
    _readNewBytes();

    // Safety read at 2s — catch anything missed during startup burst
    _safetyTimer = setTimeout(() => { _safetyTimer = null; _readNewBytes(); }, 2000);
}

function _stopWatcher() {
    if (_debounce)     { clearTimeout(_debounce);   _debounce    = null; }
    if (_safetyTimer)  { clearTimeout(_safetyTimer); _safetyTimer = null; }
    if (_pollTimer)    { clearInterval(_pollTimer);  _pollTimer   = null; }
    if (_watcher)      { try { _watcher.close(); } catch (_) {} _watcher = null; }
}

function _scheduleRead() {
    // Debounce: batch rapid events into one read per 100ms
    if (_debounce) return;
    _debounce = setTimeout(() => {
        _debounce = null;
        _readNewBytes();
    }, 100);
}

function _readNewBytes() {
    const logFile = getLogFile();
    try {
        const stat = fs.statSync(logFile);
        if (stat.size <= _filePos) return; // nothing new
        const len = stat.size - _filePos;
        const buf = Buffer.alloc(len);
        const fd  = fs.openSync(logFile, 'r');
        const bytesRead = fs.readSync(fd, buf, 0, len, _filePos);
        fs.closeSync(fd);
        _filePos += bytesRead;
        const lines = buf.slice(0, bytesRead).toString('utf8')
            .split(/\r?\n/).filter(l => l.trim());
        if (!lines.length) return;
        _panel?.appendLines(lines);
        // Focus log panel on first output — event-driven
        if (_firstLines && _vscode) {
            _firstLines = false;
            _vscode.commands.executeCommand('odooDebugger.logPanel.focus');
        }
    } catch (_) {}
}

// ── Exports ────────────────────────────────────────────────────────

module.exports = { isEnabled, getLogFile, setPanel, onServerStart, onServerStop, dispose };
