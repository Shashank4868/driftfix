/*
 * Driftfix browser engine: the OpenAI Node.js SDK v3 -> v4 rules, ported from
 * src/driftfix/rules/openai_node_v4.py. tests/parity.py keeps the two identical.
 *
 * JavaScript is masked first (strings, template literals and comments blanked,
 * same length) so rules never edit text inside them.
 */
(function (root) {
  "use strict";

  var METHODS = {
    createChatCompletion: "chat.completions.create",
    createCompletion: "completions.create",
    createEmbedding: "embeddings.create",
    createImage: "images.generate",
    createImageEdit: "images.edit",
    createImageVariation: "images.createVariation",
    createModeration: "moderations.create",
    listModels: "models.list",
    retrieveModel: "models.retrieve"
  };
  var FLAG_METHODS = {
    createTranscription: "audio.transcriptions.create",
    createTranslation: "audio.translations.create",
    createFile: "files.create",
    createFineTune: "fineTuning.jobs.create"
  };
  var CONFIG_RENAMES = { basePath: "baseURL" };
  var V3_TYPES = { Configuration: true, OpenAIApi: true };

  var CHANGE = {
    id: "openai-node-v4",
    provider: "OpenAI Node.js SDK",
    title: "Migrate to the OpenAI Node.js SDK v4 client",
    from: "3.x",
    to: ">=4.0",
    changelog: "https://github.com/openai/openai-node/discussions/217",
    branch: "driftfix/openai-node-v4",
    language: "JavaScript/TypeScript",
    summary: "v4 replaced the axios-based OpenAIApi and Configuration classes with a single OpenAI client. Methods such as createChatCompletion moved to resources (openai.chat.completions.create), and responses are returned directly instead of under .data."
  };

  function mask(src) {
    var out = src.split(""), i = 0, n = src.length;
    while (i < n) {
      var c = src[i], nxt = i + 1 < n ? src[i + 1] : "";
      if (c === "/" && nxt === "/") {
        while (i < n && src[i] !== "\n") { out[i] = " "; i++; }
        continue;
      }
      if (c === "/" && nxt === "*") {
        var e = src.indexOf("*/", i + 2);
        e = e < 0 ? n : e + 2;
        for (var k = i; k < e; k++) if (out[k] !== "\n") out[k] = " ";
        i = e;
        continue;
      }
      if (c === "'" || c === '"' || c === "`") {
        var q = c, j = i + 1, depth = 0;
        while (j < n) {
          var ch = src[j];
          if (ch === "\\") { j += 2; continue; }
          if (q === "`" && ch === "$" && j + 1 < n && src[j + 1] === "{") { depth++; j += 2; continue; }
          if (q === "`" && depth && ch === "}") { depth--; j++; continue; }
          if (ch === q && !depth) break;
          if (q !== "`" && ch === "\n") break;
          j++;
        }
        for (k = i + 1; k < Math.min(j, n); k++) if (out[k] !== "\n") out[k] = " ";
        i = Math.min(n, j + 1);
        continue;
      }
      i++;
    }
    return out.join("");
  }

  function matchClose(m, open) {
    var pairs = { "(": ")", "[": "]", "{": "}" }, stack = [];
    for (var i = open; i < m.length; i++) {
      var ch = m[i];
      if (pairs[ch]) stack.push(pairs[ch]);
      else if (ch === ")" || ch === "]" || ch === "}") {
        if (!stack.length || stack.pop() !== ch) return -1;
        if (!stack.length) return i;
      }
    }
    return -1;
  }

  function statementEnd(m, start) {
    var depth = 0;
    for (var i = start; i < m.length; i++) {
      var ch = m[i];
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") depth--;
      else if (depth === 0 && ch === ";") return i + 1;
      else if (depth === 0 && ch === "\n" && i > start && m.slice(start, i).trim()) return i;
    }
    return m.length;
  }

  function lineOf(src, i) {
    var n = 1;
    for (var k = 0; k < i; k++) if (src.charCodeAt(k) === 10) n++;
    return n;
  }

  function stripLine(src, start, end) {
    var ls = src.lastIndexOf("\n", start - 1) + 1;
    var le = src.indexOf("\n", end);
    le = le < 0 ? src.length : le;
    if (!src.slice(ls, start).trim() && !src.slice(end, le).trim()) return [ls, Math.min(src.length, le + 1)];
    return [start, end];
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function renameConfig(args, masked) {
    var out = args;
    Object.keys(CONFIG_RENAMES).forEach(function (old) {
      var re = new RegExp("\\b" + old + "\\s*:", "g"), hits = [], h;
      while ((h = re.exec(masked))) hits.push(h.index);
      hits.reverse().forEach(function (at) { out = out.slice(0, at) + CONFIG_RENAMES[old] + out.slice(at + old.length); });
    });
    return out;
  }

  function leadWidth(s) { return s.length - s.replace(/^[ \t]+/, "").length; }

  function migrate(source) {
    var src = source.replace(/\r\n/g, "\n");
    var m = mask(src);
    var edits = [], notes = [];
    var line = function (i) { return lineOf(src, i); };
    var note = function (i, msg) { notes.push({ line: line(i), msg: msg }); };

    // Only files that import the v3 client classes from "openai"
    var impEs = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*(['"])openai\2[ \t]*(;?)/g;
    var impCjs = /(const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*(['"])openai\3\s*\)[ \t]*(;?)/g;
    var found = false;
    [[impEs, "es"], [impCjs, "cjs"]].forEach(function (pair) {
      var rx = pair[0], kind = pair[1], hit;
      while ((hit = rx.exec(src))) {
        if (m[hit.index] === " ") continue;
        var raw = kind === "es" ? hit[1] : hit[2];
        var names = raw.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
        var bare = names.map(function (s) { return s.split(" as ")[0].trim(); });
        if (!bare.some(function (b) { return V3_TYPES[b]; })) continue;
        found = true;
        var rest = names.filter(function (_, i) { return !V3_TYPES[bare[i]]; });
        var q = kind === "es" ? hit[2] : hit[3];
        var semi = kind === "es" ? hit[3] : hit[4];
        var text = kind === "es"
          ? (rest.length ? "import OpenAI, { " + rest.join(", ") + " } from " + q + "openai" + q + semi : "import OpenAI from " + q + "openai" + q + semi)
          : hit[1] + " OpenAI = require(" + q + "openai" + q + ")" + semi;
        if (rest.length) note(hit.index, "`" + rest.join(", ") + "` came from the v3 SDK and may not exist in v4; use the `OpenAI.Chat.*` types.");
        edits.push({ start: hit.index, end: hit.index + hit[0].length, text: text, rule: "import updated", before: hit[0].trim(), after: text });
      }
    });
    if (!found) return { code: source, edits: [], notes: [], aliases: [], calls: 0, changed: false };

    // new OpenAIApi(new Configuration({...})) inline
    var re = /new\s+OpenAIApi\s*\(\s*new\s+Configuration\s*\(/g, hit;
    while ((hit = re.exec(m))) {
      var cfgAt = m.indexOf("Configuration", hit.index);
      var innerOpen = m.indexOf("(", cfgAt);
      var innerClose = matchClose(m, innerOpen);
      var outerOpen = m.indexOf("(", hit.index);
      var outerClose = matchClose(m, outerOpen);
      if (innerClose < 0 || outerClose < 0) continue;
      var args = renameConfig(src.slice(innerOpen + 1, innerClose), m.slice(innerOpen + 1, innerClose));
      // Unwrapping one level of nesting: pull the inner block back to where the outer call sat.
      var cfgLine = src.lastIndexOf("\n", cfgAt - 1) + 1;
      var outLine = src.lastIndexOf("\n", hit.index - 1) + 1;
      if (cfgLine !== outLine) {
        var outerText = src.slice(outLine, hit.index);
        var base = leadWidth(outerText);
        var t = outerText.replace(/^\s+/, "");
        if (t[0] === "?" || t[0] === ":") base += 2;
        var shift = Math.max(0, leadWidth(src.slice(cfgLine, cfgAt)) - base);
        if (shift) args = args.split("\n").map(function (ln) { return ln.slice(0, shift).trim() === "" ? ln.slice(shift) : ln; }).join("\n");
      }
      var text = "new OpenAI(" + args + ")";
      edits.push({ start: hit.index, end: outerClose + 1, text: text, rule: "client constructed directly", before: src.slice(hit.index, outerClose + 1).split("\n")[0], after: "new OpenAI(...)" });
    }

    // const configuration = new Configuration({...}); ... new OpenAIApi(configuration)
    re = /(?:const|let|var)\s+(\w+)\s*(?::\s*\w+\s*)?=\s*new\s+Configuration\s*\(/g;
    while ((hit = re.exec(m))) {
      var cfg = hit[1];
      var open = m.indexOf("(", hit.index + hit[0].length - 1);
      var close = matchClose(m, open);
      if (close < 0) continue;
      var cargs = renameConfig(src.slice(open + 1, close), m.slice(open + 1, close));
      var use = new RegExp("new\\s+OpenAIApi\\s*\\(\\s*" + escapeRe(cfg) + "\\s*\\)").exec(m);
      if (!use) { note(hit.index, "`" + cfg + "` is a v3 Configuration that isn't passed to OpenAIApi here; pass its options to `new OpenAI()`."); continue; }
      var end = statementEnd(m, hit.index);
      var se = stripLine(src, hit.index, end);
      edits.push({ start: se[0], end: se[1], text: "", rule: "configuration folded into client", before: src.slice(hit.index, end).trim().split("\n")[0], after: "(removed)" });
      edits.push({ start: use.index, end: use.index + use[0].length, text: "new OpenAI(" + cargs + ")", rule: "client constructed directly", before: use[0], after: "new OpenAI({ ... })" });
    }

    // method calls
    var calls = [];
    re = new RegExp("\\.(" + Object.keys(METHODS).concat(Object.keys(FLAG_METHODS)).join("|") + ")\\s*\\(", "g");
    while ((hit = re.exec(m))) {
      var name = hit[1], openI = hit.index + hit[0].length - 1, closeI = matchClose(m, openI);
      if (FLAG_METHODS[name]) { note(hit.index, "`" + name + "` takes different arguments in v4 (`" + FLAG_METHODS[name] + "`); migrate it by hand."); continue; }
      var nm = "." + METHODS[name];
      edits.push({ start: hit.index, end: hit.index + 1 + name.length, text: nm, rule: "method moved to resource", before: "." + name, after: nm });
      calls.push([hit.index, closeI]);
      if (closeI > 0) {
        var a = m.slice(openI + 1, closeI), depth = 0, split = -1;
        for (var k = 0; k < a.length; k++) {
          var ch = a[k];
          if (ch === "(" || ch === "[" || ch === "{") depth++;
          else if (ch === ")" || ch === "]" || ch === "}") depth--;
          else if (ch === "," && depth === 0 && a.slice(k + 1).trim()) { split = k; break; }
        }
        if (split >= 0) note(hit.index, "A second (axios request options) argument was passed; v4 takes request options like `{ timeout }` instead. Check it.");
        if (/responseType\s*:/.test(src.slice(openI, closeI))) note(hit.index, "`responseType: \"stream\"` streaming changed in v4: pass `stream: true` and iterate with `for await`.");
      }
    }

    // response unwrapping: v3 payload lived under `.data`
    var tracked = [];
    calls.forEach(function (c) {
      var start = c[0], closeI = c[1];
      var lineStart = m.lastIndexOf("\n", start - 1) + 1;
      var prefix = m.slice(lineStart, start);
      var assign = /(?:const|let|var)?\s*(\w+)\s*(?::\s*[\w.<>\[\]]+\s*)?=\s*(?:await\s+)?[\w.$]+$/.exec(prefix);
      var dest = /(?:const|let|var)\s*\{\s*data(?:\s*:\s*(\w+))?\s*\}\s*=\s*(?:await\s+)?[\w.$]+$/.exec(prefix);
      if (dest) {
        var nameD = dest[1] || "data";
        var brace = m.indexOf("{", lineStart + dest.index);
        var braceEnd = m.indexOf("}", brace) + 1;
        edits.push({ start: brace, end: braceEnd, text: nameD, rule: "response unwrapped", before: src.slice(brace, braceEnd), after: nameD });
      } else if (assign && tracked.indexOf(assign[1]) < 0) {
        tracked.push(assign[1]);
      }
      if (closeI > 0) {
        var after = m.slice(closeI + 1, closeI + 7);
        if (after.indexOf(").data") === 0 || after.indexOf(".data") === 0) {
          var at = m.indexOf(".data", closeI + 1);
          edits.push({ start: at, end: at + 5, text: "", rule: "response unwrapped", before: ".data", after: "(removed)" });
        }
      }
    });
    tracked.forEach(function (nameT) {
      var r = new RegExp("(?<![\\w.$])" + escapeRe(nameT) + "(\\?)?\\.data\\b", "g"), h;
      while ((h = r.exec(m))) {
        var opt = h[1] || "";
        edits.push({ start: h.index, end: h.index + h[0].length, text: nameT + opt, rule: "response unwrapped", before: src.slice(h.index, h.index + h[0].length), after: nameT + opt });
      }
    });

    // error shape changed
    re = /\b(\w+)(\?)?\.response(\?)?\.(status|data)\b/g;
    while ((hit = re.exec(m))) {
      if (["res", "response", "window", "document"].indexOf(hit[1]) >= 0) continue;
      note(hit.index, "`" + src.slice(hit.index, hit.index + hit[0].length) + "` reads an axios error; v4 errors are `OpenAI.APIError` with `.status` and `.error`.");
    }

    // leftover references to the removed classes (type annotations, instanceof, ...)
    re = /(?<![\w.$])(OpenAIApi|Configuration)(?![\w$])/g;
    while ((hit = re.exec(m))) {
      var inside = edits.some(function (e) { return e.start <= hit.index && hit.index < e.end; });
      if (inside) continue;
      if (hit[1] === "OpenAIApi") edits.push({ start: hit.index, end: hit.index + hit[0].length, text: "OpenAI", rule: "type renamed", before: "OpenAIApi", after: "OpenAI" });
      else note(hit.index, "`Configuration` no longer exists in v4; pass these options to `new OpenAI()`.");
    }

    // apply, last first, skipping overlaps (stable, like Python's sorted(reverse=True))
    var order = edits.map(function (e, i) { return [e, i]; }).sort(function (x, y) {
      return (y[0].start - x[0].start) || (y[0].end - x[0].end) || (x[1] - y[1]);
    });
    var code = src, guard = src.length + 1;
    order.forEach(function (pair) {
      var e = pair[0];
      if (e.end > guard) return;
      code = code.slice(0, e.start) + e.text + code.slice(e.end);
      guard = e.start;
    });

    var outEdits = edits.map(function (e, i) { return [e, i]; })
      .sort(function (x, y) { return (x[0].start - y[0].start) || (x[1] - y[1]); })
      .map(function (p) { return { line: line(p[0].start), rule: p[0].rule, before: p[0].before, after: p[0].after }; });
    var seen = {}, uniq = [];
    notes.forEach(function (n) { var key = n.line + "|" + n.msg; if (!seen[key]) { seen[key] = 1; uniq.push(n); } });
    uniq = uniq.map(function (n, i) { return [n, i]; }).sort(function (x, y) { return (x[0].line - y[0].line) || (x[1] - y[1]); }).map(function (p) { return p[0]; });
    return { code: code, edits: outEdits, notes: uniq, aliases: ["OpenAI"], calls: calls.length, changed: code !== src };
  }

  function balanced(code) {
    var m = mask(code), stack = [], pairs = { ")": "(", "]": "[", "}": "{" };
    for (var i = 0; i < m.length; i++) {
      var ch = m[i];
      if (ch === "(" || ch === "[" || ch === "{") stack.push(ch);
      else if (pairs[ch]) { if (stack.pop() !== pairs[ch]) return false; }
    }
    return stack.length === 0;
  }

  function remaining(code) {
    var m = mask(code), left = [], re = /\b(OpenAIApi|Configuration)\b|\.(createChatCompletion|createCompletion|createEmbedding|createImage|createModeration)\s*\(/g, h;
    while ((h = re.exec(m))) left.push(lineOf(code, h.index));
    return left;
  }

  var api = { CHANGE: CHANGE, RULES: { methods: METHODS, flagged: FLAG_METHODS, config: CONFIG_RENAMES }, migrate: migrate, mask: mask, remaining: remaining, balanced: balanced };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.Driftfix = root.Driftfix || {}; root.Driftfix.node = api; }
})(typeof window !== "undefined" ? window : this);
