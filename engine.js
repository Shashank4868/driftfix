/*
 * Driftfix browser engine: the OpenAI Python SDK v0 -> v1 rules, ported from
 * src/driftfix/rules/openai_v1.py so the website can migrate real code live.
 *
 * Python source is lexed first so string and comment contents are never edited;
 * every rule runs on that masked copy and writes its edits back to the original.
 */
(function (root) {
  "use strict";

  var CALLS = {
    "ChatCompletion.create": ["chat.completions.create", false],
    "ChatCompletion.acreate": ["chat.completions.create", true],
    "Completion.create": ["completions.create", false],
    "Completion.acreate": ["completions.create", true],
    "Embedding.create": ["embeddings.create", false],
    "Embedding.acreate": ["embeddings.create", true],
    "Moderation.create": ["moderations.create", false],
    "Moderation.acreate": ["moderations.create", true],
    "Image.create": ["images.generate", false],
    "Image.acreate": ["images.generate", true],
    "Audio.transcribe": ["audio.transcriptions.create", false],
    "Audio.translate": ["audio.translations.create", false]
  };

  var RESPONSE_KEYS = new Set([
    "choices", "message", "content", "text", "delta", "role", "finish_reason",
    "index", "data", "embedding", "usage", "total_tokens", "prompt_tokens",
    "completion_tokens", "results", "flagged", "categories", "url", "b64_json",
    "id", "model", "created", "tool_calls", "function_call", "arguments", "name"
  ]);

  var ERRORS = {
    OpenAIError: "OpenAIError", APIError: "APIError", APIConnectionError: "APIConnectionError",
    RateLimitError: "RateLimitError", AuthenticationError: "AuthenticationError",
    PermissionError: "PermissionDeniedError", InvalidRequestError: "BadRequestError",
    Timeout: "APITimeoutError", ServiceUnavailableError: "InternalServerError", TryAgain: "APIError"
  };

  var SETTINGS = { api_key: "api_key", api_base: "base_url", organization: "organization" };

  var CHANGE = {
    id: "openai-python-v1",
    provider: "OpenAI Python SDK",
    title: "Migrate to the OpenAI Python SDK v1 client",
    from: "0.x",
    to: ">=1.0",
    changelog: "https://github.com/openai/openai-python/discussions/742",
    branch: "driftfix/openai-python-v1",
    summary: "Module-level calls such as openai.ChatCompletion.create were removed in openai 1.0.0 and now raise APIRemovedInV1. Calls move to a client object, responses become typed objects instead of dicts, and errors move from openai.error to the top-level module."
  };

  // ---- lexing -------------------------------------------------------------

  /** Same-length copy of src with string and comment contents blanked (newlines kept). */
  function mask(src) {
    var out = src.split("");
    var strings = [];
    var i = 0, n = src.length;
    while (i < n) {
      var c = src[i];
      if (c === "#") {
        while (i < n && src[i] !== "\n") { out[i] = " "; i++; }
        continue;
      }
      if (c === "'" || c === '"') {
        var triple = src.substr(i, 3) === c + c + c;
        var q = triple ? c + c + c : c;
        var start = i;
        i += q.length;
        while (i < n) {
          if (src[i] === "\\") { i += 2; continue; }
          if (src.substr(i, q.length) === q) break;
          if (!triple && src[i] === "\n") break;
          i++;
        }
        var end = Math.min(n, i + q.length);
        for (var k = start + q.length; k < Math.min(i, n); k++) if (out[k] !== "\n") out[k] = " ";
        strings.push({ start: start, end: end, value: src.slice(start + q.length, Math.min(i, n)) });
        i = end;
        continue;
      }
      i++;
    }
    return { text: out.join(""), strings: strings };
  }

  function lineStarts(src) {
    var starts = [0];
    for (var i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
    return starts;
  }

  function lineOf(starts, index) {
    var lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  }

  function matchClose(m, open) {
    var pairs = { "(": ")", "[": "]", "{": "}" };
    var stack = [];
    for (var i = open; i < m.length; i++) {
      var ch = m[i];
      if (pairs[ch]) stack.push(pairs[ch]);
      else if (ch === ")" || ch === "]" || ch === "}") {
        if (stack.pop() !== ch) return -1;
        if (!stack.length) return i;
      }
    }
    return -1;
  }

  function stmtEnd(m, from) {
    var depth = 0;
    for (var i = from; i < m.length; i++) {
      var ch = m[i];
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") depth--;
      else if (ch === "\n" && depth <= 0 && m[i - 1] !== "\\") return i;
    }
    return m.length;
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // ---- analysis -----------------------------------------------------------

  function findAliases(m) {
    var aliases = [];
    var re = /^[ \t]*import[ \t]+([^\n]+)$/gm, hit;
    while ((hit = re.exec(m))) {
      hit[1].split(",").forEach(function (part) {
        var bits = part.trim().split(/\s+as\s+/);
        if (bits[0] === "openai") aliases.push(bits[1] ? bits[1].trim() : "openai");
      });
    }
    return aliases;
  }

  function findCalls(m, aliases) {
    if (!aliases.length) return [];
    var re = new RegExp("\\b(" + aliases.map(escapeRe).join("|") + ")\\.(ChatCompletion|Completion|Embedding|Moderation|Image|Audio)\\.(create|acreate|transcribe|translate)\\s*\\(", "g");
    var calls = [], hit;
    while ((hit = re.exec(m))) {
      if (hit.index > 0 && m[hit.index - 1] === ".") continue;
      var key = hit[2] + "." + hit[3];
      if (!CALLS[key]) continue;
      var open = hit.index + hit[0].length - 1;
      calls.push({
        start: hit.index, funcEnd: hit.index + hit[0].replace(/\s*\($/, "").length, open: open,
        close: matchClose(m, open), alias: hit[1], key: key, path: CALLS[key][0], async: CALLS[key][1]
      });
    }
    return calls;
  }

  function trackResponses(m, calls) {
    var tracked = new Set();
    var starts = lineStarts(m);
    calls.forEach(function (call) {
      var ls = starts[lineOf(starts, call.start) - 1];
      var prefix = m.slice(ls, call.start);
      var a = prefix.match(/(\w+)\s*=\s*(?:await\s+)?$/);
      var f = prefix.match(/\bfor\s+(\w+)\s+in\s+(?:await\s+)?$/);
      if (a) tracked.add(a[1]);
      if (f) tracked.add(f[1]);
    });
    for (var pass = 0; pass < 6; pass++) {
      var before = tracked.size, hit;
      var assign = /^[ \t]*(\w+)\s*=\s*(\w+)\b/gm;
      while ((hit = assign.exec(m))) if (tracked.has(hit[2])) tracked.add(hit[1]);
      var loop = /\bfor\s+(\w+)\s+in\s+(\w+)\b/g;
      while ((hit = loop.exec(m))) if (tracked.has(hit[2])) tracked.add(hit[1]);
      if (tracked.size === before) break;
    }
    return tracked;
  }

  // ---- migration ----------------------------------------------------------

  function migrate(src) {
    src = src.replace(/\r\n/g, "\n");
    var lex = mask(src), m = lex.text;
    var starts = lineStarts(src);
    var line = function (i) { return lineOf(starts, i); };
    var aliases = findAliases(m);
    var result = { code: src, edits: [], notes: [], aliases: aliases, calls: 0, changed: false };
    if (!aliases.length) return result;

    var calls = findCalls(m, aliases);
    var tracked = trackResponses(m, calls);
    var edits = [];
    var notes = [];
    var needsAsync = calls.some(function (c) { return c.async; });

    // 1. calls move to the client
    calls.forEach(function (c) {
      var client = c.async ? "async_client" : "client";
      var after = client + "." + c.path;
      edits.push({ start: c.start, end: c.funcEnd, text: after, rule: "call moved to client", before: src.slice(c.start, c.funcEnd), after: after });
      if (c.close > 0) {
        var args = m.slice(c.open, c.close);
        var kw = /\brequest_timeout(\s*)=/g, hit;
        while ((hit = kw.exec(args))) {
          var at = c.open + hit.index;
          edits.push({ start: at, end: at + "request_timeout".length, text: "timeout", rule: "argument renamed", before: "request_timeout=", after: "timeout=" });
        }
        if (/\bengine\s*=/.test(args)) notes.push({ line: line(c.start), msg: "`engine=` is an Azure v0 argument; use `model=` with the AzureOpenAI client." });
      }
    });

    // 2. dict access on responses becomes attribute access, on response
    //    variables and directly on a call's result
    var roots = [];
    if (tracked.size) {
      var names = new RegExp("\\b(" + Array.from(tracked).map(escapeRe).join("|") + ")\\b", "g"), nh;
      while ((nh = names.exec(m))) {
        if (nh.index > 0 && m[nh.index - 1] === ".") continue;
        roots.push({ start: nh.index, after: nh.index + nh[0].length });
      }
    }
    calls.forEach(function (c) { if (c.close > 0) roots.push({ start: c.start, after: c.close + 1, call: c }); });
    roots.sort(function (a, b) { return a.start - b.start; });
    var consumed = -1;
    roots.forEach(function (rt) {
      if (rt.start < consumed && !rt.call) return;
      {
        var hit = { index: rt.start };
        var j = rt.after, chainStart = rt.start, converted = [], last = j;
        while (j < m.length) {
          if (m[j] === "[") {
            var close = matchClose(m, j);
            if (close < 0) break;
            var inner = src.slice(j + 1, close).trim();
            var key = inner.match(/^(['"])([A-Za-z_]\w*)\1$/);
            if (key && RESPONSE_KEYS.has(key[2])) converted.push({ start: j, end: close + 1, text: "." + key[2] });
            j = close + 1; last = j;
          } else if (m[j] === "." && /[A-Za-z_]/.test(m[j + 1] || "")) {
            var id = m.slice(j + 1).match(/^\w+/)[0];
            if (id === "get" && m[j + 4] === "(") {
              var gclose = matchClose(m, j + 4);
              notes.push({ line: line(j), msg: "`" + src.slice(hit.index, gclose + 1) + "` reads a v1 response like a dict; use attribute access." });
              break;
            }
            j += 1 + id.length;
            if (m[j] === "(") break;
            last = j;
          } else break;
        }
        if (converted.length) {
          var beforeChain = src.slice(chainStart, last), afterChain = beforeChain;
          for (var k = converted.length - 1; k >= 0; k--) {
            var cv = converted[k];
            afterChain = afterChain.slice(0, cv.start - chainStart) + cv.text + afterChain.slice(cv.end - chainStart);
            edits.push({ start: cv.start, end: cv.end, text: cv.text, silent: true });
          }
          if (rt.call) {
            var fn = (rt.call.async ? "async_client." : "client.") + rt.call.path;
            afterChain = fn + afterChain.slice(rt.call.funcEnd - chainStart);
          }
          edits.push({ start: chainStart, end: chainStart, text: "", rule: "dict access to attribute", before: beforeChain, after: afterChain, report: true });
        }
        consumed = Math.max(consumed, last);
      }
    });

    // 3. openai.error.X -> openai.Y
    var errRe = new RegExp("\\b(" + aliases.map(escapeRe).join("|") + ")\\.error\\.(\\w+)", "g"), e;
    while ((e = errRe.exec(m))) {
      if (e.index > 0 && m[e.index - 1] === ".") continue;
      var renamed = e[1] + "." + (ERRORS[e[2]] || e[2]);
      edits.push({ start: e.index, end: e.index + e[0].length, text: renamed, rule: "error class moved", before: e[0], after: renamed });
    }

    // 4. module settings move into the client constructor
    var setRe = new RegExp("^([ \\t]*)(" + aliases.map(escapeRe).join("|") + ")\\.(api_key|api_base|organization)\\s*=\\s*", "gm"), s;
    var settings = [];
    while ((s = setRe.exec(m))) {
      var end = stmtEnd(m, s.index + s[0].length);
      if (s[1].length) { notes.push({ line: line(s.index), msg: "`" + s[2] + "." + s[3] + "` is set inside a block; pass it to the client instead." }); continue; }
      settings.push({ start: s.index, end: end, name: s[3], value: src.slice(s.index + s[0].length, end).trim() });
    }
    var kwargs = settings.map(function (st) { return SETTINGS[st.name] + "=" + st.value; }).join(", ");
    var clientLines = "client = OpenAI(" + kwargs + ")" + (needsAsync ? "\nasync_client = AsyncOpenAI(" + kwargs + ")" : "");
    settings.forEach(function (st, idx) {
      var rule = { rule: "setting moved to client", before: src.slice(st.start, st.end), after: "client = OpenAI(" + SETTINGS[st.name] + "=...)" };
      if (idx === 0) edits.push(Object.assign({ start: st.start, end: st.end, text: clientLines }, rule));
      else edits.push(Object.assign({ start: st.start, end: Math.min(src.length, st.end + 1), text: "" }, rule));
    });

    // .get() on anything rooted in a response, outside the chains handled above
    if (!calls.length && !settings.length && !edits.length) { result.notes = notes; return result; }

    // 5. the import, and the client if no setting created it
    var importEnd = -1, imp = /^(?:import|from)[ \t]/gm, im;
    while ((im = imp.exec(m))) importEnd = stmtEnd(m, im.index);
    var header = "from openai import " + (needsAsync ? "OpenAI, AsyncOpenAI" : "OpenAI") + "\n" + (settings.length ? "" : clientLines + "\n");
    var insertAt = importEnd < 0 ? 0 : Math.min(src.length, importEnd + 1);
    edits.push({ start: insertAt, end: insertAt, text: header, insert: true });

    // apply, last first
    var applied = edits.filter(function (ed) { return !ed.report; }).sort(function (a, b) { return b.start - a.start || (a.insert ? 1 : -1); });
    var code = src, guard = Infinity;
    applied.forEach(function (ed) {
      if (ed.end > guard && !ed.insert) return;
      code = code.slice(0, ed.start) + ed.text + code.slice(ed.end);
      if (!ed.insert) guard = ed.start;
    });

    // 6. drop `import openai` when nothing uses it any more
    var cm = mask(code).text;
    var useRe = new RegExp("\\b(" + aliases.map(escapeRe).join("|") + ")\\b", "g"), uses = 0, u;
    while ((u = useRe.exec(cm))) {
      var ls = cm.lastIndexOf("\n", u.index) + 1;
      var lineText = cm.slice(ls, cm.indexOf("\n", u.index) < 0 ? cm.length : cm.indexOf("\n", u.index));
      if (/^\s*(import|from)\s/.test(lineText)) continue;
      uses++;
    }
    if (!uses) code = code.replace(/^import openai(?: as \w+)?\n/m, "");

    result.code = code;
    result.changed = code !== src;
    result.calls = calls.length;
    result.notes = notes;
    result.edits = edits.filter(function (ed) { return ed.rule && !ed.silent; }).map(function (ed) {
      return { line: line(ed.start), rule: ed.rule, before: ed.before.replace(/\s+/g, " ").trim(), after: ed.after };
    }).sort(function (a, b) { return a.line - b.line; });
    return result;
  }

  /** Lines still using removed v0 API after a migration (should be none). */
  function remaining(code) {
    var m = mask(code).text;
    var aliases = findAliases(m);
    var starts = lineStarts(code);
    var left = findCalls(m, aliases).map(function (c) { return lineOf(starts, c.start); });
    var err = new RegExp("\\b(" + (aliases.map(escapeRe).join("|") || "openai") + ")\\.error\\.", "g"), h;
    while ((h = err.exec(m))) left.push(lineOf(starts, h.index));
    return left;
  }

  /** Brackets balanced and nothing unterminated: a cheap structural check for the browser. */
  function balanced(code) {
    var m = mask(code).text, stack = [], pairs = { ")": "(", "]": "[", "}": "{" };
    for (var i = 0; i < m.length; i++) {
      var ch = m[i];
      if (ch === "(" || ch === "[" || ch === "{") stack.push(ch);
      else if (pairs[ch]) { if (stack.pop() !== pairs[ch]) return false; }
    }
    return stack.length === 0;
  }

  // ---- diff ---------------------------------------------------------------

  /** Line diff (LCS) grouped into hunks with `context` lines around each change. */
  function diff(a, b, context) {
    context = context == null ? 3 : context;
    var x = a.split("\n"), y = b.split("\n"), n = x.length, mm = y.length;
    var dp = [];
    for (var i = 0; i <= n; i++) { dp.push(new Int32Array(mm + 1)); }
    for (i = n - 1; i >= 0; i--) for (var j = mm - 1; j >= 0; j--)
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var ops = []; i = 0; j = 0;
    while (i < n && j < mm) {
      if (x[i] === y[j]) { ops.push({ t: " ", a: i + 1, b: j + 1, s: x[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: "-", a: i + 1, s: x[i] }); i++; }
      else { ops.push({ t: "+", b: j + 1, s: y[j] }); j++; }
    }
    while (i < n) { ops.push({ t: "-", a: i + 1, s: x[i] }); i++; }
    while (j < mm) { ops.push({ t: "+", b: j + 1, s: y[j] }); j++; }
    var keep = ops.map(function () { return false; });
    ops.forEach(function (op, idx) {
      if (op.t !== " ") for (var k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k++) keep[k] = true;
    });
    var hunks = [], cur = null;
    ops.forEach(function (op, idx) {
      if (!keep[idx]) { cur = null; return; }
      if (!cur) { cur = { lines: [] }; hunks.push(cur); }
      cur.lines.push(op);
    });
    var added = ops.filter(function (o) { return o.t === "+"; }).length;
    var removed = ops.filter(function (o) { return o.t === "-"; }).length;
    return { hunks: hunks, added: added, removed: removed };
  }

  var RULES = { calls: CALLS, errors: ERRORS, settings: SETTINGS, keys: Array.from(RESPONSE_KEYS).sort(), kwargs: { request_timeout: "timeout" } };
  var api = { CHANGE: CHANGE, RULES: RULES, migrate: migrate, remaining: remaining, balanced: balanced, diff: diff, mask: mask };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Driftfix = api;
})(typeof window !== "undefined" ? window : this);
