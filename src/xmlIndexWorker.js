'use strict';
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['data', 'demo', 'security', 'tests', 'migrations', 'static', 'i18n']);

function findXmlFiles(dir) {
    const results = [];
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return results; }
    for (const e of entries) {
        if (e.name.startsWith('.') || e.name === '__pycache__') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (!SKIP_DIRS.has(e.name)) results.push(...findXmlFiles(full));
        } else if (e.name.endsWith('.xml')) {
            results.push(full);
        }
    }
    return results;
}

function run(addonsDirs) {
    // views: { shortXmlId -> {xmlId, fullXmlId, inheritRef, modelName, module, filePath, line} }
    const views = {};
    // fieldXml: { "modelName:fieldName" -> [{filePath, line, recordId, viewType, modelName}] }
    const fieldXml = {};

    for (const addonsDir of addonsDirs) {
        if (!fs.existsSync(addonsDir)) continue;
        let mods;
        try { mods = fs.readdirSync(addonsDir, { withFileTypes: true }); } catch (_) { continue; }
        for (const mod of mods) {
            if (!mod.isDirectory() || mod.name.startsWith('.')) continue;
            for (const filePath of findXmlFiles(path.join(addonsDir, mod.name))) {
                let text;
                try { text = fs.readFileSync(filePath, 'utf8'); } catch (_) { continue; }
                if (!text.includes('<record')) continue;
                const lines = text.split('\n');

                let inRecord = false, inUiView = false, inArch = false, archDepth = 0;
                let recId = '', recModel = '', inheritRef = '', viewType = '', recLine = 0;

                for (let i = 0; i < lines.length; i++) {
                    const t = lines[i];
                    const tt = t.trim();

                    if (!inRecord) {
                        if (tt.includes('<record')) {
                            inRecord = true;
                            inUiView = tt.includes('model="ir.ui.view"') || tt.includes("model='ir.ui.view'");
                            inArch = false; archDepth = 0;
                            recId = ''; recModel = ''; inheritRef = ''; viewType = ''; recLine = i + 1;
                            const m = tt.match(/\bid=["']([^"']+)["']/);
                            if (m) recId = m[1];
                        }
                        continue;
                    }

                    if (tt.includes('</record>')) {
                        if (inUiView && recId) {
                            const shortId = recId.includes('.') ? recId.split('.').slice(1).join('.') : recId;
                            views[shortId] = { xmlId: shortId, fullXmlId: recId, inheritRef, modelName: recModel, module: mod.name, filePath, line: recLine };
                        }
                        inRecord = false; inUiView = false; inArch = false;
                        archDepth = 0; recId = ''; recModel = ''; inheritRef = ''; viewType = '';
                        continue;
                    }

                    if (!inUiView) continue;

                    if (!inArch) {
                        const mM = tt.match(/<field[^>]+name=["']model["'][^>]*>([^<]+)</);
                        if (mM) { recModel = mM[1].trim(); continue; }
                        const iM = tt.match(/<field[^>]+name=["']inherit_id["'][^>]+ref=["']([^"']+)["']/);
                        if (iM) { inheritRef = iM[1]; continue; }
                        const tM = tt.match(/<field[^>]+name=["']type["'][^>]*>([^<]+)</);
                        if (tM) { viewType = tM[1].trim(); continue; }
                        if (/<field[^>]+name=["']arch["']/.test(tt)) {
                            inArch = true; archDepth = 0;
                            if (tt.includes('</field>')) inArch = false;
                            continue;
                        }
                        continue;
                    }

                    // inside arch — detect view type from root tag
                    const VIEW_TAGS = ['list','form','kanban','tree','search','graph','pivot','calendar','gantt','activity'];
                    if (!viewType && archDepth === 0) {
                        const rt = tt.match(/^<(\w+)[\s>]/);
                        if (rt && VIEW_TAGS.includes(rt[1])) viewType = rt[1];
                    }

                    if (tt === '</field>' && archDepth === 0) { inArch = false; continue; }
                    if (/^<field[^>]+>/.test(tt) && !tt.includes('/>') && !tt.includes('</field>')) archDepth++;
                    if (tt.includes('</field>') && archDepth > 0) archDepth--;

                    // field usage inside arch
                    const fM = tt.match(/<field[^>]+name=["']([^"']+)["']/);
                    if (fM && recModel) {
                        const key = `${recModel}:${fM[1]}`;
                        if (!fieldXml[key]) fieldXml[key] = [];
                        fieldXml[key].push({ filePath, line: i + 1, recordId: recId, viewType: viewType || '', modelName: recModel });
                    }
                }
            }
        }
    }
    return { views, fieldXml };
}

const result = run(workerData.addonsDirs);
parentPort.postMessage({ type: 'done', ...result });
