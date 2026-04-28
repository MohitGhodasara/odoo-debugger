const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const utils = require('./utils');

async function toggleModelView() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const filePath = editor.document.uri.fsPath;
    const ext = path.extname(filePath);
    const baseName = path.basename(filePath, ext);
    const dirName = path.dirname(filePath);

    if (ext === '.py') {
        const viewsDir = path.join(dirName, '..', 'views');
        const target = path.join(viewsDir, `${baseName}_views.xml`);
        await _openIfExists(target, viewsDir, `*${baseName}*view*.xml`);
    } else if (ext === '.xml') {
        const modelName = baseName.replace(/_views?$/, '');
        const modelsDir = path.join(dirName, '..', 'models');
        const target = path.join(modelsDir, `${modelName}.py`);
        await _openIfExists(target, modelsDir, `*${modelName}*.py`);
    }
}

async function _openIfExists(exactPath, searchDir, globPattern) {
    if (fs.existsSync(exactPath)) {
        const doc = await vscode.workspace.openTextDocument(exactPath);
        await vscode.window.showTextDocument(doc);
        return;
    }
    const uris = await vscode.workspace.findFiles(
        new vscode.RelativePattern(searchDir, globPattern), null, 5
    );
    if (uris.length === 1) {
        const doc = await vscode.workspace.openTextDocument(uris[0]);
        await vscode.window.showTextDocument(doc);
    } else if (uris.length > 1) {
        const pick = await vscode.window.showQuickPick(
            uris.map(u => ({ label: path.basename(u.fsPath), detail: u.fsPath, uri: u })),
            { title: 'Multiple matches found' }
        );
        if (pick) {
            const doc = await vscode.workspace.openTextDocument(pick.uri);
            await vscode.window.showTextDocument(doc);
        }
    } else {
        vscode.window.showInformationMessage('No matching file found.');
    }
}

async function gotoModel() {
    const modelName = await vscode.window.showInputBox({
        title: 'Go to Model', placeHolder: 'e.g. res.partner', prompt: 'Enter Odoo model name'
    });
    if (modelName) await _findModel(modelName);
}

async function gotoModelFromSelection() {
    const text = _getTextOrWordAtCursor();
    if (text) await _findModel(text);
}

async function _findModel(modelName) {
    const root = utils.getWorkspaceRoot();
    try {
        const pattern = `_name = ['"]{1}${modelName}['"]{1}`;
        if (process.platform === 'win32') {
            const out = execSync(
                `findstr /S /N /R /C:"_name = '${modelName}'" "${root}\\*.py"`,
                { encoding: 'utf8', timeout: 10000 }
            );
            const match = out.trim().split('\n')[0];
            if (match) {
                const parts = match.split(':');
                await _openAtLine(parts[0], parseInt(parts[1], 10));
                return;
            }
        } else {
            const out = execSync(
                `grep -rnw -m 1 --include '*.py' '${root}' -e "_name = [\\\"\\']${modelName}[\\\"\\']"`,
                { encoding: 'utf8', timeout: 10000 }
            );
            const match = out.trim().split('\n')[0];
            if (match) {
                const [file, line] = match.split(':');
                await _openAtLine(file, parseInt(line, 10));
                return;
            }
        }
    } catch (_) {}
    vscode.window.showInformationMessage(`Model "${modelName}" not found.`);
}

async function gotoXmlId() {
    const xmlId = await vscode.window.showInputBox({
        title: 'Go to XML ID', placeHolder: 'e.g. base.view_partner_form', prompt: 'Enter XML ID'
    });
    if (xmlId) await _findXmlId(xmlId);
}

async function gotoXmlIdFromSelection() {
    const text = _getTextOrWordAtCursor();
    if (text) await _findXmlId(text);
}

async function _findXmlId(xmlId) {
    const root = utils.getWorkspaceRoot();
    try {
        if (process.platform === 'win32') {
            const out = execSync(
                `findstr /S /N /C:"id=\"${xmlId}\"" "${root}\\*.xml"`,
                { encoding: 'utf8', timeout: 10000 }
            );
            const match = out.trim().split('\n')[0];
            if (match) {
                const parts = match.split(':');
                await _openAtLine(parts[0], parseInt(parts[1], 10));
                return;
            }
        } else {
            const out = execSync(
                `grep -rnw -m 1 --include '*.xml' '${root}' -e 'id="${xmlId}"'`,
                { encoding: 'utf8', timeout: 10000 }
            );
            const match = out.trim().split('\n')[0];
            if (match) {
                const [file, line] = match.split(':');
                await _openAtLine(file, parseInt(line, 10));
                return;
            }
        }
    } catch (_) {}
    vscode.window.showInformationMessage(`XML ID "${xmlId}" not found.`);
}

async function gotoFunctionDef() {
    const funcName = _getTextOrWordAtCursor();
    if (!funcName) return;
    const root = utils.getWorkspaceRoot();
    try {
        const out = execSync(
            `grep -rL -m 1 --include '*.py' '${root}' -e "super\\(.*\\)\\.${funcName}\\(.*\\)" | ` +
            `xargs grep -rnw -e "def ${funcName}(.*):$" 2>/dev/null | tail -1`,
            { encoding: 'utf8', timeout: 15000 }
        );
        const match = out.trim().split('\n').pop();
        if (match) {
            const [file, line] = match.split(':');
            await _openAtLine(file, parseInt(line, 10));
            return;
        }
    } catch (_) {}
    vscode.window.showInformationMessage(`Original definition of "${funcName}" not found.`);
}

async function gotoFunctionDefAll() {
    const funcName = _getTextOrWordAtCursor();
    if (!funcName) return;
    const root = utils.getWorkspaceRoot();
    try {
        const out = execSync(
            `grep -rL -m 1 --include '*.py' '${root}' -e "super\\(.*\\)\\.${funcName}\\(.*\\)" | ` +
            `xargs grep -rnw -e "def ${funcName}(.*):$" 2>/dev/null`,
            { encoding: 'utf8', timeout: 15000 }
        );
        const matches = out.trim().split('\n').filter(Boolean);
        if (!matches.length) {
            vscode.window.showInformationMessage(`No definitions of "${funcName}" found.`);
            return;
        }
        if (matches.length === 1) {
            const [file, line] = matches[0].split(':');
            await _openAtLine(file, parseInt(line, 10));
            return;
        }
        const items = matches.map(m => {
            const [file, line] = m.split(':');
            return { label: path.basename(file), description: `Line ${line}`, detail: file, file, line: parseInt(line, 10) };
        });
        const pick = await vscode.window.showQuickPick(items, { title: `Definitions of "${funcName}"` });
        if (pick) await _openAtLine(pick.file, pick.line);
    } catch (_) {
        vscode.window.showInformationMessage(`No definitions of "${funcName}" found.`);
    }
}

// ── Current Module Info ────────────────────────────────────────────

async function currentModuleInfo() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showInformationMessage('No file open.');
        return;
    }
    const mod = utils.detectModuleFromFile(editor.document.uri.fsPath);
    if (!mod) {
        vscode.window.showInformationMessage('Current file is not inside an Odoo module.');
        return;
    }

    // Parse manifest for depends and summary
    let depends = [];
    let summary = '';
    let version = '';
    try {
        const manifest = fs.readFileSync(path.join(mod.path, '__manifest__.py'), 'utf8');
        const depsMatch = manifest.match(/'depends'\s*:\s*\[([\s\S]*?)\]/);
        if (depsMatch) {
            depends = depsMatch[1].match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) || [];
        }
        const sumMatch = manifest.match(/'summary'\s*:\s*'([^']+)'/);
        if (sumMatch) summary = sumMatch[1];
        const verMatch = manifest.match(/'version'\s*:\s*'([^']+)'/);
        if (verMatch) version = verMatch[1];
    } catch (_) {}

    // Check installed state from DB (best effort)
    let dbState = '';
    try {
        const out = execSync(
            `psql -q -A -t -c "SELECT state FROM ir_module_module WHERE name='${mod.name}'" ${utils.getDatabase()}`,
            { encoding: 'utf8', timeout: 3000 }
        );
        dbState = out.trim();
    } catch (_) {}

    const lines = [
        `**Module:** ${mod.name}`,
        `**Path:** ${mod.path}`,
    ];
    if (version) lines.push(`**Version:** ${version}`);
    if (summary) lines.push(`**Summary:** ${summary}`);
    if (depends.length) lines.push(`**Depends:** ${depends.join(', ')}`);
    if (dbState) lines.push(`**DB State:** ${dbState}`);

    const action = await vscode.window.showInformationMessage(
        lines.join('\n'),
        { modal: false },
        'Open Manifest', 'Update Module'
    );
    if (action === 'Open Manifest') {
        const doc = await vscode.workspace.openTextDocument(path.join(mod.path, '__manifest__.py'));
        await vscode.window.showTextDocument(doc);
    } else if (action === 'Update Module') {
        const upgradeScript = utils.getConfig('upgradeScript');
        if (upgradeScript) {
            utils.runInTerminal('Odoo Build', `bash "${upgradeScript}" ${mod.name}`);
        } else {
            const args = utils.buildOdooArgs([`--update=${mod.name}`, '--stop-after-init']);
            const pythonPath = utils.getPythonPath();
            vscode.debug.startDebugging(undefined, {
                name: 'Odoo Build',
                type: 'debugpy',
                request: 'launch',
                program: utils.getOdooBin(),
                python: pythonPath,
                pythonPath: pythonPath,
                args,
                console: 'integratedTerminal',
                // VIRTUAL_ENV not set — debugpy uses the python path directly, setting VIRTUAL_ENV triggers activation scripts
            }, { noDebug: true, suppressDebugToolbar: true, suppressDebugStatusbar: true, suppressDebugView: true });
        }
    }
}

// ── Helpers ────────────────────────────────────────────────────────

/** Get selected text, or word under cursor if nothing selected */
function _getTextOrWordAtCursor(silent) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return '';
    const sel = editor.selection;
    let text = editor.document.getText(sel).trim();
    if (!text) {
        // No selection — get word under cursor
        const wordRange = editor.document.getWordRangeAtPosition(sel.active);
        if (wordRange) {
            text = editor.document.getText(wordRange).trim();
        }
    }
    if (!text && !silent) {
        vscode.window.showInformationMessage('No text selected or word under cursor.');
    }
    return text;
}

async function _openAtLine(filePath, line) {
    const doc = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(doc);
    const pos = new vscode.Position(Math.max(0, line - 1), 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

module.exports = {
    toggleModelView, gotoModel, gotoModelFromSelection,
    gotoXmlId, gotoXmlIdFromSelection, gotoFunctionDef, gotoFunctionDefAll,
    currentModuleInfo,
};
