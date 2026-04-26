const vscode = require('vscode');
const utils = require('./utils');

let _outputChannel = null;
let _terminalCaptureListener = null;
let _liveListener = null;
let _currentFilter = 'ALL';
let _capturedLines = [];
const MAX_CAPTURED = 5000;

const LEVEL_PRIORITY = { CRITICAL: 0, ERROR: 1, WARNING: 2, INFO: 3, DEBUG: 4 };

function stripAnsi(str) {
    return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

function getOutputChannel() {
    if (!_outputChannel) {
        _outputChannel = vscode.window.createOutputChannel('Odoo Logs', 'log');
    }
    return _outputChannel;
}

function _matchesFilter(line) {
    if (_currentFilter === 'ALL') return true;
    const match = line.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d+ \d+ (\w+)/);
    if (!match) return true;
    const level = match[1].toUpperCase();
    const filterPriority = LEVEL_PRIORITY[_currentFilter] ?? 3;
    const linePriority = LEVEL_PRIORITY[level] ?? 3;
    return linePriority <= filterPriority;
}

function _processTerminalData(data) {
    const raw = stripAnsi(data);
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        _capturedLines.push(trimmed);
        if (_capturedLines.length > MAX_CAPTURED) {
            _capturedLines.shift();
        }
    }
}

/** Start background capture of Odoo terminal output */
function startTerminalCapture() {
    stopTerminalCapture();
    _terminalCaptureListener = vscode.window.onDidWriteTerminalData(e => {
        const serverTerminal = utils.getServerTerminal();
        if (!serverTerminal || e.terminal !== serverTerminal) return;
        _processTerminalData(e.data);
    });
}

function stopTerminalCapture() {
    if (_terminalCaptureListener) {
        _terminalCaptureListener.dispose();
        _terminalCaptureListener = null;
    }
}

/** Start live filtered log view in Output Channel */
function startTailing() {
    stopLive();
    const channel = getOutputChannel();
    channel.clear();
    channel.appendLine(`── Odoo Logs (filter: ${_currentFilter}) ──`);
    channel.appendLine('');

    // Show existing captured lines filtered
    for (const line of _capturedLines) {
        if (_matchesFilter(line)) {
            channel.appendLine(line);
        }
    }

    // Live forward new lines
    const serverTerminal = utils.getServerTerminal();
    if (serverTerminal && utils.getServerState() !== 'stopped') {
        _liveListener = vscode.window.onDidWriteTerminalData(e => {
            if (e.terminal !== serverTerminal) return;
            const raw = stripAnsi(e.data);
            const lines = raw.split(/\r?\n/);
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed && _matchesFilter(trimmed)) {
                    channel.appendLine(trimmed);
                }
            }
        });
    } else if (_capturedLines.length === 0) {
        channel.appendLine('No logs captured. Start the Odoo server to see logs.');
    }

    channel.show(true);
}

function stopLive() {
    if (_liveListener) {
        _liveListener.dispose();
        _liveListener = null;
    }
}

function setFilter(level) {
    _currentFilter = level;
}

function getCurrentFilter() {
    return _currentFilter;
}

function clearCaptured() {
    _capturedLines = [];
}

function dispose() {
    stopLive();
    stopTerminalCapture();
    _capturedLines = [];
    if (_outputChannel) {
        _outputChannel.dispose();
        _outputChannel = null;
    }
}

module.exports = {
    startTailing, stopLive, setFilter,
    getCurrentFilter, getOutputChannel,
    startTerminalCapture, stopTerminalCapture, clearCaptured,
    dispose,
};
