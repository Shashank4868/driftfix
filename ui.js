/* Shared UI helpers for the Driftfix site and demo workspace: icons, escaping,
   Python highlighting and diff rendering. */
(function (root) {
  "use strict";

  var P = {
    pr: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M6 9v12"/>',
    merge: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
    prClosed: '<circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="m21 3-6 6"/><path d="m21 9-6-6"/><path d="M18 11.5V15"/><circle cx="18" cy="18" r="3"/>',
    prDraft: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M18 6V5"/><path d="M18 11v-1"/><path d="M6 9v12"/>',
    branch: '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    sliders: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    chevR: '<path d="m9 18 6-6-6-6"/>',
    chevD: '<path d="m6 9 6 6 6-6"/>',
    chevL: '<path d="m15 18-6-6 6-6"/>',
    max: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
    min: '<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/>',
    copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    play: '<path d="M6 3 20 12 6 21 6 3z"/>',
    ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    dot: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    tag: '<path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5"/>',
    eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
    terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
    arrowR: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    command: '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
    filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>',
    github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
    book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>'
  };

  function icon(name, size, cls) {
    return '<svg class="i' + (cls ? " " + cls : "") + '" width="' + (size || 16) + '" height="' + (size || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || "") + "</svg>";
  }

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function ticks(s) { return esc(s).replace(/`([^`]+)`/g, "<code>$1</code>"); }
  function plural(n, w, many) { return n + " " + (n === 1 ? w : (many || w + "s")); }

  var TOKEN = /(#[^\n]*)|([rRbBuUfF]{0,2}(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?))|\b(def|class|return|import|from|as|for|in|if|else|elif|try|except|finally|async|await|with|while|not|and|or|is|None|True|False|yield|lambda|pass|continue|break|raise|global|nonlocal)\b|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_]\w*)(?=\s*\()/g;
  var V0 = /\b\w+\.(?:ChatCompletion|Completion|Embedding|Moderation|Image|Audio)\.(?:create|acreate|transcribe|translate)\b|\b\w+\.error\.\w+|\b(?:openai|oa)\.(?:api_key|api_base|organization)\b/g;

  var TOKEN_JS = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?)|\b(import|from|export|default|const|let|var|function|return|async|await|new|class|extends|if|else|for|of|in|try|catch|finally|throw|typeof|instanceof|interface|type|null|undefined|true|false|this|require)\b|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_$][\w$]*)(?=\s*\()/g;
  var V0_JS = /\b(?:createChatCompletion|createCompletion|createEmbedding|createImage|createImageEdit|createImageVariation|createModeration|createTranscription|createTranslation|listModels|retrieveModel)\b|\b(?:OpenAIApi|Configuration)\b|\bbasePath\b/g;

  function plainMark(text, markV0, js) {
    if (!markV0) return esc(text);
    var out = "", last = 0, m, rx = js ? V0_JS : V0;
    rx.lastIndex = 0;
    while ((m = rx.exec(text))) {
      out += esc(text.slice(last, m.index)) + '<mark class="v0" title="' + (js ? "Removed in openai 4.0 (Node)" : "Removed in openai 1.0") + '">' + esc(m[0]) + "</mark>";
      last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
  }

  /** lang: "py" (default) or "js" for JavaScript/TypeScript. */
  function highlight(code, markV0, lang) {
    var js = lang === "js", rx = js ? TOKEN_JS : TOKEN, out = "", last = 0, m;
    rx.lastIndex = 0;
    while ((m = rx.exec(code))) {
      if (m[0] === "") { rx.lastIndex++; continue; }
      out += plainMark(code.slice(last, m.index), markV0, js);
      var cls = m[1] ? "t-com" : m[2] ? "t-str" : m[3] ? "t-kw" : m[4] ? "t-num" : "t-fn";
      if (cls === "t-fn" && markV0) out += plainMark(m[0], true, js);
      else out += '<span class="' + cls + '">' + esc(m[0]) + "</span>";
      last = m.index + m[0].length;
    }
    return out + plainMark(code.slice(last), markV0, js);
  }

  function langOf(path) { return /\.(?:[cm]?[jt]sx?)$/i.test(path || "") ? "js" : "py"; }

  /** Unified diff from Driftfix.diff() output. */
  function diffHTML(d, opts) {
    opts = opts || {};
    var html = '<div class="diff">';
    d.hunks.forEach(function (h) {
      var a0 = null, b0 = null, ac = 0, bc = 0;
      h.lines.forEach(function (op) {
        if (a0 == null && op.a) a0 = op.a; if (b0 == null && op.b) b0 = op.b;
        if (op.t !== "+") ac++; if (op.t !== "-") bc++;
      });
      html += '<div class="dh"><span>@@ -' + (a0 || 0) + "," + ac + " +" + (b0 || 0) + "," + bc + " @@</span>" + (opts.label ? "<em>" + esc(opts.label) + "</em>" : "") + "</div>";
      h.lines.forEach(function (op) {
        var cls = op.t === "+" ? " add" : op.t === "-" ? " del" : "";
        html += '<div class="dl' + cls + '"><span class="dn">' + (op.a || "") + '</span><span class="dn">' + (op.b || "") + '</span><span class="ds">' + (op.t === " " ? "" : op.t === "-" ? "-" : "+") + '</span><span class="dc">' + (highlight(op.s, false, opts.lang) || " ") + "</span></div>";
      });
    });
    return html + "</div>";
  }

  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0"; ta.style.top = "0";
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  function copy(text, btn, done) {
    var label = btn ? btn.getAttribute("data-label") || btn.textContent : "";
    if (btn && !btn.getAttribute("data-label")) btn.setAttribute("data-label", label);
    function show(msg) { if (!btn) return; var span = btn.querySelector(".lbl") || btn; span.textContent = msg; setTimeout(function () { span.textContent = btn.getAttribute("data-label"); }, 1500); }
    function fallback() { var ok = legacyCopy(text); show(ok ? "Copied" : "Press Ctrl+C"); if (done) done(ok); }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { show("Copied"); if (done) done(true); }, fallback);
      else fallback();
    } catch (e) { fallback(); }
  }

  var reduce = !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);

  root.DriftfixUI = { icon: icon, esc: esc, ticks: ticks, plural: plural, highlight: highlight, langOf: langOf, diffHTML: diffHTML, copy: copy, reduce: reduce };
})(window);
