'use strict';
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');

function findPyFiles(dir) {
    const results = [];
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return results; }
    for (const e of entries) {
        if (e.name === '__pycache__') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) results.push(...findPyFiles(full));
        else if (e.name.endsWith('.py') && e.name !== '__init__.py') results.push(full);
    }
    return results;
}

function parseFile(filePath) {
    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch (_) { return []; }
    const lines = content.split('\n');
    const results = [];
    let block = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^class\s+\w+/.test(line)) {
            if (block && block.name) results.push(block);
            let modelType = 'model';
            if (line.includes('TransientModel')) modelType = 'transient';
            else if (line.includes('AbstractModel')) modelType = 'abstract';
            block = { classLine: i + 1, name: null, isInherit: false, fields: [], methods: [], modelType, _lastDec: [] };
            continue;
        }
        if (!block) continue;
        const nm = line.match(/^\s{4}_name\s*=\s*['"]([^'"]+)['"]/);
        if (nm) { block.name = nm[1]; block.isInherit = false; continue; }
        const ih = line.match(/^\s{4}_inherit\s*=\s*['"]([^'"]+)['"]/);
        if (ih && !block.name) { block.name = ih[1]; block.isInherit = true; continue; }
        const ihl = line.match(/^\s{4}_inherit\s*=\s*\[\s*['"]([^'"]+)['"]/);
        if (ihl && !block.name) { block.name = ihl[1]; block.isInherit = true; continue; }
        const fm = line.match(/^\s{4}(\w+)\s*=\s*fields\.(\w+)\s*\(/);
        if (fm && fm[1] !== '_name' && fm[1] !== '_inherit') {
            const stringM = line.match(/string\s*=\s*['"]([^'"]+)['"]/);
            block.fields.push({ name: fm[1], type: fm[2], label: stringM ? stringM[1] : null, line: i + 1 });
        }
        const dm = line.match(/^\s{4}(@(?:api\.\w+|staticmethod|classmethod)[^\n]*)/);
        if (dm) { block._lastDec.push(dm[1].trim()); continue; }
        const mm = line.match(/^\s{4}def\s+(\w+)\s*\(([^]*?)\)/);
        if (mm) {
            const params = mm[2].replace(/self,?\s*/, '').trim();
            block.methods.push({ name: mm[1], params, decorator: block._lastDec.join(' '), line: i + 1 });
            block._lastDec = [];
        } else if (line.trim() && !line.trim().startsWith('@')) {
            block._lastDec = [];
        }
    }
    if (block && block.name) results.push(block);
    return results;
}

function run(addonsDirs) {
    // models: { modelName -> [{moduleName, filePath, line, isInherit, modelType, fields, methods}] }
    const models = {};
    // fields: { "modelName:fieldName" -> [{name, type, label, filePath, line, moduleName}] }
    const fields = {};
    // functions: { "modelName:funcName" -> [{name, decorator, filePath, line, moduleName, isInherit}] }
    const functions = {};

    for (const addonsDir of addonsDirs) {
        if (!fs.existsSync(addonsDir)) continue;
        let mods;
        try { mods = fs.readdirSync(addonsDir, { withFileTypes: true }); } catch (_) { continue; }
        for (const mod of mods) {
            if (!mod.isDirectory() || mod.name.startsWith('.') || mod.name === '__pycache__') continue;
            const modPath = path.join(addonsDir, mod.name);
            if (!fs.existsSync(path.join(modPath, '__manifest__.py'))) continue;
            const modelsDir = path.join(modPath, 'models');
            if (!fs.existsSync(modelsDir)) continue;
            for (const pyFile of findPyFiles(modelsDir)) {
                for (const parsed of parseFile(pyFile)) {
                    const source = {
                        moduleName: mod.name,
                        filePath: pyFile,
                        line: parsed.classLine,
                        isInherit: parsed.isInherit,
                        modelType: parsed.modelType,
                        fields: parsed.fields.map(f => ({ ...f, filePath: pyFile })),
                        methods: parsed.methods.map(m => ({ ...m, filePath: pyFile })),
                    };
                    if (!models[parsed.name]) models[parsed.name] = [];
                    models[parsed.name].push(source);

                    for (const f of source.fields) {
                        const key = `${parsed.name}:${f.name}`;
                        if (!fields[key]) fields[key] = [];
                        fields[key].push({ ...f, moduleName: mod.name, isInherit: parsed.isInherit });
                    }
                    for (const m of source.methods) {
                        const key = `${parsed.name}:${m.name}`;
                        if (!functions[key]) functions[key] = [];
                        functions[key].push({ ...m, moduleName: mod.name, isInherit: parsed.isInherit });
                    }
                }
            }
        }
    }
    return { models, fields, functions };
}

const result = run(workerData.addonsDirs);
parentPort.postMessage({ type: 'done', ...result });
