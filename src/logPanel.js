const vscode = require('vscode');

const MAX_LINES = 3000;

class OdooLogPanelProvider {
    constructor(context) {
        this._view = null;
        this._buffer = [];
        this._filter = 'ALL';
        this._context = context;
        this._fontUri = '';
    }

    resolveWebviewView(webviewView) {
        this._view = webviewView;
        if (this._context) {
            this._fontUri = webviewView.webview.asWebviewUri(
                vscode.Uri.joinPath(this._context.extensionUri, 'resources', 'codicon.ttf')
            ).toString();
            webviewView.webview.options = {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(this._context.extensionUri, 'resources')]
            };
        } else {
            webviewView.webview.options = { enableScripts: true };
        }
        webviewView.webview.onDidReceiveMessage(function(msg) {
            if (msg.command === 'setFilter') {
                this._filter = msg.level;
            } else if (msg.command === 'gotoFile') {
                _gotoFile(msg.file, msg.line);
            }
        }.bind(this));
        webviewView.onDidChangeVisibility(function() {
            if (webviewView.visible) this._sendFull();
        }.bind(this));
        webviewView.webview.html = _buildHtml(MAX_LINES, this._fontUri);
    }

    appendLines(lines) {
        this._buffer.push.apply(this._buffer, lines);
        if (this._buffer.length > MAX_LINES) this._buffer = this._buffer.slice(-MAX_LINES);
        if (this._view && this._view.visible) {
            this._view.webview.postMessage({ type: 'append', lines: lines });
        }
    }

    clear() {
        this._buffer = [];
        this._filter = 'ALL';
        if (this._view) this._view.webview.postMessage({ type: 'clear' });
    }

    _sendFull() {
        if (!this._view) return;
        this._view.webview.postMessage({ type: 'full', lines: this._buffer, filter: this._filter });
    }
}

async function _gotoFile(file, line) {
    try {
        const doc = await vscode.workspace.openTextDocument(file);
        const editor = await vscode.window.showTextDocument(doc, { preserveFocus: false });
        const pos = new vscode.Position(Math.max(0, (parseInt(line) || 1) - 1), 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    } catch (_) {}
}

function _buildHtml(maxLines, fontUri) {
    const filters = ['ALL', 'CRITICAL', 'ERROR', 'WARNING', 'INFO', 'DEBUG'];
    // Always-colored filter buttons — color is permanent, count adds number
    const FCOLOR = { CRITICAL:'#c0392b', ERROR:'#f48771', WARNING:'#cca700', INFO:'#89d185', DEBUG:'#75beff', ALL:'' };
    const filterBtns = filters.map(function(l) {
        const active = l === 'ALL' ? ' active' : '';
        const style = FCOLOR[l] ? ' style="color:' + FCOLOR[l] + '"' : '';
        return '<button class="fb' + active + '" data-level="' + l + '" onclick="setFilter(\'' + l + '\')"' + style + '>' + l + '</button>';
    }).join('');

    const css = '' +
        '@font-face{font-family:codicon;src:url("' + (fontUri||'') + '") format("truetype")}' +
        '* {box-sizing:border-box;margin:0;padding:0}' +
        'body{display:flex;flex-direction:column;height:100vh;font-family:var(--vscode-editor-font-family,monospace);font-size:var(--vscode-editor-font-size,12px);color:var(--vscode-foreground);background:var(--vscode-editor-background);overflow:hidden}' +
        '#tb{display:flex;align-items:center;gap:3px;padding:3px 6px;flex-shrink:0;background:var(--vscode-sideBar-background);border-bottom:1px solid var(--vscode-widget-border,#3c3c3c);flex-wrap:wrap;row-gap:3px}' +
        '.fb{padding:2px 7px;border-radius:3px;border:none;cursor:pointer;font-size:11px;font-weight:700;background:transparent;color:var(--vscode-descriptionForeground)}' +
        '.fb:hover{opacity:0.8;background:var(--vscode-toolbar-hoverBackground,#ffffff18)}' +
        '.fb.active{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}' +
        '.fb[style].active{color:#fff!important}' +
        '.fb[data-level="CRITICAL"].active{background:#c0392b}' +
        '.fb[data-level="ERROR"].active{background:#f48771;color:#000!important}' +
        '.fb[data-level="WARNING"].active{background:#cca700;color:#000!important}' +
        '.fb[data-level="INFO"].active{background:#89d185;color:#000!important}' +
        '.fb[data-level="DEBUG"].active{background:#75beff;color:#000!important}' +
        '.fb.has-critical{text-decoration:underline;text-decoration-color:#c0392b}' +
        '.fb.has-error{text-decoration:underline;text-decoration-color:#f48771}' +
        '.fb.has-warn{text-decoration:underline;text-decoration-color:#cca700}' +
        '.sep{width:1px;height:14px;background:var(--vscode-widget-border,#555);margin:0 2px;flex-shrink:0}' +
        '#srch{flex:1;min-width:60px;max-width:180px;padding:2px 6px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;font-size:11px;outline:none}' +
        '#srch:focus{border-color:var(--vscode-focusBorder)}' +
        '.xb{padding:2px 5px;border-radius:3px;border:none;cursor:pointer;font-size:11px;background:transparent;color:var(--vscode-descriptionForeground);white-space:nowrap}' +
        '.xb:hover{color:var(--vscode-foreground);background:var(--vscode-list-hoverBackground)}' +
        '.xb.active{color:var(--vscode-button-background)}' +
        '#cnt{font-size:10px;color:var(--vscode-descriptionForeground);white-space:nowrap;margin-left:auto;padding:0 4px}' +
        '#log{flex:1;overflow-y:auto;overflow-x:auto;padding:2px 0;white-space:nowrap}' +
        '#log.wrap{white-space:normal;overflow-x:hidden}' +
        '#log.wrap .ln{min-width:unset}' +
        '#log.wrap .lm{white-space:pre-wrap!important;word-break:break-all}' +
        '.ln{display:flex;align-items:baseline;padding:1px 6px;position:relative;cursor:default;min-width:max-content}' +
        '.ln:hover{background:var(--vscode-list-hoverBackground)}' +
        '.ln.hidden{display:none}' +
        '.ts{color:var(--vscode-descriptionForeground);font-size:10px;flex-shrink:0;margin-right:6px;user-select:none}' +
        '.lv{font-size:10px;font-weight:700;flex-shrink:0;margin-right:6px;min-width:52px}' +
        '.lg{color:#7ec8e3;font-size:10px;flex-shrink:0;margin-right:6px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
        '.lm{flex:1;white-space:pre;line-height:1.5}' +
        '.cb{opacity:0;position:absolute;right:4px;top:1px;background:var(--vscode-button-secondaryBackground);border:none;border-radius:2px;color:var(--vscode-button-secondaryForeground);font-size:10px;cursor:pointer;padding:1px 4px}' +
        '.ln:hover .cb{opacity:1}' +
        '.lv-CRITICAL{color:#fff;background:#c0392b;border-radius:2px;padding:0 3px}' +
        '.lv-ERROR{color:#f48771}' +
        '.lv-WARNING{color:#cca700}' +
        '.lv-INFO{color:#89d185}' +
        '.lv-DEBUG{color:#75beff}' +
        '.ln.CRITICAL .lm{color:#c0392b}' +
        '.ln.ERROR .lm{color:#f48771}' +
        '.ln.WARNING .lm{color:#cca700}' +
        '.ln.DEBUG .lm{color:#75beff}' +
        '.tbg{border-left:2px solid var(--vscode-editorError-foreground,#f48771)55;margin:2px 6px}' +
        '.tbh{display:flex;align-items:center;gap:6px;padding:2px 6px;cursor:pointer;color:#f48771;font-size:11px;font-weight:600}' +
        '.tbh:hover{background:var(--vscode-list-hoverBackground)}' +
        '.tbt{font-size:9px;user-select:none;display:inline-block;transition:transform 0.1s}' +
        '.tbb{display:none;padding:2px 0}' +
        '.tbg.open .tbb{display:block}' +
        '.tbg.open .tbt{transform:rotate(90deg)}' +
        '.fl{color:#7ec8e3;text-decoration:underline;cursor:pointer}' +
        '.fl:hover{color:#fff}' +
        'mark{background:#ff0;color:#000;border-radius:2px}' +
        '#empty{color:var(--vscode-descriptionForeground);font-style:italic;padding:16px 12px;font-size:12px}';

    // Build JS as array joined — avoids ALL template literal / quote nesting issues
    const jsLines = [
        'var vsc=acquireVsCodeApi();',
        'var logEl=document.getElementById("log");',
        'var srch=document.getElementById("srch");',
        'var lockBtn=document.getElementById("lk");',
        'var wrapBtn=document.getElementById("wp");',
        'var cntEl=document.getElementById("cnt");',
        'var PRI={CRITICAL:0,ERROR:1,WARNING:2,INFO:3,DEBUG:4};',
        'var MAX='+maxLines+';',
        'var cf="ALL",st="",autoScroll=true,wrapMode=false,allLines=[];',

        'function parseLine(r){',
        '  var m=r.match(/^(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2},\\d+)\\s+\\d+\\s+(\\w+)\\s+(\\S+)\\s+(.*)/);',
        '  if(m)return{ts:m[1],level:m[2].toUpperCase(),logger:m[3],msg:m[4],raw:r};',
        '  return{ts:"",level:"INFO",logger:"",msg:r,raw:r};',
        '}',

        'function mf(p){if(cf==="ALL")return true;var l=p.level;return(PRI[l]!==undefined?PRI[l]:3)<=(PRI[cf]!==undefined?PRI[cf]:3);}',
        'function ms(p){return!st||p.raw.toLowerCase().indexOf(st.toLowerCase())!==-1;}',
        'function esc(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}',

        'function hl(s){',
        '  if(!st)return esc(s);',
        '  try{var re=new RegExp(st.replace(/[.+?^=!:${}()|\\[\\]\\\\]/g,"\\\\$&"),"gi");',
        '  return esc(s).replace(re,function(m){return"<mark>"+m+"</mark>";});}',
        '  catch(e){return esc(s);}',
        '}',

        'function lf(s){',
        '  return s.replace(/File "([^"]+)", line (\\d+)/g,function(_,f,l){',
        '    return"File \\"<span class=\\"fl\\" onclick=\\"gf(\'"+esc(f)+"\',"+l+")\\">"+esc(f)+"</span>\\", line "+l;',
        '  });',
        '}',

        'function makeLn(p){',
        '  var d=document.createElement("div");',
        '  d.className="ln "+p.level;',
        '  if(!mf(p)||!ms(p))d.classList.add("hidden");',
        '  var msg=lf(hl(p.msg));',
        '  var raw=esc(p.raw);',
        '  d.innerHTML=',
        '    (p.ts?"<span class=\\"ts\\">"+p.ts.slice(11)+"</span>":"")+',
        '    (p.level?"<span class=\\"lv lv-"+p.level+"\\">"+p.level+"</span>":"")+',
        '    (p.logger?"<span class=\\"lg\\" title=\\""+esc(p.logger)+"\\">"+esc(p.logger)+"</span>":"")+',
        '    "<span class=\\"lm\\">"+msg+"</span>"+',
        '    "<button class=\\"cb\\" onclick=\\"cp(this)\\" data-r=\\""+raw+"\\">copy</button>";',
        '  return d;',
        '}',

        'function toggleTb(el){el.parentNode.classList.toggle("open");}',

        'function makeTb(lines){',
        '  var last=parseLine(lines[lines.length-1]);',
        '  var summary=esc((last.msg||lines[lines.length-1]).slice(0,120));',
        '  var bodyHtml=lines.map(function(l){',
        '    var p=parseLine(l);',
        '    return"<div class=\\"ln\\"><span class=\\"lm\\">"+lf(esc(p.msg||l))+"</span></div>";',
        '  }).join("");',
        '  var d=document.createElement("div");',
        '  d.className="tbg";',
        '  d.innerHTML="<div class=\\"tbh\\" onclick=\\"toggleTb(this)\\"><span class=\\"tbt\\">&#9658;</span><span>"+summary+"</span></div><div class=\\"tbb\\">"+bodyHtml+"</div>";',
        '  return d;',
        '}',

        'function groupTb(lines){',
        '  var out=[],i=0;',
        '  while(i<lines.length){',
        '    var p=parseLine(lines[i]);',
        '    if(p.msg.indexOf("Traceback (most recent call last)")!==-1){',
        '      var tb=[lines[i]];i++;',
        '      while(i<lines.length&&!lines[i].match(/^\\d{4}-\\d{2}-\\d{2}/)){tb.push(lines[i]);i++;}',
        '      out.push({type:"tb",lines:tb});',
        '    }else{out.push({type:"ln",p:p});i++;}',
        '  }',
        '  return out;',
        '}',

        'function renderGroups(groups){',
        '  var frag=document.createDocumentFragment();',
        '  for(var i=0;i<groups.length;i++){',
        '    var g=groups[i];',
        '    if(g.type==="tb"){frag.appendChild(makeTb(g.lines));}',
        '    else{frag.appendChild(makeLn(g.p));}',
        '  }',
        '  return frag;',
        '}',

        'function appendLines(lines){',
        '  allLines.push.apply(allLines,lines);',
        '  if(allLines.length>MAX)allLines=allLines.slice(-MAX);',
        '  var frag=document.createDocumentFragment();',
        '  for(var i=0;i<lines.length;i++)frag.appendChild(makeLn(parseLine(lines[i])));',
        '  while(logEl.children.length>MAX+1)logEl.removeChild(logEl.firstChild);',
        '  var e=document.getElementById("empty");if(e)e.remove();',
        '  logEl.appendChild(frag);',
        '  updCnt();',
        '  if(autoScroll)logEl.scrollTop=logEl.scrollHeight;',
        '}',

        'function renderFull(){',
        '  logEl.innerHTML="";',
        '  if(!allLines.length){logEl.innerHTML="<div id=\\"empty\\">Waiting for Odoo server to start...</div>";updCnt();return;}',
        '  var groups=groupTb(allLines);',
        '  logEl.appendChild(renderGroups(groups));',
        '  updCnt();',
        '  if(autoScroll)logEl.scrollTop=logEl.scrollHeight;',
        '}',

        'function updCnt(){',
        '  var all=logEl.querySelectorAll(".ln").length;',
        '  var hid=logEl.querySelectorAll(".ln.hidden").length;',
        '  var vis=all-hid;',
        '  cntEl.textContent=(vis===all?all:vis+"/"+all)+" lines";',
        '  var crits=logEl.querySelectorAll(".ln.CRITICAL").length;',
        '  var errs=logEl.querySelectorAll(".ln.ERROR").length;',
        '  var warns=logEl.querySelectorAll(".ln.WARNING").length;',
        '  var cb=document.querySelector(".fb[data-level=\'CRITICAL\']");',
        '  var eb=document.querySelector(".fb[data-level=\'ERROR\']");',
        '  var wb=document.querySelector(".fb[data-level=\'WARNING\']");',
        '  if(cb){cb.textContent=crits>0?"CRITICAL("+crits+")":"CRITICAL";cb.classList.toggle("has-critical",crits>0);}',
        '  if(eb){eb.textContent=errs>0?"ERROR("+errs+")":"ERROR";eb.classList.toggle("has-error",errs>0);}',
        '  if(wb){wb.textContent=warns>0?"WARN("+warns+")":"WARNING";wb.classList.toggle("has-warn",warns>0);}',
        '}',

        'function setFilter(level){',
        '  cf=level;',
        '  document.querySelectorAll(".fb").forEach(function(b){b.classList.toggle("active",b.dataset.level===level);});',
        '  vsc.postMessage({command:"setFilter",level:level});',
        '  renderFull();',
        '}',

        'function applySearch(){st=srch.value;renderFull();}',

        'function clearLog(){allLines=[];logEl.innerHTML="<div id=\\"empty\\">Waiting for Odoo server to start...</div>";updCnt();}',

        'function toggleLock(){',
        '  autoScroll=!autoScroll;',
        '  lockBtn.classList.toggle("active",autoScroll);',
        '  lockBtn.textContent=autoScroll?"\\u2B07 Auto":"\\u23F8 Locked";',
        '  if(autoScroll)logEl.scrollTop=logEl.scrollHeight;',
        '}',

        'function toggleWrap(){',
        '  wrapMode=!wrapMode;',
        '  logEl.classList.toggle("wrap",wrapMode);',
        '  wrapBtn.classList.toggle("active",wrapMode);',
        '}',

        'function gf(file,line){vsc.postMessage({command:"gotoFile",file:file,line:line});}',

        'function cp(btn){',
        '  var r=btn.getAttribute("data-r");',
        '  navigator.clipboard.writeText(r).catch(function(){});',
        '  btn.textContent="copied!";',
        '  setTimeout(function(){btn.textContent="copy";},1200);',
        '}',

        'function navErr(dir){',
        '  var els=Array.from(logEl.querySelectorAll(".ln.ERROR,.ln.CRITICAL"));',
        '  if(!els.length)return;',
        '  var st2=logEl.scrollTop;',
        '  if(dir===1){for(var i=0;i<els.length;i++){if(els[i].offsetTop>st2+10){els[i].scrollIntoView({block:"center"});return;}}els[0].scrollIntoView({block:"center"});}',
        '  else{for(var i=els.length-1;i>=0;i--){if(els[i].offsetTop<st2-10){els[i].scrollIntoView({block:"center"});return;}}els[els.length-1].scrollIntoView({block:"center"});}',
        '}',

        'logEl.addEventListener("scroll",function(){',
        '  var atB=logEl.scrollHeight-logEl.scrollTop-logEl.clientHeight<40;',
        '  if(!atB&&autoScroll){autoScroll=false;lockBtn.classList.remove("active");lockBtn.textContent="\\u23F8 Locked";}',
        '});',

        'window.addEventListener("message",function(e){',
        '  var m=e.data;',
        '  if(m.type==="append"){appendLines(m.lines);}',
        '  else if(m.type==="full"){allLines=m.lines||[];if(m.filter)cf=m.filter;renderFull();}',
        '  else if(m.type==="clear"){allLines=[];cf="ALL";',
        '    document.querySelectorAll(".fb").forEach(function(b){b.classList.toggle("active",b.dataset.level==="ALL");});',
        '    logEl.innerHTML="<div id=\\"empty\\">Waiting for Odoo server to start...</div>";updCnt();}',
        '});',

        'updCnt();',
    ];

    const toolbar = '<div id="tb">' +
        filterBtns +
        '<span class="sep"></span>' +
        '<input id="srch" type="text" placeholder="Search..." oninput="applySearch()" />' +
        '<span class="sep"></span>' +
        '<button class="xb" onclick="navErr(-1)" title="Prev error">\u25B2 Err</button>' +
        '<button class="xb" onclick="navErr(1)" title="Next error">\u25BC Err</button>' +
        '<span class="sep"></span>' +
        '<button id="wp" class="xb" onclick="toggleWrap()">Wrap</button>' +
        '<button id="lk" class="xb active" onclick="toggleLock()">\u2B07 Auto</button>' +
        '<button class="xb" onclick="clearLog()">\u2715</button>' +
        '<span id="cnt">0 lines</span>' +
        '</div>';

    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' + css + '</style></head><body>' +
        toolbar +
        '<div id="log"><div id="empty">Waiting for Odoo server to start...</div></div>' +
        '<script>' + jsLines.join('\n') + '<\/script>' +
        '</body></html>';
}

module.exports = { OdooLogPanelProvider };
