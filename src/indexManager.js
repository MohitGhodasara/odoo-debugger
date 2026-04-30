'use strict';
const { Worker } = require('worker_threads');
const path = require('path');
const vscode = require('vscode');

const _index = {
    _models: null, _fields: null, _functions: null, _views: null, _fieldXml: null,
    models: null, fields: null, functions: null, views: null, fieldXml: null,
    pyReady: false, xmlReady: false,
};

let _utilitiesRef = null; // set after utilities is loaded to avoid circular dep

function _updateStatus() {
    if (_utilitiesRef) _utilitiesRef.updateStatusBar();
}

function _toMap(obj) {
    const m = new Map();
    if (obj) for (const [k, v] of Object.entries(obj)) m.set(k, v);
    return m;
}

// ── Worker launcher ────────────────────────────────────────────────

let _pyWorker = null;
let _xmlWorker = null;
let _debounceTimer = null;
let _addonsDirs = [];
let _onReadyCallbacks = [];

function _startPyWorker(dirs) {
    if (_pyWorker) { try { _pyWorker.terminate(); } catch (_) {} }
    _index.pyReady = false;
    _updateStatus();
    _pyWorker = new Worker(path.join(__dirname, 'pyIndexWorker.js'), { workerData: { addonsDirs: dirs } });
    _pyWorker.on('message', msg => {
        if (msg.type !== 'done') return;
        _index._models = msg.models;
        _index._fields = msg.fields;
        _index._functions = msg.functions;
        _index.models = _toMap(msg.models);
        _index.fields = _toMap(msg.fields);
        _index.functions = _toMap(msg.functions);
        _index.pyReady = true;
        _updateStatus();
        _fireReady();
    });
    _pyWorker.on('error', e => console.error('[pyIndexWorker]', e.message));
}

function _startXmlWorker(dirs) {
    if (_xmlWorker) { try { _xmlWorker.terminate(); } catch (_) {} }
    _index.xmlReady = false;
    _updateStatus();
    _xmlWorker = new Worker(path.join(__dirname, 'xmlIndexWorker.js'), { workerData: { addonsDirs: dirs } });
    _xmlWorker.on('message', msg => {
        if (msg.type !== 'done') return;
        _index._views = msg.views;
        _index._fieldXml = msg.fieldXml;
        _index.views = _toMap(msg.views);
        _index.fieldXml = _toMap(msg.fieldXml);
        _index.xmlReady = true;
        _updateStatus();
        _fireReady();
    });
    _xmlWorker.on('error', e => console.error('[xmlIndexWorker]', e.message));
}

function _fireReady() {
    if (!_index.pyReady || !_index.xmlReady) return;
    for (const cb of _onReadyCallbacks) { try { cb(); } catch (_) {} }
    _onReadyCallbacks = [];
}

// ── Public API ─────────────────────────────────────────────────────

function startIndex(addonsDirs, utilitiesRef) {
    _addonsDirs = addonsDirs;
    if (utilitiesRef) _utilitiesRef = utilitiesRef;
    _updateStatus();
    _startPyWorker(addonsDirs);
    _startXmlWorker(addonsDirs);
}

function reindex(addonsDirs) {
    _addonsDirs = addonsDirs || _addonsDirs;
    if (_debounceTimer) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
        _startPyWorker(_addonsDirs);
        _startXmlWorker(_addonsDirs);
    }, 600);
}

function onReady(cb) {
    if (_index.pyReady && _index.xmlReady) { cb(); return; }
    _onReadyCallbacks.push(cb);
}

function isReady() { return _index.pyReady && _index.xmlReady; }

// Model lookup — returns array of sources or []
function getModel(modelName) {
    return _index.models ? (_index.models.get(modelName) || []) : [];
}

// All models — returns Map or empty Map
function getModelsMap() {
    return _index.models || new Map();
}

// Field definitions — returns array or []
function getField(modelName, fieldName) {
    return _index.fields ? (_index.fields.get(`${modelName}:${fieldName}`) || []) : [];
}

// Function definitions — returns array or []
function getFunction(modelName, funcName) {
    return _index.functions ? (_index.functions.get(`${modelName}:${funcName}`) || []) : [];
}

// View by short or full xmlId
function getView(xmlId) {
    if (!_index.views) return null;
    const short = xmlId.includes('.') ? xmlId.split('.').slice(1).join('.') : xmlId;
    return _index.views.get(short) || _index.views.get(xmlId) || null;
}

// All views — returns Map
function getViewsMap() {
    return _index.views || new Map();
}

// Field XML usages — returns array or []
function getFieldXml(modelName, fieldName) {
    return _index.fieldXml ? (_index.fieldXml.get(`${modelName}:${fieldName}`) || []) : [];
}

// Find model name for a given file+fieldName
function findModelForField(filePath, fieldName) {
    if (!_index.models) return '';
    for (const [mn, srcs] of _index.models) {
        if (srcs.some(s => s.filePath === filePath && s.fields.some(f => f.name === fieldName))) return mn;
    }
    return '';
}

// Find model name for a given file+methodName
function findModelForMethod(filePath, methodName) {
    if (!_index.models) return '';
    for (const [mn, srcs] of _index.models) {
        if (srcs.some(s => s.filePath === filePath && (s.methods || []).some(m => m.name === methodName))) return mn;
    }
    return '';
}

// Build view inheritance tree: given a root xmlId, return { root, childrenMap }
// childrenMap: shortXmlId -> [child views]
function buildViewTree(rootXmlId) {
    if (!_index.views) return null;
    const short = rootXmlId.includes('.') ? rootXmlId.split('.').slice(1).join('.') : rootXmlId;
    const root = _index.views.get(short);
    if (!root) return null;

    const childrenMap = new Map();
    for (const [, v] of _index.views) {
        if (!v.inheritRef) continue;
        const parentShort = v.inheritRef.includes('.') ? v.inheritRef.split('.').slice(1).join('.') : v.inheritRef;
        if (!childrenMap.has(parentShort)) childrenMap.set(parentShort, []);
        childrenMap.get(parentShort).push(v);
    }

    // Walk up to find true root
    let trueRoot = root;
    const visited = new Set();
    while (trueRoot.inheritRef && !visited.has(trueRoot.fullXmlId)) {
        visited.add(trueRoot.fullXmlId);
        const ps = trueRoot.inheritRef.includes('.') ? trueRoot.inheritRef.split('.').slice(1).join('.') : trueRoot.inheritRef;
        const parent = _index.views.get(ps);
        if (!parent) {
            trueRoot = { xmlId: ps, fullXmlId: trueRoot.inheritRef, inheritRef: '', _stub: true, module: trueRoot.inheritRef.split('.')[0] || '' };
            break;
        }
        trueRoot = parent;
    }

    return { root: trueRoot, childrenMap };
}

function dispose() {
    if (_pyWorker) { try { _pyWorker.terminate(); } catch (_) {} _pyWorker = null; }
    if (_xmlWorker) { try { _xmlWorker.terminate(); } catch (_) {} _xmlWorker = null; }
    if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
}

module.exports = { startIndex, reindex, onReady, isReady, getModel, getModelsMap, getField, getFunction, getView, getViewsMap, getFieldXml, findModelForField, findModelForMethod, buildViewTree, dispose };
