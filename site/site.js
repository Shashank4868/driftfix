/* Landing page behaviour: playground, recorded run, demo window, contact form.
   All clicks go through one delegated handler on document. */
(function () {
  "use strict";
  var E = window.Driftfix, U = window.DriftfixUI, D = window.DriftfixWorkspaceData;
  var $ = function (id) { return document.getElementById(id); };
  var esc = U.esc, icon = U.icon, plural = U.plural;
  var CONTACT = ($("mail-addr") && $("mail-addr").textContent.trim()) || "hello@driftfix.dev";

  // ---------- inject icons and highlighted snippets declared in markup ----------
  document.querySelectorAll("[data-icon]").forEach(function (n) { n.insertAdjacentHTML("afterbegin", icon(n.getAttribute("data-icon"), +(n.getAttribute("data-size") || 16))); });
  document.querySelectorAll("[data-hl]").forEach(function (n) { n.innerHTML = U.highlight(n.textContent, n.getAttribute("data-hl") === "v0"); });

  // ---------- demo window ----------
  var frame = $("demo"), appRoot = $("app");
  if (window.DriftfixWorkspace && appRoot) window.DriftfixWorkspace.mount(appRoot, frame);

  // ---------- playground ----------
  var S = { mode: "support", files: [], current: 0, tab: "diff", merged: false, last: null, repo: null,
    source: { support: $("sample-support").textContent, worker: $("sample-worker").textContent,
      paste: "# Paste a Python file written for the old OpenAI SDK (openai < 1.0).\n# Driftfix rewrites it as you type.\n\nimport openai\n\nopenai.api_key = \"sk-...\"\n\nreply = openai.ChatCompletion.create(\n    model=\"gpt-4o-mini\",\n    messages=[{\"role\": \"user\", \"content\": \"Hello\"}],\n)\nprint(reply[\"choices\"][0][\"message\"][\"content\"])\n" } };
  var NAMES = { support: "app.py", worker: "worker.py", paste: "your_code.py" };
  var SUPPORT = S.source.support.replace(/\r\n/g, "\n");
  var src = $("pg-src"), hl = $("pg-hl"), gut = $("pg-gut"), timers = [];

  function paintEditor() {
    var code = src.value;
    hl.innerHTML = U.highlight(code, true) + "\n\n";
    var n = code.split("\n").length, g = [];
    for (var i = 1; i <= n; i++) g.push(i);
    gut.textContent = g.join("\n") + "\n\n";
    sync();
  }
  function sync() { hl.scrollTop = src.scrollTop; hl.scrollLeft = src.scrollLeft; gut.scrollTop = src.scrollTop; }
  src.addEventListener("scroll", sync);
  var deb;
  src.addEventListener("input", function () {
    paintEditor();
    if (S.mode === "repo") return;
    S.source[S.mode] = src.value;
    clearTimeout(deb); deb = setTimeout(function () { run(false); }, 200);
  });
  src.addEventListener("keydown", function (e) {
    if (e.key === "Tab" && !src.readOnly && !e.shiftKey) {
      e.preventDefault();
      var s = src.selectionStart, en = src.selectionEnd;
      src.value = src.value.slice(0, s) + "    " + src.value.slice(en);
      src.selectionStart = src.selectionEnd = s + 4;
      src.dispatchEvent(new Event("input"));
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(true); }
  });

  function migrate(path, code) {
    var t0 = performance.now(), before = code.replace(/\r\n/g, "\n"), r = E.migrate(before);
    return { path: path, before: before, after: r.code, result: r, diff: E.diff(before, r.code), remaining: E.remaining(r.code), balanced: E.balanced(r.code), ms: performance.now() - t0 };
  }
  function summary(files, note) {
    var s = { edits: 0, notes: 0, added: 0, removed: 0, changed: 0, left: 0, ok: true, ms: 0, calls: 0, note: note };
    files.forEach(function (f) {
      s.edits += f.result.edits.length; s.notes += f.result.notes.length; s.added += f.diff.added; s.removed += f.diff.removed;
      s.calls += f.result.calls; if (f.after !== f.before) s.changed++; s.left += f.remaining.length; s.ok = s.ok && f.balanced; s.ms += f.ms;
    });
    return s;
  }

  function pipeline(stage, s, failAt) {
    s = s || {};
    var steps = [
      ["Change", "openai 0.x → 1.x"],
      ["Scan", s.calls != null ? plural(s.calls, "removed call") + (s.edits > s.calls ? ", " + (s.edits - s.calls) + " related" : "") : "…"],
      ["Patch", s.edits != null ? (s.edits ? plural(s.edits, "edit") + " · +" + s.added + " −" + s.removed : "nothing to change") : "…"],
      ["Verify", s.left != null ? (s.left === 0 && s.ok ? "0 removed calls left" : plural(s.left, "call") + " left") : "…"],
      ["Pull request", s.edits != null ? (s.edits ? (s.notes ? plural(s.notes, "item") + " flagged" : "ready") : "not needed") : "…"]
    ];
    $("pg-pipe").innerHTML = steps.map(function (st, i) {
      var state = i < stage ? (failAt === i ? "fail" : "done") : i === stage ? (failAt === i ? "fail" : "run") : "idle";
      var mark = state === "done" ? icon("check", 12) : state === "fail" ? icon("x", 12) : state === "run" ? '<span class="spin sm"></span>' : '<span class="o"></span>';
      return '<li data-state="' + state + '"><span class="m">' + mark + "</span><b>" + st[0] + "</b><span>" + (i <= stage ? esc(st[1]) : "") + "</span></li>";
    }).join("");
  }

  function clearTimers() { timers.forEach(clearTimeout); timers = []; $("pg-run").disabled = false; }

  function run(animate) {
    if (S.mode === "repo") { if (animate) scanRepo(); return; }
    clearTimers();
    var f = migrate(NAMES[S.mode], src.value);
    S.files = [f]; S.current = 0; S.merged = false;
    var s = summary(S.files);
    S.last = s;
    var fail = s.left || !s.ok ? 3 : undefined;
    if (animate && !U.reduce) {
      $("pg-run").disabled = true;
      pipeline(1, {}); out(true);
      [2, 3, 4, 5].forEach(function (st, i) { timers.push(setTimeout(function () { pipeline(st, s, fail); if (st === 5) { $("pg-run").disabled = false; out(); status(s); } }, 380 * (i + 1))); });
    } else { pipeline(5, s, fail); out(); status(s); }
  }

  function status(s) {
    $("pg-status").innerHTML = '<span>' + icon("terminal", 12) + "Python</span><span>UTF-8</span><span>" + (s.note ? esc(s.note) : plural(S.files[0] ? S.files[0].before.split("\n").length : 0, "line")) + '</span><span class="sp"></span><span>engine ' + Math.max(1, Math.round(s.ms)) + " ms · in your browser</span><span class=\"" + (s.left ? "bad" : "good") + '">' + icon(s.left ? "x" : "check", 12) + s.left + " removed calls left</span>";
  }

  function out(pending) {
    var f = S.files[S.current];
    var edits = S.files.reduce(function (a, x) { return a + x.result.edits.length; }, 0);
    var notes = S.files.reduce(function (a, x) { return a + x.result.notes.length; }, 0);
    $("pg-c-edits").textContent = edits;
    $("pg-c-review").textContent = notes;
    $("pg-c-review").classList.toggle("warn", notes > 0);
    document.querySelectorAll("[data-pgtab]").forEach(function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-pgtab") === S.tab)); });
    $("pg-copy").hidden = !f || f.after === f.before;
    var o = $("pg-out");
    if (pending) { o.innerHTML = '<div class="empty"><span class="spin"></span><b>Running</b><span>Reading the change map and scanning the code.</span></div>'; return; }
    if (!f) { o.innerHTML = '<div class="empty">' + icon("folder", 20) + "<b>Nothing scanned yet</b><span>Enter a public repository, or pick an example above.</span></div>"; return; }
    o.innerHTML = S.tab === "diff" ? viewDiff(f) : S.tab === "edits" ? viewEdits() : S.tab === "pr" ? viewPR() : viewReview();
  }
  function where(f, line) { return (S.files.length > 1 ? f.path + ":" : "L") + line; }
  function viewDiff(f) {
    if (!f.result.aliases.length) return '<div class="empty">' + icon("file", 20) + "<b>No <code>import openai</code> here</b><span>Driftfix looks for code written against the openai 0.x Python SDK.</span></div>";
    if (f.after === f.before) return '<div class="empty">' + icon("check", 20) + "<b>Nothing to migrate</b><span>No calls to the removed API in this file." + (f.result.notes.length ? " Check the Review tab." : "") + "</span></div>";
    return U.diffHTML(f.diff, { label: f.path });
  }
  function viewEdits() {
    var rows = [];
    S.files.forEach(function (f) { f.result.edits.forEach(function (e) { rows.push('<tr><td class="mono dim">' + esc(where(f, e.line)) + "</td><td>" + esc(e.rule) + '</td><td><code class="b">' + esc(e.before) + '</code></td><td><code class="a">' + esc(e.after) + "</code></td></tr>"); }); });
    if (!rows.length) return '<div class="empty">' + icon("check", 20) + "<b>No edits</b><span>Nothing here uses the removed API.</span></div>";
    return '<table class="grid"><thead><tr><th>Where</th><th>Rule</th><th>Before</th><th>After</th></tr></thead><tbody>' + rows.join("") + "</tbody></table>";
  }
  function viewReview() {
    var items = [];
    S.files.forEach(function (f) { f.result.notes.forEach(function (n) { items.push('<li><code>' + esc(where(f, n.line)) + "</code><span>" + U.ticks(n.msg) + "</span></li>"); }); });
    if (!items.length) return '<div class="empty">' + icon("shield", 20) + "<b>Nothing needs a human</b><span>Patterns Driftfix won't guess at, like <code>.get()</code> on a response, are listed here instead of rewritten. Try the Async worker sample.</span></div>";
    return '<ul class="review">' + items.join("") + "</ul>";
  }
  function viewPR() {
    var C = E.CHANGE, edits = 0, rows = [], notes = [], left = 0, ok = true;
    S.files.forEach(function (f) {
      edits += f.result.edits.length; left += f.remaining.length; ok = ok && f.balanced;
      f.result.edits.forEach(function (e) { rows.push("<tr><td><code>" + esc(f.path) + ":" + e.line + "</code></td><td>" + esc(e.rule) + '</td><td><code class="b">' + esc(e.before) + '</code></td><td><code class="a">' + esc(e.after) + "</code></td></tr>"); });
      f.result.notes.forEach(function (n) { notes.push("<li><code>" + esc(f.path) + ":" + n.line + "</code> " + U.ticks(n.msg) + "</li>"); });
    });
    if (!edits) return '<div class="empty">' + icon("pr", 20) + "<b>No pull request needed</b><span>Driftfix only opens one when it has something to fix.</span></div>";
    var changed = S.files.filter(function (f) { return f.after !== f.before; }).length;
    var recorded = S.mode === "support" && S.files[0].before === SUPPORT;
    var failed = left || !ok;
    var ck = [
      [left ? "fail" : "pass", "driftfix/removed-calls", left ? plural(left, "call") + " left" : "No calls to the removed API remain"],
      [ok ? "pass" : "fail", "driftfix/structure", ok ? "Brackets, strings and comments balance" : "Structure check failed"],
      recorded ? ["pass", "tests/pytest", "3 failed before, 3 passed after (recorded CLI run)"] : ["skip", "tests", "Your suite runs before and after with driftfix run"]
    ];
    var repoName = S.mode === "repo" && S.repo ? S.repo.label : "your-repo";
    return '<div class="prv"><h3>' + esc(C.title) + ' <span class="dim">#1</span></h3>' +
      '<div class="pr-meta">' + (S.merged ? '<span class="badge merged">' + icon("merge", 14) + "Merged</span>" : '<span class="badge open">' + icon("pr", 14) + "Open</span>") + "<span><b>driftfix</b> wants to merge 1 commit into <code class=\"ref\">main</code> from <code class=\"ref\">" + esc(C.branch) + "</code> in " + esc(repoName) + "</span></div>" +
      '<div class="md"><p>' + esc(C.summary) + '</p><p>Changelog: <a href="' + C.changelog + '" target="_blank" rel="noopener">' + esc(C.changelog) + "</a></p><h4>What changed: " + plural(edits, "edit") + " in " + plural(changed, "file") + '</h4><div class="tscroll"><table class="md-t"><thead><tr><th>Where</th><th>Rule</th><th>Before</th><th>After</th></tr></thead><tbody>' + rows.join("") + "</tbody></table></div>" + (notes.length ? '<h4>Needs a human look</h4><ul class="md-notes">' + notes.join("") + "</ul>" : "") + "</div>" +
      '<div class="checklist">' + ck.map(function (c) { return '<div><span class="ck ' + (c[0] === "pass" ? "pass" : c[0] === "fail" ? "fail" : "pend") + '">' + icon(c[0] === "pass" ? "check" : c[0] === "fail" ? "x" : "dot", 13) + "</span><code>" + c[1] + "</code><span class=\"dim\">" + esc(c[2]) + "</span></div>"; }).join("") + "</div>" +
      (S.merged ? '<div class="mergebar done"><span class="badge merged">' + icon("merge", 14) + "Merged</span><span>Preview only: nothing was pushed. In your repository, merging is always your call.</span></div>"
        : '<div class="mergebar"><span>' + (failed ? "A check failed. Driftfix would roll this back and open nothing." : "All checks passed. No conflicts with main.") + '</span><button type="button" class="btn sm merge" data-pg="merge"' + (failed ? " disabled" : "") + ">" + icon("merge", 13) + "Squash and merge</button></div>") + "</div>";
  }

  function setMode(mode) {
    clearTimers();
    S.mode = mode;
    document.querySelectorAll("[data-pgmode]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-pgmode") === mode)); });
    $("pg-repo").hidden = mode !== "repo";
    $("pg-live").hidden = mode === "repo";
    $("pg-run").hidden = mode === "repo";
    $("pg-msg").hidden = true;
    if (mode === "repo") {
      src.readOnly = true;
      if (S.repo && S.repo.files.length) { S.files = S.repo.files; S.last = S.repo.sum; files(); show(0); pipeline(5, S.repo.sum); status(S.repo.sum); }
      else { S.files = []; $("pg-files").hidden = true; $("pg-name").textContent = "github"; src.value = "# Scan a public GitHub repository.\n# Its Python files that import openai appear here."; paintEditor(); pipeline(-1); $("pg-status").innerHTML = "<span>Waiting for a repository</span>"; out(); }
      return;
    }
    $("pg-files").hidden = true; src.readOnly = false;
    src.value = S.source[mode]; $("pg-name").textContent = NAMES[mode]; src.scrollTop = 0;
    paintEditor(); run(false);
  }

  function files() {
    var el = $("pg-files"); el.hidden = false;
    el.innerHTML = S.files.map(function (f, i) {
      return '<button type="button" data-pgfile="' + i + '" aria-current="' + (i === S.current) + '">' + icon("file", 13) + "<span>" + esc(f.path) + "</span>" + (f.result.edits.length ? "<em>" + f.result.edits.length + "</em>" : "") + (f.result.notes.length ? '<em class="warn">' + f.result.notes.length + "</em>" : "") + "</button>";
    }).join("");
  }
  function show(i) {
    S.current = i; var f = S.files[i]; if (!f) return;
    $("pg-files").querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-current", String(+b.getAttribute("data-pgfile") === i)); });
    $("pg-name").textContent = f.path; src.value = f.before; src.scrollTop = 0; paintEditor(); out();
  }

  function msg(kind, html) { var m = $("pg-msg"); m.className = "notice " + kind; m.innerHTML = html; m.hidden = false; }
  function parseRepo(t) {
    t = t.trim().replace(/\.git$/, "").replace(/^https?:\/\//, "").replace(/^(www\.)?github\.com\//, "");
    var m = t.match(/^([\w.-]+)\/([\w.-]+)(?:\/tree\/(\S+))?/);
    return m ? { owner: m[1], repo: m[2], branch: m[3] || null } : null;
  }
  async function getJSON(url) {
    var res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
    if (res.status === 403 || res.status === 429) throw { kind: "rate" };
    if (res.status === 404) throw { kind: "missing" };
    if (!res.ok) throw { kind: "http" };
    return res.json();
  }
  function finishRepo(label, results, note, t0) {
    results.sort(function (a, b) { return b.result.edits.length - a.result.edits.length || a.path.localeCompare(b.path); });
    var s = summary(results, note); s.ms = performance.now() - t0;
    S.repo = { label: label, files: results, sum: s }; S.files = results; S.current = 0; S.last = s; S.tab = "diff"; S.merged = false;
    if (!results.length) {
      pipeline(5, { calls: 0, edits: 0, left: 0, ok: true, notes: 0, added: 0, removed: 0 });
      msg("info", "No Python file in <code>" + esc(label) + "</code> imports <code>openai</code>. Try one of the examples.");
      src.value = "# No Python files in " + label + " import openai."; paintEditor(); out(); status(s);
      return;
    }
    files(); show(0);
    if (U.reduce) { pipeline(5, s); status(s); }
    else [2, 3, 4, 5].forEach(function (st, i) { timers.push(setTimeout(function () { pipeline(st, s); if (st === 5) status(s); }, 300 * (i + 1))); });
  }
  var scanning = false;
  async function scanRepo() {
    if (scanning) return;
    var spec = parseRepo($("pg-repo-in").value);
    if (!spec) { msg("error", "Enter a repository like <code>owner/repo</code> or <code>github.com/owner/repo</code>."); return; }
    scanning = true; clearTimers(); $("pg-msg").hidden = true; $("pg-scan").disabled = true;
    var label = spec.owner + "/" + spec.repo;
    pipeline(1, {}); S.files = []; out(true); $("pg-files").hidden = true; src.value = "# Fetching " + label + " from GitHub…"; paintEditor();
    try {
      var t0 = performance.now();
      var branch = spec.branch || (await getJSON("https://api.github.com/repos/" + spec.owner + "/" + spec.repo)).default_branch;
      var tree = await getJSON("https://api.github.com/repos/" + spec.owner + "/" + spec.repo + "/git/trees/" + encodeURIComponent(branch) + "?recursive=1");
      var skip = /(^|\/)(\.venv|venv|env|node_modules|site-packages|build|dist|\.git|__pycache__|\.tox)\//;
      var py = (tree.tree || []).filter(function (t) { return t.type === "blob" && /\.py$/.test(t.path) && !skip.test(t.path); });
      var capped = py.slice(0, 150), results = [], next = 0;
      async function worker() {
        while (next < capped.length) {
          var it = capped[next++];
          var res = await fetch("https://raw.githubusercontent.com/" + spec.owner + "/" + spec.repo + "/" + encodeURIComponent(branch) + "/" + it.path.split("/").map(encodeURIComponent).join("/"));
          if (!res.ok) continue;
          var text = await res.text();
          if (text.indexOf("openai") < 0) continue;
          var f = migrate(it.path, text);
          if (f.result.aliases.length) results.push(f);
        }
      }
      await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
      finishRepo(label, results, plural(py.length, "Python file") + " @ " + branch, t0);
    } catch (err) {
      msg("error", err && err.kind === "rate" ? "GitHub's limit for anonymous requests (60 an hour) was reached. Try again later, or use the bundled sample."
        : err && err.kind === "missing" ? "That repository wasn't found, or it's private. From the browser, Driftfix can only read public repositories."
        : "This page couldn't reach GitHub. Some previews block outside requests; on the live site this reads the repository directly. The bundled sample below works everywhere.");
      pipeline(1, {}, 1); src.value = "# Couldn't fetch " + label + "."; paintEditor(); S.files = []; out();
    } finally { scanning = false; $("pg-scan").disabled = false; }
  }
  function sampleRepo(name) {
    var repo = D && D.repos.filter(function (r) { return r.name === name; })[0];
    if (!repo) return;
    clearTimers(); $("pg-msg").hidden = true;
    var label = D.org + "/" + repo.name; $("pg-repo-in").value = label;
    var t0 = performance.now();
    var py = repo.files.filter(function (f) { return /\.py$/.test(f.path); });
    pipeline(1, {});
    finishRepo(label, py.map(function (f) { return migrate(f.path, f.code); }).filter(function (f) { return f.result.aliases.length; }), plural(py.length, "Python file") + " · bundled sample", t0);
  }

  // ---------- recorded CLI run ----------
  var replayTimers = [];
  function replay() {
    var term = $("rec"), lines = term.querySelectorAll(".l");
    replayTimers.forEach(clearTimeout); replayTimers = [];
    if (U.reduce) return;
    term.classList.add("playing"); lines.forEach(function (l) { l.classList.remove("on"); });
    var t = 0;
    lines.forEach(function (l, i) {
      t += i === 0 ? 120 : (l.textContent.trim() ? 240 : 80);
      if (/Tests before|Verify/.test(l.textContent)) t += 380;
      replayTimers.push(setTimeout(function () { l.classList.add("on"); }, t));
    });
    replayTimers.push(setTimeout(function () { term.classList.remove("playing"); lines.forEach(function (l) { l.classList.remove("on"); }); }, t + 500));
  }

  // ---------- contact ----------
  function submitLead() {
    var email = $("f-email"), repo = $("f-repo"), api = $("f-api").value, sent = $("sent");
    sent.hidden = false;
    if (!email.value || email.value.indexOf("@") < 1) { sent.className = "notice error"; sent.textContent = "Add your work email so we can send the pull request."; email.focus(); return; }
    if (!repo.value.trim()) { sent.className = "notice error"; sent.textContent = "Add the repository you want migrated."; repo.focus(); return; }
    var subject = "Migration request: " + api, body = "Repo: " + repo.value.trim() + "\nAPI: " + api + "\nReply to: " + email.value.trim();
    sent.className = "notice ok";
    sent.innerHTML = "<b>Request ready.</b> Send it to <code>" + esc(CONTACT) + "</code> and we'll reply within a day with the pull request.<pre>Subject: " + esc(subject) + "\n\n" + esc(body) + '</pre><div class="row"><button type="button" class="btn sm" data-copy-req><span class="lbl">Copy request</span></button><a class="btn sm primary" href="mailto:' + encodeURIComponent(CONTACT) + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body) + '">Open email app</a></div>';
    sent.setAttribute("data-req", "To: " + CONTACT + "\nSubject: " + subject + "\n\n" + body);
  }

  // ---------- one delegated handler ----------
  function scrollToId(id) { var el = $(id); if (el) el.scrollIntoView({ behavior: U.reduce ? "auto" : "smooth", block: "start" }); }
  document.addEventListener("click", function (e) {
    var t = e.target.closest("button, a");
    if (!t || t.disabled) return;
    if (t.closest("#app")) return; // the workspace handles its own clicks
    var d = t.dataset;
    if (t.tagName === "A") {
      var href = t.getAttribute("href") || "";
      if (href.charAt(0) === "#" && href.length > 1) { e.preventDefault(); scrollToId(href.slice(1)); }
    }
    if (d.demo !== undefined) { e.preventDefault(); if (window.DriftfixWorkspace) window.DriftfixWorkspace.open(d.demo || null, d.full === "1"); return; }
    if (d.pgmode) { setMode(d.pgmode); return; }
    if (d.pgtab) { S.tab = d.pgtab; out(); return; }
    if (d.pgfile !== undefined) { show(+d.pgfile); return; }
    if (d.pg === "merge") { S.merged = true; out(); return; }
    if (t.id === "pg-run") { run(true); return; }
    if (t.id === "pg-scan") { scanRepo(); return; }
    if (d.repo) { $("pg-repo-in").value = d.repo; scanRepo(); return; }
    if (d.sample) { sampleRepo(d.sample); return; }
    if (t.id === "pg-copy") { var f = S.files[S.current]; if (f) U.copy(f.after, t); return; }
    if (t.id === "rec-replay") { replay(); return; }
    if (t.id === "copy-mail") { U.copy(CONTACT, t); return; }
    if (d.copyReq !== undefined) { U.copy($("sent").getAttribute("data-req"), t); return; }
  });
  $("pg-repo-in").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); scanRepo(); } });
  $("lead").addEventListener("submit", function (e) { e.preventDefault(); submitLead(); });

  // header shadow once scrolled
  var top = $("top");
  window.addEventListener("scroll", function () { top.classList.toggle("scrolled", window.scrollY > 8); }, { passive: true });

  setMode("support");
})();
