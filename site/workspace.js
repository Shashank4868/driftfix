/*
 * Driftfix demo workspace. Runs on bundled sample repositories; every scan,
 * patch, diff, check and PR body is produced by engine.js at runtime.
 * All interaction goes through one delegated click handler on the app root.
 */
(function () {
  "use strict";
  var E = window.Driftfix, D = window.DriftfixWorkspaceData, U = window.DriftfixUI;
  if (!E || !D || !U) return;
  var icon = U.icon, esc = U.esc, ticks = U.ticks, plural = U.plural;

  var CHANGES = [
    { id: "openai-python-v1", provider: "OpenAI", mark: "OA", title: "Python SDK 1.0 removes the module-level API", status: "live", when: "Removed Nov 6, 2023",
      detail: "openai.ChatCompletion.create and the other module-level calls raise APIRemovedInV1 on openai>=1.0. Calls move to a client object, responses become typed objects, and error classes move out of openai.error.",
      link: E.CHANGE.changelog, detect: "openai" },
    { id: "stripe-api-versions", provider: "Stripe", mark: "ST", title: "Major API versions twice a year", status: "watching", when: "Pinned versions keep working until you upgrade",
      detail: "Each major release can rename fields and change defaults. Accounts pinned to an old version keep it, which makes the upgrade easy to postpone and hard to do all at once.",
      link: "https://docs.stripe.com/api/versioning", detect: "stripe" },
    { id: "google-ads-api", provider: "Google Ads", mark: "GA", title: "Four major API versions a year", status: "watching", when: "Each version sunset about a year after release",
      detail: "Since January 2026 Google Ads ships quarterly major versions. Calls to a sunset version fail, so every integration needs an upgrade roughly once a year.",
      link: "https://ppc.land/google-ads-api-shifts-to-monthly-releases-starting-january-2026/", detect: "google.ads" },
    { id: "shopify-admin-api", provider: "Shopify", mark: "SH", title: "Quarterly Admin API versions", status: "planned", when: "Each version supported about 12 months",
      detail: "A new Admin API version ships every quarter. Apps on an unsupported version are moved forward automatically, which can change behaviour without a code change.",
      link: "https://shopify.dev/docs/api/usage/versioning", detect: "shopify" }
  ];
  var STATUS = { live: "Rules live", watching: "Watching", planned: "Planned" };
  var DEFAULTS = { runTests: true, autoOpen: true, requireReview: true, draftFlagged: false, branchPrefix: "driftfix/", digest: true, slack: false };
  var RULE_COUNT = Object.keys(E.RULES.calls).length + Object.keys(E.RULES.errors).length + Object.keys(E.RULES.settings).length + 1 + E.RULES.keys.length;

  var W, app, body, bar;

  // ---------- state ----------
  function loadSettings() {
    var s = Object.assign({}, DEFAULTS);
    try { Object.assign(s, JSON.parse(localStorage.getItem("driftfix-demo-settings") || "{}")); } catch (e) { /* storage unavailable */ }
    return s;
  }
  function saveSettings() { try { localStorage.setItem("driftfix-demo-settings", JSON.stringify(W.settings)); } catch (e) { /* ignore */ } }

  function providersOf(files) {
    var found = [];
    files.forEach(function (f) {
      var c = f.code;
      if (/^\s*(import openai|from openai )/m.test(c) && found.indexOf("openai") < 0) found.push("openai");
      if (/^\s*import stripe/m.test(c) && found.indexOf("stripe") < 0) found.push("stripe");
      if (/google\.ads/.test(c) && found.indexOf("google.ads") < 0) found.push("google.ads");
    });
    return found;
  }

  function analyze(path, code) {
    var before = code.replace(/\r\n/g, "\n");
    if (!/\.py$/.test(path)) return { path: path, before: before, after: before, python: false, result: { edits: [], notes: [], aliases: [], calls: 0 }, diff: { hunks: [], added: 0, removed: 0 }, remaining: [], balanced: true, ms: 0 };
    var t0 = performance.now(), r = E.migrate(before);
    return { path: path, before: before, after: r.code, python: true, result: r, diff: E.diff(before, r.code), remaining: E.remaining(r.code), balanced: E.balanced(r.code), ms: performance.now() - t0 };
  }

  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return ("0000000" + h.toString(16)).slice(-7); }
  function sum(list, f) { return list.reduce(function (a, x) { return a + f(x); }, 0); }

  function init() {
    var t0 = performance.now();
    W = { view: "inbox", repo: null, repoTab: "code", file: 0, pr: null, prTab: "conversation", prFilter: "open", change: "openai-python-v1",
      settings: loadSettings(), repos: [], prs: [], activity: [], nextPR: 41, provider: { ran: false, running: false, rows: [], log: [] }, ruleQuery: "", run: null, prefixDraft: null };
    D.repos.forEach(function (r) {
      var files = r.files.map(function (f) { return analyze(f.path, f.code); });
      var repo = { name: r.name, full: D.org + "/" + r.name, description: r.description, lang: r.lang, tests: r.tests, branch: r.branch,
        files: files, providers: providersOf(r.files), recorded: r.recorded || null, pr: null, history: [], scanned: new Date() };
      repo.affected = files.filter(function (f) { return f.after !== f.before; });
      repo.status = repo.affected.length ? "ready" : "current";
      W.repos.push(repo);
    });
    log("scan", "Scanned " + W.repos.length + " repositories against " + CHANGES.length + " provider changes", Math.max(1, Math.round(performance.now() - t0)) + " ms");
    if (W.settings.autoOpen && W.repos[0].affected.length) openPR(W.repos[0], true);
    W.provider.rows = D.integrators.map(function (i) { var f = analyze(i.path, i.code); return { name: i.name, file: f, onOld: f.after !== f.before, state: "idle" }; });
  }

  function log(kind, text, meta) { W.activity.unshift({ at: new Date(), kind: kind, text: text, meta: meta || "" }); }

  function openPR(repo, quiet) {
    var files = repo.affected;
    var notes = sum(files, function (f) { return f.result.notes.length; });
    var pr = {
      id: W.nextPR++, repo: repo, title: E.CHANGE.title, branch: W.settings.branchPrefix + "openai-python-v1",
      state: "open", draft: W.settings.draftFlagged && notes > 0, files: files,
      edits: sum(files, function (f) { return f.result.edits.length; }), notes: notes,
      added: sum(files, function (f) { return f.diff.added; }), removed: sum(files, function (f) { return f.diff.removed; }),
      opened: new Date(), events: [], comments: [], viewed: {}, approved: false, ack: false, testsRan: W.settings.runTests,
      sha: hash(files.map(function (f) { return f.after; }).join(""))
    };
    pr.events.push({ at: pr.opened, icon: "pr", text: "<b>driftfix</b> opened this pull request" + (pr.draft ? " as a draft" : "") });
    pr.events.push({ at: pr.opened, icon: "branch", text: "<b>driftfix</b> pushed 1 commit <code>" + pr.sha + "</code>" });
    pr.events.push({ at: pr.opened, icon: "check", text: "Checks finished: " + checkLine(pr) });
    W.prs.unshift(pr);
    repo.pr = pr; repo.status = "pr"; repo.history.unshift(pr);
    log("pr", "Opened #" + pr.id + " in " + repo.full, plural(pr.edits, "edit"));
    if (!quiet) toast("Opened pull request #" + pr.id, repo.full);
    return pr;
  }

  function checks(pr) {
    var left = sum(pr.files, function (f) { return f.remaining.length; });
    var ok = pr.files.every(function (f) { return f.balanced; });
    var ms = Math.max(1, Math.round(sum(pr.files, function (f) { return f.ms; })));
    var list = [
      { state: left ? "fail" : "pass", name: "driftfix/removed-calls", detail: left ? plural(left, "removed call") + " left" : "No calls to the removed API remain", time: ms + " ms", required: true },
      { state: ok ? "pass" : "fail", name: "driftfix/structure", detail: ok ? "Brackets, strings and comments balance" : "Structure check failed", time: ms + " ms", required: true }
    ];
    if (!pr.testsRan) list.push({ state: "skip", name: "tests", detail: "Skipped: test runs are off in policy settings", time: "", required: false });
    else if (pr.repo.recorded) list.push({ state: "pass", name: "tests/pytest", detail: pr.repo.recorded.before + " before, " + pr.repo.recorded.after + " after the patch (recorded CLI run)", time: pr.repo.recorded.seconds + " s", required: true });
    else if (pr.repo.tests === "none") list.push({ state: "skip", name: "tests", detail: "No test suite in this repository; changed files were compiled instead", time: "", required: false });
    else list.push({ state: "skip", name: "tests/" + pr.repo.tests, detail: "Runs in your CI once the repository is connected; not run in the demo", time: "", required: false });
    if (pr.notes) list.push({ state: pr.ack ? "pass" : "pending", name: "driftfix/review", detail: pr.ack ? "Flagged items signed off" : plural(pr.notes, "item") + " need a human sign-off", time: "", required: W.settings.requireReview });
    return list;
  }
  function checkLine(pr) {
    var c = checks(pr), pass = c.filter(function (x) { return x.state === "pass"; }).length, fail = c.filter(function (x) { return x.state === "fail"; }).length;
    return pass + " passed" + (fail ? ", " + fail + " failed" : "") + ", " + (c.length - pass - fail) + " skipped or pending";
  }
  function mergeBlockers(pr) {
    var b = [];
    if (checks(pr).some(function (c) { return c.state === "fail"; })) b.push("A required check failed");
    if (pr.draft) b.push("This pull request is still a draft");
    if (W.settings.requireReview && pr.notes && !pr.ack) b.push("Flagged items need sign-off");
    return b;
  }

  // ---------- formatting ----------
  function ago(d) {
    var s = Math.round((Date.now() - d.getTime()) / 1000);
    if (s < 45) return "just now";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    return Math.round(s / 3600) + "h ago";
  }
  function clock(d) { return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  function prIcon(p) {
    if (p.state === "merged") return '<span class="st merged">' + icon("merge", 16) + "</span>";
    if (p.state === "closed") return '<span class="st closed">' + icon("prClosed", 16) + "</span>";
    if (p.draft) return '<span class="st draft">' + icon("prDraft", 16) + "</span>";
    return '<span class="st open">' + icon("pr", 16) + "</span>";
  }
  function prBadge(p) {
    var label = p.state === "merged" ? "Merged" : p.state === "closed" ? "Closed" : p.draft ? "Draft" : "Open";
    var ic = p.state === "merged" ? "merge" : p.state === "closed" ? "prClosed" : p.draft ? "prDraft" : "pr";
    return '<span class="badge ' + (p.draft && p.state === "open" ? "draft" : p.state) + '">' + icon(ic, 14) + label + "</span>";
  }
  function diffstat(a, r) {
    var total = a + r || 1, g = Math.round(5 * a / total), boxes = "";
    for (var i = 0; i < 5; i++) boxes += '<i class="' + (i < g ? "a" : "r") + '"></i>';
    return '<span class="dstat"><b class="add">+' + a + '</b> <b class="del">-' + r + '</b><span class="boxes">' + boxes + "</span></span>";
  }
  function repoState(r) {
    if (r.status === "ready") return '<span class="rs warn">' + icon("alert", 14) + "Migration ready</span>";
    if (r.status === "pr") return '<span class="rs open">' + icon("pr", 14) + "In review #" + r.pr.id + "</span>";
    if (r.status === "merged") return '<span class="rs merged">' + icon("merge", 14) + "Migrated</span>";
    if (r.providers.indexOf("stripe") > -1) return '<span class="rs">' + icon("eye", 14) + "Watching Stripe</span>";
    return '<span class="rs ok">' + icon("check", 14) + "Up to date</span>";
  }
  function impact(c) {
    var users = W.repos.filter(function (r) { return r.providers.indexOf(c.detect) > -1; });
    if (c.status !== "live") return users.length ? plural(users.length, "repository", "repositories") + " use it" : "Not used in your repositories";
    var need = users.filter(function (r) { return r.status === "ready" || r.status === "pr"; }).length;
    return need + " of " + users.length + " repositories need changes";
  }

  // ---------- shell ----------
  var NAV = [
    { group: "Workspace" },
    { id: "inbox", label: "Inbox", icon: "inbox" },
    { id: "prs", label: "Pull requests", icon: "pr" },
    { id: "repos", label: "Repositories", icon: "folder" },
    { id: "changes", label: "Provider changes", icon: "activity" },
    { group: "Configure" },
    { id: "rules", label: "Rules", icon: "book" },
    { id: "provider", label: "Provider console", icon: "layers" },
    { id: "settings", label: "Settings", icon: "sliders" }
  ];

  function shell() {
    app.innerHTML =
      '<aside class="app-side">' +
        '<div class="org"><span class="org-av">A</span><span class="org-name">acme</span><span class="org-tag">Demo</span>' + icon("chevD", 14, "dim") + "</div>" +
        '<button type="button" class="side-search" data-act="palette">' + icon("search", 14) + "<span>Search</span><kbd>Ctrl K</kbd></button>" +
        '<nav class="side-nav" id="app-nav" aria-label="Workspace"></nav>' +
        '<div class="side-foot"><span class="pulse"></span><span>Engine running locally<br><code>' + esc(E.CHANGE.id) + "</code> · " + RULE_COUNT + " rules</span></div>" +
      "</aside>" +
      '<section class="app-main">' +
        '<header class="app-bar"><div class="crumbs" id="app-crumbs"></div><div class="bar-actions" id="app-actions"></div>' +
        '<button type="button" class="icon-btn" data-act="fullscreen" title="Full screen" aria-label="Toggle full screen">' + icon("max", 15) + "</button></header>" +
        '<div class="app-body" id="app-body" tabindex="-1"></div>' +
      "</section>" +
      '<div class="toasts" id="app-toasts" aria-live="polite"></div>' +
      '<div class="overlay" id="app-pal" hidden><div class="pal" role="dialog" aria-label="Command menu"><div class="pal-in">' + icon("search", 16) + '<input id="app-pal-in" placeholder="Type a command or search…" autocomplete="off" spellcheck="false"></div><div class="pal-list" id="app-pal-list" role="listbox"></div><div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span><span><kbd>↵</kbd> to open</span><span><kbd>Esc</kbd> to close</span></div></div></div>' +
      '<div class="overlay center" id="app-modal" hidden></div>';
    body = app.querySelector("#app-body");
    bar = app.querySelector("#app-actions");
    app.addEventListener("click", onClick);
    app.addEventListener("change", onChange);
    app.addEventListener("input", onInput);
    app.addEventListener("keydown", onKey);
    app.querySelector("#app-pal-in").addEventListener("input", paintPalette);
  }

  function paintNav() {
    var counts = { inbox: W.prs.filter(function (p) { return p.state === "open"; }).length + W.repos.filter(function (r) { return r.status === "ready"; }).length,
      prs: W.prs.filter(function (p) { return p.state === "open"; }).length };
    app.querySelector("#app-nav").innerHTML = NAV.map(function (n) {
      if (n.group) return '<div class="side-group">' + n.group + "</div>";
      var on = W.view === n.id || (W.view === "repo" && n.id === "repos") || (W.view === "pr" && n.id === "prs");
      return '<button type="button" data-act="go" data-arg="' + n.id + '" aria-current="' + (on ? "page" : "false") + '">' + icon(n.icon, 15) + "<span>" + n.label + "</span>" + (counts[n.id] ? "<em>" + counts[n.id] + "</em>" : "") + "</button>";
    }).join("");
  }

  function crumbs(parts) {
    app.querySelector("#app-crumbs").innerHTML = parts.map(function (p, i) {
      var last = i === parts.length - 1;
      return (i ? '<span class="sep">/</span>' : "") + (p.go && !last ? '<button type="button" data-act="go" data-arg="' + p.go + '">' + esc(p.label) + "</button>" : '<span class="' + (last ? "cur" : "") + '">' + esc(p.label) + "</span>");
    }).join("");
  }

  function go(view, arg) {
    W.view = view;
    if (view === "repo") { W.repo = arg; W.repoTab = "code"; W.file = firstAffected(arg); }
    if (view === "pr") { W.pr = arg; W.prTab = "conversation"; }
    render();
    body.scrollTop = 0;
  }
  function firstAffected(r) { var i = r.files.findIndex(function (f) { return f.after !== f.before; }); return i < 0 ? 0 : i; }

  function render() {
    paintNav();
    bar.innerHTML = "";
    var v = { inbox: vInbox, prs: vPRs, pr: vPR, repos: vRepos, repo: vRepo, changes: vChanges, rules: vRules, provider: vProvider, settings: vSettings }[W.view] || vInbox;
    body.innerHTML = v();
  }
  function actions(html) { bar.innerHTML = html; }

  // ---------- views ----------
  function vInbox() {
    crumbs([{ label: "acme" }, { label: "Inbox" }]);
    actions('<button type="button" class="btn sm" data-act="rescan">' + icon("refresh", 14) + "Rescan</button>");
    var ready = W.repos.filter(function (r) { return r.status === "ready"; });
    var open = W.prs.filter(function (p) { return p.state === "open"; });
    var merged = W.prs.filter(function (p) { return p.state === "merged"; }).length;
    var proposed = sum(W.repos, function (r) { return sum(r.affected, function (f) { return f.result.edits.length; }); });
    var flagged = sum(W.repos, function (r) { return sum(r.affected, function (f) { return f.result.notes.length; }); });
    var stats = [["Repositories", W.repos.length], ["Need migration", ready.length + open.length], ["Edits proposed", proposed], ["Flagged for review", flagged], ["Merged", merged]];

    var items = open.map(function (p) {
      return '<button type="button" class="item" data-act="pr" data-arg="' + p.id + '">' + prIcon(p) + '<span class="item-t"><b>' + esc(p.title) + '</b><small>' + esc(p.repo.full) + " #" + p.id + " · " + ago(p.opened) + " · " + checkLine(p) + "</small></span>" + diffstat(p.added, p.removed) + '<span class="kbd-hint">Review</span></button>';
    }).concat(ready.map(function (r) {
      var e = sum(r.affected, function (f) { return f.result.edits.length; });
      return '<div class="item">' + '<span class="st warn">' + icon("alert", 16) + '</span><span class="item-t"><b>' + esc(r.full) + " calls the removed OpenAI API</b><small>" + plural(r.affected.length, "file") + " · " + plural(e, "edit") + " ready · scanned " + ago(r.scanned) + '</small></span><button type="button" class="btn sm primary" data-act="run" data-arg="' + r.name + '">' + icon("play", 12) + "Run migration</button></div>";
    }));
    if (!items.length) items.push('<div class="empty-row">' + icon("check", 16) + "Inbox zero. Driftfix opens a pull request when a provider change touches your code.</div>");

    return '<div class="page"><div class="page-h"><h1>Inbox</h1><p>' + (ready.length || open.length ? plural(ready.length, "repository", "repositories") + " ready to migrate · " + plural(open.length, "pull request") + " waiting for review" : "Everything is up to date") + "</p></div>" +
      '<div class="stats">' + stats.map(function (s) { return '<div><span>' + s[0] + "</span><b>" + s[1] + "</b></div>"; }).join("") + "</div>" +
      '<div class="cols"><section class="panel"><div class="panel-h"><h2>Needs attention</h2><span class="count">' + (ready.length + open.length) + "</span></div><div class=\"list\">" + items.join("") + "</div></section>" +
      '<div class="stack"><section class="panel"><div class="panel-h"><h2>Provider changes</h2><button type="button" class="link" data-act="go" data-arg="changes">View all</button></div><div class="list">' +
      CHANGES.map(function (c) {
        return '<button type="button" class="item compact" data-act="change" data-arg="' + c.id + '"><span class="mark">' + c.mark + '</span><span class="item-t"><b>' + esc(c.provider) + "</b> <span>" + esc(c.title) + "</span><small>" + esc(impact(c)) + '</small></span><span class="pill ' + c.status + '">' + STATUS[c.status] + "</span></button>";
      }).join("") + "</div></section>" +
      '<section class="panel"><div class="panel-h"><h2>Activity</h2></div><ol class="feed">' + W.activity.slice(0, 8).map(function (a) {
        var ic = a.kind === "pr" ? "pr" : a.kind === "merge" ? "merge" : a.kind === "close" ? "prClosed" : a.kind === "provider" ? "layers" : "refresh";
        return '<li><span class="feed-ic ' + a.kind + '">' + icon(ic, 13) + "</span><span>" + esc(a.text) + (a.meta ? ' <em>' + esc(a.meta) + "</em>" : "") + "</span><time>" + ago(a.at) + "</time></li>";
      }).join("") + "</ol></section></div></div></div>";
  }

  function vPRs() {
    crumbs([{ label: "acme" }, { label: "Pull requests" }]);
    var c = { open: 0, merged: 0, closed: 0 };
    W.prs.forEach(function (p) { c[p.state]++; });
    var list = W.prs.filter(function (p) { return W.prFilter === "all" || p.state === W.prFilter; });
    var tabs = [["open", "pr", "Open"], ["merged", "merge", "Merged"], ["closed", "prClosed", "Closed"], ["all", "filter", "All"]].map(function (t) {
      return '<button type="button" data-act="prfilter" data-arg="' + t[0] + '" aria-pressed="' + (W.prFilter === t[0]) + '">' + icon(t[1], 14) + t[2] + " <span>" + (t[0] === "all" ? W.prs.length : c[t[0]]) + "</span></button>";
    }).join("");
    return '<div class="page"><div class="page-h"><h1>Pull requests</h1><p>Each one carries the edit table, the provider changelog and the check results.</p></div>' +
      '<section class="panel flush"><div class="table-h"><div class="filters">' + tabs + "</div></div>" +
      (list.length ? list.map(function (p) {
        var ck = checks(p), fail = ck.some(function (x) { return x.state === "fail"; }), pend = ck.some(function (x) { return x.state === "pending"; });
        return '<button type="button" class="prrow" data-act="pr" data-arg="' + p.id + '">' + prIcon(p) + '<span class="prrow-t"><b>' + esc(p.title) + '</b>' + (p.notes ? '<span class="label warn">needs review</span>' : "") + '<span class="label">api-migration</span><small>#' + p.id + " · " + esc(p.repo.full) + " · opened " + ago(p.opened) + " by driftfix</small></span>" +
          '<span class="prrow-m">' + '<span class="ck ' + (fail ? "fail" : pend ? "pend" : "pass") + '" title="' + esc(checkLine(p)) + '">' + icon(fail ? "x" : pend ? "dot" : "check", 14) + "</span>" + (p.comments.length ? '<span class="cm">' + icon("msg", 14) + p.comments.length + "</span>" : "") + diffstat(p.added, p.removed) + "</span></button>";
      }).join("") : '<div class="empty-row">' + icon("pr", 16) + "No " + (W.prFilter === "all" ? "" : W.prFilter + " ") + "pull requests yet. Run a migration from a repository to open one.</div>") + "</section></div>";
  }

  function vPR() {
    var p = W.pr, ck = checks(p), blockers = mergeBlockers(p);
    crumbs([{ label: "acme" }, { label: "Pull requests", go: "prs" }, { label: "#" + p.id }]);
    actions('<button type="button" class="btn sm" data-act="copy-branch" data-arg="' + esc(p.branch) + '">' + icon("copy", 13) + '<span class="lbl">Copy branch</span></button>');
    var tabs = [["conversation", "msg", "Conversation", p.comments.length], ["commits", "branch", "Commits", 1], ["checks", "check", "Checks", ck.length], ["files", "file", "Files changed", p.files.length]].map(function (t) {
      return '<button type="button" data-act="prtab" data-arg="' + t[0] + '" aria-selected="' + (W.prTab === t[0]) + '">' + icon(t[1], 14) + t[2] + " <span>" + t[3] + "</span></button>";
    }).join("");

    var main = W.prTab === "conversation" ? prConversation(p, ck, blockers) : W.prTab === "commits" ? prCommits(p) : W.prTab === "checks" ? prChecks(ck) : prFiles(p);
    var side = '<aside class="pr-side">' +
      sideBlock("Reviewers", '<div class="who">' + '<span class="av">Y</span>you' + (p.approved ? '<span class="ok-ic" title="Approved">' + icon("check", 14) + "</span>" : '<span class="dim">pending</span>') + "</div>") +
      sideBlock("Author", '<div class="who"><span class="av bot">D</span>driftfix<span class="tag-bot">bot</span></div>') +
      sideBlock("Labels", '<div class="labels"><span class="label">api-migration</span><span class="label">openai</span>' + (p.notes ? '<span class="label warn">needs review</span>' : "") + "</div>") +
      sideBlock("Provider change", '<button type="button" class="link" data-act="change" data-arg="openai-python-v1">' + icon("activity", 13) + esc(E.CHANGE.id) + "</button>") +
      sideBlock("Policy", '<ul class="policy"><li>' + (W.settings.requireReview ? icon("lock", 13) + "Sign-off required on flagged items" : icon("check", 13) + "No sign-off required") + "</li><li>" + (p.testsRan ? icon("check", 13) + "Tests run before and after" : icon("x", 13) + "Test runs off") + "</li></ul>") +
      "</aside>";

    return '<div class="page wide"><div class="pr-h"><h1>' + esc(p.title) + ' <span class="num">#' + p.id + "</span></h1>" +
      '<div class="pr-meta">' + prBadge(p) + "<span><b>driftfix</b> wants to merge 1 commit into <code class=\"ref\">" + esc(p.repo.branch) + "</code> from <code class=\"ref\">" + esc(p.branch) + "</code></span>" + diffstat(p.added, p.removed) + "</div></div>" +
      '<div class="tabs">' + tabs + "</div>" +
      '<div class="pr-grid"><div class="pr-col">' + main + "</div>" + side + "</div></div>";
  }
  function sideBlock(t, html) { return '<div class="side-b"><h3>' + t + "</h3>" + html + "</div>"; }

  function prConversation(p, ck, blockers) {
    var rows = [], notes = [];
    p.files.forEach(function (f) {
      f.result.edits.forEach(function (e) { rows.push("<tr><td><code>" + esc(f.path) + ":" + e.line + "</code></td><td>" + esc(e.rule) + "</td><td><code class=\"b\">" + esc(e.before) + "</code></td><td><code class=\"a\">" + esc(e.after) + "</code></td></tr>"); });
      f.result.notes.forEach(function (n) { notes.push("<li><code>" + esc(f.path) + ":" + n.line + "</code> " + ticks(n.msg) + "</li>"); });
    });
    var desc = '<article class="comment"><header><span class="av bot">D</span><b>driftfix</b><span class="tag-bot">bot</span><span class="dim">commented ' + ago(p.opened) + '</span></header><div class="md">' +
      "<p>" + esc(E.CHANGE.summary) + '</p><p>Changelog: <a href="' + E.CHANGE.changelog + '" target="_blank" rel="noopener">' + esc(E.CHANGE.changelog) + "</a></p>" +
      "<h4>What changed</h4><p class=\"dim\">" + plural(p.edits, "edit") + " in " + plural(p.files.length, "file") + ", each one mechanical and reviewable.</p>" +
      '<div class="tscroll"><table class="md-t"><thead><tr><th>Where</th><th>Change</th><th>Before</th><th>After</th></tr></thead><tbody>' + rows.join("") + "</tbody></table></div>" +
      (notes.length ? '<h4>Needs a human look</h4><ul class="md-notes">' + notes.join("") + "</ul>" : "") +
      "<h4>Verification</h4><ul>" + ck.map(function (c) { return "<li><code>" + esc(c.name) + "</code> " + esc(c.detail) + "</li>"; }).join("") + "</ul></div></article>";

    var timeline = '<ol class="timeline">' + p.events.map(function (e) {
      return '<li><span class="tl-ic ' + (e.icon || "") + '">' + icon(e.icon || "dot", 13) + "</span><span>" + e.text + '</span><time title="' + clock(e.at) + '">' + ago(e.at) + "</time></li>";
    }).join("") + "</ol>";

    var comments = p.comments.map(function (m) {
      return '<article class="comment"><header><span class="av">Y</span><b>you</b><span class="dim">commented ' + ago(m.at) + '</span></header><div class="md"><p>' + esc(m.text) + "</p></div></article>";
    }).join("");

    var ckBox = '<div class="mergecard">' +
      '<div class="mc-row">' + (ck.some(function (c) { return c.state === "fail"; }) ? '<span class="st closed">' + icon("x", 16) + "</span><div><b>Some checks failed</b>" : '<span class="st open">' + icon("check", 16) + "</span><div><b>" + (ck.some(function (c) { return c.state === "pending"; }) ? "Checks passed, sign-off pending" : "All checks have passed") + "</b>") + "<small>" + esc(checkLine(p)) + '</small></div><button type="button" class="link" data-act="prtab" data-arg="checks">Details</button></div>';
    if (p.notes && p.state === "open") {
      ckBox += '<div class="mc-row">' + '<span class="st ' + (p.ack ? "open" : "warn") + '">' + icon(p.ack ? "check" : "alert", 16) + "</span><div><b>" + (p.ack ? "Flagged items signed off" : plural(p.notes, "item") + " flagged for a human") + "</b><small>" + (W.settings.requireReview ? "Required by policy before merging" : "Optional under current policy") + "</small></div>" +
        '<label class="checkline"><input type="checkbox" data-act="ack"' + (p.ack ? " checked" : "") + "> I reviewed them</label></div>";
    }
    if (p.state === "merged") ckBox += '<div class="mc-row done"><span class="st merged">' + icon("merge", 16) + "</span><div><b>Pull request merged</b><small>Squashed into " + esc(p.repo.branch) + " " + ago(p.merged) + ". In the demo nothing leaves this tab.</small></div></div>";
    else if (p.state === "closed") ckBox += '<div class="mc-row"><span class="st closed">' + icon("prClosed", 16) + '</span><div><b>Closed without merging</b><small>The branch is kept so you can reopen it.</small></div><button type="button" class="btn sm" data-act="reopen">Reopen</button></div>';
    else ckBox += '<div class="mc-row last"><span class="st ' + (blockers.length ? "warn" : "open") + '">' + icon(blockers.length ? "lock" : "merge", 16) + "</span><div><b>" + (blockers.length ? "Merging is blocked" : "This branch has no conflicts with " + esc(p.repo.branch)) + "</b><small>" + (blockers.length ? esc(blockers.join(" · ")) : "Squash and merge keeps " + esc(p.repo.branch) + " history to one commit.") + "</small></div>" +
      '<div class="mc-act">' + (p.draft ? '<button type="button" class="btn sm" data-act="ready">Ready for review</button>' : "") + '<button type="button" class="btn sm" data-act="closepr">Close</button><button type="button" class="btn sm merge" data-act="merge"' + (blockers.length ? " disabled" : "") + ">" + icon("merge", 13) + "Squash and merge</button></div></div>";
    ckBox += "</div>";

    var compose = p.state === "open" ? '<div class="compose"><span class="av">Y</span><div class="compose-b"><textarea id="app-cmt" rows="3" placeholder="Leave a comment"></textarea><div class="compose-a">' +
      (p.approved ? "" : '<button type="button" class="btn sm" data-act="approve">' + icon("check", 13) + "Approve</button>") + '<button type="button" class="btn sm primary" data-act="comment">Comment</button></div></div></div>' : "";
    return desc + timeline + comments + ckBox + compose;
  }

  function prCommits(p) {
    return '<section class="panel flush"><div class="table-h"><span class="dim">Commits on ' + esc(p.branch) + '</span></div><div class="commit"><span class="av bot">D</span><div><b>' + esc(p.title) + '</b><small>driftfix committed ' + ago(p.opened) + " · " + plural(p.files.length, "file") + ' changed</small></div><code class="sha">' + p.sha + '</code><button type="button" class="icon-btn" data-act="copy-text" data-arg="' + p.sha + '" title="Copy SHA">' + icon("copy", 14) + "</button></div></section>";
  }

  function prChecks(ck) {
    var pass = ck.filter(function (c) { return c.state === "pass"; }).length;
    return '<section class="panel flush"><div class="table-h"><b>' + pass + " of " + ck.length + ' checks passed</b></div>' + ck.map(function (c) {
      var ic = c.state === "pass" ? "check" : c.state === "fail" ? "x" : c.state === "pending" ? "clock" : "dot";
      return '<div class="check-row"><span class="ck ' + (c.state === "pass" ? "pass" : c.state === "fail" ? "fail" : "pend") + '">' + icon(ic, 14) + '</span><div><code>' + esc(c.name) + "</code>" + (c.required ? '<span class="label">required</span>' : "") + "<small>" + esc(c.detail) + '</small></div><span class="dim mono">' + esc(c.time) + "</span></div>";
    }).join("") + "</section>";
  }

  function prFiles(p) {
    var viewed = p.files.filter(function (f) { return p.viewed[f.path]; }).length;
    var tree = '<nav class="ftree"><div class="ftree-h">' + viewed + " / " + p.files.length + ' viewed<span class="bar"><i style="width:' + Math.round(100 * viewed / p.files.length) + '%"></i></span></div>' + p.files.map(function (f) {
      return '<button type="button" data-act="jump" data-arg="' + esc(f.path) + '">' + icon("file", 13) + "<span>" + esc(f.path) + "</span>" + (p.viewed[f.path] ? icon("check", 13, "ok") : "") + "</button>";
    }).join("") + "</nav>";
    var diffs = p.files.map(function (f) {
      var on = !!p.viewed[f.path];
      return '<section class="fdiff' + (on ? " collapsed" : "") + '" id="fd-' + esc(f.path.replace(/[^\w]/g, "-")) + '"><header>' + icon(on ? "chevR" : "chevD", 14) + '<code>' + esc(f.path) + "</code>" + diffstat(f.diff.added, f.diff.removed) +
        (f.result.notes.length ? '<span class="label warn">' + plural(f.result.notes.length, "note") + "</span>" : "") + '<label class="viewed"><input type="checkbox" data-act="viewed" data-arg="' + esc(f.path) + '"' + (on ? " checked" : "") + "> Viewed</label></header>" + (on ? "" : U.diffHTML(f.diff)) + "</section>";
    }).join("");
    return '<div class="files">' + tree + '<div class="fdiffs">' + diffs + "</div></div>";
  }

  function vRepos() {
    crumbs([{ label: "acme" }, { label: "Repositories" }]);
    actions('<button type="button" class="btn sm" data-act="rescan">' + icon("refresh", 14) + 'Rescan</button><button type="button" class="btn sm primary" data-act="connect">' + icon("plus", 14) + "Add repository</button>");
    return '<div class="page"><div class="page-h"><h1>Repositories</h1><p>Driftfix reads code and opens pull requests on its own branch. It never pushes to a default branch.</p></div>' +
      '<section class="panel flush"><div class="tscroll"><table class="grid"><thead><tr><th>Repository</th><th>APIs</th><th>Tests</th><th class="r">Edits</th><th>Status</th><th>Scanned</th></tr></thead><tbody>' +
      W.repos.map(function (r) {
        var e = sum(r.affected, function (f) { return f.result.edits.length; });
        return '<tr data-act="repo" data-arg="' + r.name + '" tabindex="0"><td><div class="repo-c">' + icon("folder", 15, "dim") + '<div><b>' + esc(r.full) + "</b><small>" + esc(r.description) + '</small></div></div></td><td>' + (r.providers.map(function (x) { return '<span class="chip">' + esc(x) + "</span>"; }).join(" ") || '<span class="dim">none</span>') + '</td><td><span class="lang"><i></i>' + esc(r.tests) + '</span></td><td class="r mono">' + (e || '<span class="dim">0</span>') + "</td><td>" + repoState(r) + '</td><td class="dim">' + ago(r.scanned) + "</td></tr>";
      }).join("") + "</tbody></table></div></section>" +
      '<p class="footnote">' + icon("lock", 13) + "The four repositories above are bundled samples so every step works without access to your code. Connecting your own installs the GitHub App on the repositories you choose.</p></div>";
  }

  function vRepo() {
    var r = W.repo, f = r.files[W.file];
    crumbs([{ label: "acme" }, { label: "Repositories", go: "repos" }, { label: r.name }]);
    var busy = W.run && W.run.repo === r && !W.run.done;
    actions(busy ? '<span class="rs"><span class="spin sm"></span>Running…</span>' : r.status === "ready" ? '<button type="button" class="btn sm primary" data-act="run" data-arg="' + r.name + '">' + icon("play", 12) + "Run migration</button>" : r.pr ? '<button type="button" class="btn sm" data-act="pr" data-arg="' + r.pr.id + '">' + icon("pr", 13) + "View #" + r.pr.id + "</button>" : "");
    var head = '<div class="repo-h"><div class="repo-title">' + icon("folder", 18, "dim") + "<h1>" + esc(r.full) + "</h1>" + repoState(r) + "</div><p>" + esc(r.description) + ' · <code class="ref">' + esc(r.branch) + "</code> · tests: " + esc(r.tests) + " · " + (r.providers.map(function (x) { return '<span class="chip">' + esc(x) + "</span>"; }).join(" ") || "no tracked APIs") + "</p></div>";
    var tabs = '<div class="tabs"><button type="button" data-act="repotab" data-arg="code" aria-selected="' + (W.repoTab === "code") + '">' + icon("file", 14) + 'Code</button><button type="button" data-act="repotab" data-arg="history" aria-selected="' + (W.repoTab === "history") + '">' + icon("pr", 14) + "Migrations <span>" + r.history.length + "</span></button></div>";
    var run = W.run && W.run.repo === r ? runPanel() : "";
    if (W.repoTab === "history") {
      return '<div class="page wide">' + head + tabs + run + '<section class="panel flush">' + (r.history.length ? r.history.map(function (p) {
        return '<button type="button" class="prrow" data-act="pr" data-arg="' + p.id + '">' + prIcon(p) + '<span class="prrow-t"><b>' + esc(p.title) + "</b><small>#" + p.id + " · " + ago(p.opened) + '</small></span><span class="prrow-m">' + diffstat(p.added, p.removed) + "</span></button>";
      }).join("") : '<div class="empty-row">' + icon("pr", 16) + "No migrations for this repository yet.</div>") + "</section></div>";
    }
    var banner = r.status === "ready" && !busy ? '<div class="banner warn">' + icon("alert", 16) + "<span><b>" + plural(r.affected.length, "file") + " call the removed OpenAI API.</b> Driftfix has a " + plural(sum(r.affected, function (x) { return x.result.edits.length; }), "edit") + ' patch ready.</span><button type="button" class="btn sm primary" data-act="run" data-arg="' + r.name + '">' + icon("play", 12) + "Run migration</button></div>" : "";
    var tree = '<nav class="ftree">' + r.files.map(function (x, i) {
      var n = x.result.edits.length;
      return '<button type="button" data-act="file" data-arg="' + i + '" aria-current="' + (i === W.file) + '">' + icon("file", 13) + "<span>" + esc(x.path) + "</span>" + (n ? '<em class="warn">' + n + "</em>" : "") + "</button>";
    }).join("") + "</nav>";
    var lines = f.before.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    var hitLines = {};
    f.result.edits.forEach(function (e) { hitLines[e.line] = true; });
    var hl = f.python ? U.highlight(lines.join("\n"), true).split("\n") : lines.map(esc);
    var code = '<div class="viewer"><header><code>' + esc(f.path) + "</code><span class=\"dim\">" + lines.length + " lines" + (f.result.edits.length ? " · " + plural(Object.keys(hitLines).length, "line") + " to change" : "") + '</span><button type="button" class="icon-btn" data-act="copy-file" title="Copy file">' + icon("copy", 14) + '</button></header><div class="code"><table>' +
      hl.map(function (h, i) { return '<tr class="' + (hitLines[i + 1] ? "hit" : "") + '"><td class="ln">' + (i + 1) + "</td><td>" + (h || " ") + "</td></tr>"; }).join("") + "</table></div></div>";
    return '<div class="page wide">' + head + tabs + run + banner + '<div class="repo-grid">' + tree + code + "</div></div>";
  }

  function runPanel() {
    var R = W.run;
    return '<section class="runlog"><header>' + (R.done ? '<span class="st open">' + icon("check", 15) + "</span><b>Migration finished</b>" : '<span class="spin"></span><b>Running migration</b>') +
      '<span class="dim mono">' + esc(R.repo.full) + "</span>" + (R.done && R.pr ? '<button type="button" class="btn sm" data-act="pr" data-arg="' + R.pr.id + '">Open #' + R.pr.id + "</button>" : "") + '</header><pre>' +
      R.lines.slice(0, R.shown).map(function (l) { return '<span class="t">' + l.t + '</span> <span class="' + (l.c || "") + '">' + esc(l.s) + "</span>"; }).join("\n") + "</pre></section>";
  }

  function vChanges() {
    crumbs([{ label: "acme" }, { label: "Provider changes" }]);
    var c = CHANGES.filter(function (x) { return x.id === W.change; })[0] || CHANGES[0];
    var users = W.repos.filter(function (r) { return r.providers.indexOf(c.detect) > -1; });
    var list = CHANGES.map(function (x) {
      return '<button type="button" class="item compact" data-act="change" data-arg="' + x.id + '" aria-current="' + (x.id === c.id) + '"><span class="mark">' + x.mark + '</span><span class="item-t"><b>' + esc(x.provider) + "</b><small>" + esc(x.title) + '</small></span><span class="pill ' + x.status + '">' + STATUS[x.status] + "</span></button>";
    }).join("");
    var detail = '<section class="panel"><div class="ch-h"><span class="mark lg">' + c.mark + "</span><div><h2>" + esc(c.provider) + ": " + esc(c.title) + '</h2><small class="dim">' + esc(c.when) + '</small></div><span class="pill ' + c.status + '">' + STATUS[c.status] + "</span></div>" +
      '<p class="lead">' + esc(c.detail) + '</p><div class="kv"><div><span>Impact</span><b>' + esc(impact(c)) + "</b></div><div><span>Rules</span><b>" + (c.status === "live" ? RULE_COUNT + " rewrite rules, live" : c.status === "watching" ? "In development; affected code is flagged today" : "Planned") + '</b></div><div><span>Source</span><b><a href="' + c.link + '" target="_blank" rel="noopener">Provider notes ' + icon("ext", 12) + "</a></b></div></div>" +
      (c.status === "live" ? '<div class="row-actions"><button type="button" class="btn sm" data-act="go" data-arg="rules">' + icon("book", 13) + "Browse rules</button></div>" : "") +
      '<h3 class="sub">Repositories that use it</h3>' + (users.length ? '<div class="list">' + users.map(function (r) {
        return '<button type="button" class="item compact" data-act="repo" data-arg="' + r.name + '">' + icon("folder", 15, "dim") + '<span class="item-t"><b>' + esc(r.full) + "</b><small>" + esc(r.description) + "</small></span>" + repoState(r) + "</button>";
      }).join("") + "</div>" : '<div class="empty-row">' + icon("check", 16) + "None of your repositories use this API.</div>") + "</section>";
    return '<div class="page wide"><div class="page-h"><h1>Provider changes</h1><p>Breaking changes Driftfix tracks, and which repositories each one touches.</p></div><div class="split"><section class="panel flush"><div class="list">' + list + "</div></section>" + detail + "</div></div>";
  }

  function vRules() {
    crumbs([{ label: "acme" }, { label: "Rules" }, { label: E.CHANGE.id }]);
    var q = W.ruleQuery.toLowerCase();
    function hit() { var s = Array.prototype.join.call(arguments, " ").toLowerCase(); return !q || s.indexOf(q) > -1; }
    var rows = [];
    Object.keys(E.RULES.calls).forEach(function (k) { var v = E.RULES.calls[k]; if (hit(k, v[0], "call")) rows.push(["Call", "openai." + k, (v[1] ? "async_client." : "client.") + v[0], v[1] ? "async" : ""]); });
    Object.keys(E.RULES.errors).forEach(function (k) { if (hit(k, E.RULES.errors[k], "error")) rows.push(["Error", "openai.error." + k, "openai." + E.RULES.errors[k], ""]); });
    Object.keys(E.RULES.settings).forEach(function (k) { if (hit(k, E.RULES.settings[k], "setting")) rows.push(["Setting", "openai." + k + " = …", "OpenAI(" + E.RULES.settings[k] + "=…)", ""]); });
    if (hit("request_timeout timeout argument")) rows.push(["Argument", "request_timeout=", "timeout=", ""]);
    var keys = E.RULES.keys.filter(function (k) { return hit(k, "field response"); });
    return '<div class="page"><div class="page-h"><h1>Rules</h1><p><code>' + esc(E.CHANGE.id) + "</code> · " + RULE_COUNT + " rules. The same table runs in the CLI and on this page.</p></div>" +
      '<div class="search-field">' + icon("search", 14) + '<input id="app-rule-q" data-input="rules" type="search" placeholder="Filter rules: embedding, RateLimit, timeout…" value="' + esc(W.ruleQuery) + '"><span class="dim">' + (rows.length + keys.length) + " shown</span></div>" +
      '<section class="panel flush"><div class="tscroll"><table class="grid"><thead><tr><th>Type</th><th>Before (openai 0.x)</th><th>After (openai 1.x)</th><th></th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (r) { return '<tr><td class="dim">' + r[0] + '</td><td><code class="b">' + esc(r[1]) + '</code></td><td><code class="a">' + esc(r[2]) + "</code></td><td>" + (r[3] ? '<span class="chip">' + r[3] + "</span>" : "") + "</td></tr>"; }).join("") : '<tr><td colspan="4" class="dim">No call, error or setting rules match.</td></tr>') +
      "</tbody></table></div></section>" +
      (keys.length ? '<section class="panel"><div class="panel-h"><h2>Response fields</h2><span class="dim"><code>r["key"]</code> becomes <code>r.key</code></span></div><div class="chips">' + keys.map(function (k) { return '<span class="chip">' + esc(k) + "</span>"; }).join("") + "</div></section>" : "") +
      '<section class="panel"><div class="panel-h"><h2>Left for a human</h2></div><ul class="plain"><li><code>.get()</code> on a response object, which has no dict methods in v1</li><li>Azure <code>engine=</code> arguments, which need the AzureOpenAI client</li><li>Settings changed inside functions, which need the client passed in</li><li><code>from openai import ChatCompletion</code> imports of removed names</li></ul></section></div>';
  }

  function vProvider() {
    crumbs([{ label: "acme" }, { label: "Provider console" }]);
    var P = W.provider, rows = P.rows;
    var onOld = rows.filter(function (r) { return r.onOld; }).length;
    var ready = rows.filter(function (r) { return r.onOld && r.state === "done"; }).length;
    var flagged = rows.filter(function (r) { return r.state === "done" && r.file.result.notes.length; }).length;
    actions(P.ran && !P.running ? '<button type="button" class="btn sm" data-act="provider-reset">' + icon("refresh", 13) + "Reset</button>" : '<button type="button" class="btn sm primary" data-act="provider-run"' + (P.running ? " disabled" : "") + ">" + icon("zap", 13) + "Prepare " + plural(onOld, "PR") + "</button>");
    function bar(n, label) { var pct = Math.round(100 * n / rows.length); return '<div class="adopt"><span>' + label + '</span><div class="track"><i style="width:' + pct + '%"></i></div><b>' + n + "/" + rows.length + "</b></div>"; }
    return '<div class="page"><div class="page-h"><h1>Provider console</h1><p>For API companies: move every integrator off a version before you switch it off.</p></div>' +
      '<div class="banner">' + icon("layers", 16) + "<span>Sample integrators. Picture yourself as the API provider: these six apps call your API and five still use the version you want to retire.</span></div>" +
      '<div class="stats three"><div><span>Integrators on old version</span><b>' + onOld + "</b></div><div><span>Migration PRs prepared</span><b>" + ready + "</b></div><div><span>Flagged for their review</span><b>" + flagged + "</b></div></div>" +
      '<section class="panel"><div class="panel-h"><h2>Adoption of the new version</h2></div>' + bar(rows.length - onOld, "Today") + bar(rows.length - onOld + ready, "After the prepared PRs merge") + "</section>" +
      (P.log.length ? '<section class="runlog"><header>' + (P.running ? '<span class="spin"></span><b>Preparing pull requests</b>' : '<span class="st open">' + icon("check", 15) + "</span><b>Done</b>") + "</header><pre>" + P.log.map(function (l) { return '<span class="t">' + l.t + '</span> <span class="' + (l.c || "") + '">' + esc(l.s) + "</span>"; }).join("\n") + "</pre></section>" : "") +
      '<section class="panel flush"><div class="tscroll"><table class="grid"><thead><tr><th>Integrator</th><th>File</th><th>Version in their code</th><th>Migration</th></tr></thead><tbody>' +
      rows.map(function (r, i) {
        var st = !r.onOld ? '<span class="rs ok">' + icon("check", 14) + "Already on v1</span>"
          : r.state === "run" ? '<span class="rs"><span class="spin sm"></span>Patching…</span>'
          : r.state === "done" ? '<span class="rs open">' + icon("pr", 14) + "PR ready · " + plural(r.file.result.edits.length, "edit") + (r.file.result.notes.length ? ", " + r.file.result.notes.length + " to review" : "") + "</span>"
          : '<span class="rs warn">' + icon("alert", 14) + "Needs migration</span>";
        return '<tr data-act="integrator" data-arg="' + i + '" tabindex="0"><td><b>' + esc(r.name) + '</b></td><td><code>' + esc(r.file.path) + "</code></td><td>" + (r.onOld ? '<span class="chip warn">openai 0.x</span>' : '<span class="chip">openai 1.x</span>') + "</td><td>" + st + "</td></tr>";
      }).join("") + "</tbody></table></div></section></div>";
  }

  function vSettings() {
    crumbs([{ label: "acme" }, { label: "Settings" }]);
    var s = W.settings, draft = W.prefixDraft == null ? s.branchPrefix : W.prefixDraft;
    var valid = /^[A-Za-z0-9._\-\/]+\/$/.test(draft), dirty = draft !== s.branchPrefix;
    function tog(key, title, desc) {
      return '<label class="setting"><span><b>' + title + "</b><small>" + desc + '</small></span><input type="checkbox" class="switch" data-act="setting" data-arg="' + key + '"' + (s[key] ? " checked" : "") + "></label>";
    }
    return '<div class="page narrow"><div class="page-h"><h1>Settings</h1><p>Policies apply to every repository in acme.</p></div>' +
      '<section class="card"><div class="card-b"><h2>GitHub</h2><p>Install the Driftfix GitHub App on the repositories you choose.</p><ul class="plain perm"><li>' + icon("eye", 13) + "Read code and metadata</li><li>" + icon("branch", 13) + "Create branches with your prefix and open pull requests</li><li>" + icon("check", 13) + "Read check results from your CI</li><li>" + icon("lock", 13) + "No write access to default branches</li></ul></div>" +
      '<div class="card-f"><span class="dim">This demo runs on bundled sample repositories.</span><button type="button" class="btn sm primary" data-act="connect">Connect GitHub</button></div></section>' +
      '<section class="card"><div class="card-b"><h2>Pull request policy</h2>' +
      tog("runTests", "Run tests before and after the patch", "If tests that passed start failing, Driftfix rolls back and opens nothing.") +
      tog("autoOpen", "Open pull requests automatically", "When off, Driftfix prepares the branch and waits for you.") +
      tog("requireReview", "Require sign-off on flagged items", "Merging stays blocked until someone confirms the flagged items were checked.") +
      tog("draftFlagged", "Open as draft when anything is flagged", "Keeps partly automated changes out of the review queue.") + "</div></section>" +
      '<section class="card"><div class="card-b"><h2>Branch prefix</h2><p>Every migration branch starts with this. Branches look like <code>' + esc(draft) + 'openai-python-v1</code>.</p><input id="app-prefix" data-input="prefix" class="text" value="' + esc(draft) + '" spellcheck="false" aria-label="Branch prefix">' +
      (valid ? "" : '<p class="err">Use letters, numbers, dashes, dots and slashes, ending with a slash.</p>') + '</div><div class="card-f"><span class="dim">Applies to new pull requests.</span><button type="button" class="btn sm primary" data-act="save-prefix"' + (valid && dirty ? "" : " disabled") + ">Save</button></div></section>" +
      '<section class="card"><div class="card-b"><h2>Notifications</h2>' + tog("digest", "Weekly email digest", "Upcoming sunsets and open migration PRs.") + tog("slack", "Post new pull requests to Slack", "Sends to the channel you pick once Slack is connected.") + "</div></section>" +
      '<section class="card danger"><div class="card-b"><h2>Reset demo</h2><p>Rescans the sample repositories and clears pull requests, comments and merges.</p></div><div class="card-f"><span></span><button type="button" class="btn sm danger" data-act="reset">Reset demo</button></div></section></div>';
  }

  // ---------- flows ----------
  function now() { return new Date().toISOString().slice(11, 23); }

  function runMigration(repo) {
    if (!repo || repo.status !== "ready" || (W.run && !W.run.done)) return;
    if (W.view !== "repo" || W.repo !== repo) go("repo", repo);
    var files = repo.affected;
    var py = repo.files.filter(function (f) { return f.python; }).length;
    var lines = [
      { s: "Reading change map " + E.CHANGE.id + " (" + RULE_COUNT + " rules)" },
      { s: "Checking out " + repo.full + " @ " + repo.branch + " (bundled sample)" },
      { s: "Scanning " + plural(py, "Python file") + " for openai 0.x usage" }
    ];
    files.forEach(function (f) { lines.push({ s: "  " + f.path + ": " + plural(f.result.calls, "removed call") + ", " + plural(f.result.edits.length, "edit") + (f.result.notes.length ? ", " + f.result.notes.length + " flagged" : ""), c: "dim" }); });
    lines.push({ s: "Rewriting the syntax tree, comments and formatting preserved" });
    lines.push({ s: "Verify: " + sum(files, function (f) { return f.remaining.length; }) + " removed calls remain, structure intact", c: "ok" });
    lines.push({ s: W.settings.runTests ? (repo.recorded ? "Tests: " + repo.recorded.before + " -> " + repo.recorded.after : "Tests: " + repo.tests + " runs in your CI after connecting") : "Tests: skipped by policy", c: W.settings.runTests && repo.recorded ? "ok" : "dim" });
    lines.push({ s: "Created branch " + W.settings.branchPrefix + "openai-python-v1 (+" + sum(files, function (f) { return f.diff.added; }) + " -" + sum(files, function (f) { return f.diff.removed; }) + ")" });
    lines.forEach(function (l) { l.t = now(); });
    W.run = { repo: repo, lines: lines, shown: 0, done: false, pr: null };
    var step = function () {
      if (W.run.shown < lines.length) {
        W.run.lines[W.run.shown].t = now(); W.run.shown++;
        if (W.view === "repo") render();
        setTimeout(step, U.reduce ? 0 : 220);
        return;
      }
      if (W.settings.autoOpen) {
        var pr = openPR(repo);
        W.run.lines.push({ t: now(), s: "Opened pull request #" + pr.id + (pr.draft ? " as a draft" : ""), c: "ok" });
        W.run.shown = W.run.lines.length; W.run.pr = pr;
      } else {
        W.run.lines.push({ t: now(), s: "Automatic pull requests are off; branch is ready to open", c: "dim" });
        W.run.shown = W.run.lines.length;
        log("scan", "Prepared a migration branch for " + repo.full);
      }
      W.run.done = true;
      if (W.view === "repo") render();
    };
    step();
  }

  function runProvider() {
    var P = W.provider;
    if (P.running) return;
    P.running = true; P.ran = true; P.log = [{ t: now(), s: "Scanning " + plural(P.rows.length, "integrator") + " for calls to the retired version" }];
    var queue = P.rows.filter(function (r) { return r.onOld; }), i = 0;
    render();
    (function next() {
      if (i > 0) {
        var prev = queue[i - 1]; prev.state = "done";
        P.log.push({ t: now(), s: "  " + prev.name + ": " + plural(prev.file.result.edits.length, "edit") + (prev.file.result.notes.length ? ", flagged, sent as draft" : ", PR ready"), c: prev.file.result.notes.length ? "warn" : "dim" });
      }
      if (i >= queue.length) {
        P.running = false;
        var flagged = queue.filter(function (r) { return r.file.result.notes.length; }).length;
        P.log.push({ t: now(), s: "Prepared " + plural(queue.length, "pull request") + " (" + flagged + " as draft)", c: "ok" });
        log("provider", "Prepared " + plural(queue.length, "migration PR") + " for integrators");
        toast(plural(queue.length, "pull request") + " prepared", flagged + " flagged for the integrator's review");
        if (W.view === "provider") render();
        return;
      }
      queue[i].state = "run"; i++;
      if (W.view === "provider") render();
      setTimeout(next, U.reduce ? 0 : 340);
    })();
  }

  function rescan() {
    var t0 = performance.now();
    W.repos.forEach(function (r) { r.scanned = new Date(); r.files.forEach(function (f) { analyze(f.path, f.before); }); });
    log("scan", "Rescanned " + W.repos.length + " repositories, no new provider changes", Math.max(1, Math.round(performance.now() - t0)) + " ms");
    toast("Rescan complete", "No new provider changes since the last scan");
    render();
  }

  // ---------- events ----------
  function onClick(e) {
    var t = e.target.closest("[data-act]");
    if (!t || !app.contains(t) || t.disabled) return;
    var act = t.getAttribute("data-act"), arg = t.getAttribute("data-arg");
    if (t.type === "checkbox") return; // handled on change
    if (t.tagName === "A") e.preventDefault();
    switch (act) {
      case "go": go(arg); break;
      case "pr": go("pr", byPR(+arg)); break;
      case "repo": go("repo", byRepo(arg)); break;
      case "run": runMigration(byRepo(arg)); break;
      case "change": W.change = arg; go("changes"); break;
      case "prfilter": W.prFilter = arg; render(); break;
      case "prtab": W.prTab = arg; render(); break;
      case "repotab": W.repoTab = arg; render(); break;
      case "file": W.file = +arg; render(); break;
      case "rescan": rescan(); break;
      case "palette": openPalette(); break;
      case "fullscreen": toggleFull(); break;
      case "jump": var el = body.querySelector("#fd-" + arg.replace(/[^\w]/g, "-")); if (el) el.scrollIntoView({ block: "start", behavior: U.reduce ? "auto" : "smooth" }); break;
      case "merge": var p = W.pr; if (mergeBlockers(p).length) return; p.state = "merged"; p.merged = new Date(); p.events.push({ at: p.merged, icon: "merge", text: "<b>you</b> merged commit <code>" + p.sha + "</code> into " + esc(p.repo.branch) }); p.repo.status = "merged"; log("merge", "Merged #" + p.id + " in " + p.repo.full); toast("Merged #" + p.id, p.repo.full + " is on the OpenAI v1 SDK"); render(); break;
      case "closepr": W.pr.state = "closed"; W.pr.events.push({ at: new Date(), icon: "prClosed", text: "<b>you</b> closed this pull request" }); W.pr.repo.status = "ready"; W.pr.repo.pr = null; log("close", "Closed #" + W.pr.id); render(); break;
      case "reopen": W.pr.state = "open"; W.pr.events.push({ at: new Date(), icon: "pr", text: "<b>you</b> reopened this pull request" }); W.pr.repo.status = "pr"; W.pr.repo.pr = W.pr; render(); break;
      case "ready": W.pr.draft = false; W.pr.events.push({ at: new Date(), icon: "eye", text: "<b>you</b> marked this pull request ready for review" }); render(); break;
      case "approve": W.pr.approved = true; W.pr.events.push({ at: new Date(), icon: "check", text: "<b>you</b> approved these changes" }); toast("Approved #" + W.pr.id); render(); break;
      case "comment": var ta = app.querySelector("#app-cmt"); var txt = ta.value.trim(); if (!txt) { ta.focus(); return; } W.pr.comments.push({ at: new Date(), text: txt }); render(); break;
      case "copy-branch": case "copy-text": U.copy(arg, t); break;
      case "copy-file": U.copy(W.repo.files[W.file].before, t); toast("Copied " + W.repo.files[W.file].path); break;
      case "integrator": showIntegrator(W.provider.rows[+arg]); break;
      case "provider-run": runProvider(); break;
      case "provider-reset": W.provider.ran = false; W.provider.log = []; W.provider.rows.forEach(function (r) { r.state = "idle"; }); render(); break;
      case "save-prefix": W.settings.branchPrefix = W.prefixDraft; W.prefixDraft = null; saveSettings(); toast("Branch prefix saved", W.settings.branchPrefix + "openai-python-v1"); render(); break;
      case "connect": modal('<h2>Connect GitHub</h2><p>Connecting installs the Driftfix GitHub App on the repositories you pick. This demo runs on bundled samples, so there is nothing to install here.</p><p>Want Driftfix on your own code? Request access and we will send the install link with your first migration.</p><div class="modal-a"><button type="button" class="btn sm" data-act="close-modal">Not now</button><button type="button" class="btn sm primary" data-act="request-access">Request access</button></div>'); break;
      case "request-access": closeModal(); if (isFull()) toggleFull(); var c = document.getElementById("contact"); if (c) c.scrollIntoView({ behavior: U.reduce ? "auto" : "smooth" }); break;
      case "reset": init(); W.view = "settings"; render(); toast("Demo reset", "Sample repositories rescanned"); break;
      case "close-modal": closeModal(); break;
      case "pal-item": choose(+arg); break;
    }
  }
  function onChange(e) {
    var t = e.target, act = t.getAttribute("data-act"), arg = t.getAttribute("data-arg");
    if (act === "setting") { W.settings[arg] = t.checked; saveSettings(); toast("Settings saved", t.closest(".setting").querySelector("b").textContent + (t.checked ? ": on" : ": off")); }
    if (act === "ack") { W.pr.ack = t.checked; if (t.checked) W.pr.events.push({ at: new Date(), icon: "check", text: "<b>you</b> signed off the " + plural(W.pr.notes, "flagged item") }); render(); }
    if (act === "viewed") { W.pr.viewed[arg] = t.checked; render(); }
  }
  function onInput(e) {
    var t = e.target, which = t.getAttribute("data-input");
    if (which === "rules") { W.ruleQuery = t.value; var pos = t.selectionStart; render(); var n = app.querySelector("#app-rule-q"); n.focus(); n.setSelectionRange(pos, pos); }
    if (which === "prefix") { W.prefixDraft = t.value; var p2 = t.selectionStart; render(); var m = app.querySelector("#app-prefix"); m.focus(); m.setSelectionRange(p2, p2); }
  }
  function onKey(e) {
    var row = e.target.closest && e.target.closest("tr[data-act]");
    if (row && e.key === "Enter") { e.preventDefault(); row.click(); }
    if (!app.querySelector("#app-pal").hidden) {
      if (e.key === "ArrowDown") { e.preventDefault(); palIndex = Math.min(palItems.length - 1, palIndex + 1); paintPalette(true); }
      else if (e.key === "ArrowUp") { e.preventDefault(); palIndex = Math.max(0, palIndex - 1); paintPalette(true); }
      else if (e.key === "Enter") { e.preventDefault(); choose(palIndex); }
    }
  }
  function byPR(id) { return W.prs.filter(function (p) { return p.id === id; })[0]; }
  function byRepo(n) { return W.repos.filter(function (r) { return r.name === n; })[0]; }

  function showIntegrator(r) {
    var f = r.file;
    modal('<h2>' + esc(r.name) + ' <span class="dim mono">' + esc(f.path) + "</span></h2>" +
      (f.after === f.before ? '<p class="dim">Already on the v1 client. Nothing to send.</p>' : '<p class="dim">' + plural(f.result.edits.length, "edit") + " · " + diffstat(f.diff.added, f.diff.removed) + '</p><div class="modal-diff">' + U.diffHTML(f.diff) + "</div>" +
        (f.result.notes.length ? '<ul class="md-notes">' + f.result.notes.map(function (n) { return "<li><code>L" + n.line + "</code> " + ticks(n.msg) + "</li>"; }).join("") + "</ul>" : "")) +
      '<div class="modal-a"><button type="button" class="btn sm" data-act="close-modal">Close</button></div>');
  }

  // ---------- overlays ----------
  function modal(html) { var m = app.querySelector("#app-modal"); m.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + html + "</div>"; m.hidden = false; var b = m.querySelector(".modal-a .btn:last-child"); if (b) b.focus(); m.onclick = function (ev) { if (ev.target === m) closeModal(); }; }
  function closeModal() { app.querySelector("#app-modal").hidden = true; }
  function toast(title, sub) {
    var t = document.createElement("div"); t.className = "toast";
    t.innerHTML = icon("check", 14) + "<div><b>" + esc(title) + "</b>" + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</div>";
    app.querySelector("#app-toasts").appendChild(t);
    setTimeout(function () { t.classList.add("out"); }, 3000);
    setTimeout(function () { t.remove(); }, 3500);
  }

  var palIndex = 0, palItems = [];
  function entries() {
    var out = NAV.filter(function (n) { return n.id; }).map(function (n) { return { g: "Go to", label: n.label, ic: n.icon, run: function () { go(n.id); } }; });
    W.repos.forEach(function (r) {
      out.push({ g: "Repositories", label: r.full, ic: "folder", run: function () { go("repo", r); } });
      if (r.status === "ready") out.push({ g: "Actions", label: "Run migration on " + r.name, ic: "play", run: function () { runMigration(r); } });
    });
    W.prs.forEach(function (p) { out.push({ g: "Pull requests", label: "#" + p.id + " " + p.title + " (" + p.repo.name + ")", ic: p.state === "merged" ? "merge" : "pr", run: function () { go("pr", p); } }); });
    out.push({ g: "Actions", label: "Rescan all repositories", ic: "refresh", run: rescan });
    out.push({ g: "Actions", label: isFull() ? "Exit full screen" : "Enter full screen", ic: "max", run: toggleFull });
    out.push({ g: "Actions", label: "Reset demo", ic: "refresh", run: function () { init(); render(); toast("Demo reset"); } });
    return out;
  }
  function openPalette() { var p = app.querySelector("#app-pal"); p.hidden = false; var i = app.querySelector("#app-pal-in"); i.value = ""; palIndex = 0; paintPalette(); i.focus(); p.onclick = function (ev) { if (ev.target === p) closePalette(); }; }
  function closePalette() { app.querySelector("#app-pal").hidden = true; }
  function paintPalette(keepScroll) {
    var q = app.querySelector("#app-pal-in").value.toLowerCase().trim();
    palItems = entries().filter(function (x) { return !q || (x.label + " " + x.g).toLowerCase().indexOf(q) > -1; });
    palIndex = Math.max(0, Math.min(palIndex, palItems.length - 1));
    var html = "", group = null;
    palItems.forEach(function (x, i) {
      if (x.g !== group) { group = x.g; html += '<div class="pal-g">' + group + "</div>"; }
      html += '<button type="button" role="option" data-act="pal-item" data-arg="' + i + '" aria-selected="' + (i === palIndex) + '">' + icon(x.ic, 14) + "<span>" + esc(x.label) + "</span>" + (i === palIndex ? "<kbd>↵</kbd>" : "") + "</button>";
    });
    var list = app.querySelector("#app-pal-list");
    list.innerHTML = html || '<div class="empty-row">No results</div>';
    if (keepScroll) { var sel = list.querySelector('[aria-selected="true"]'); if (sel) sel.scrollIntoView({ block: "nearest" }); }
  }
  function choose(i) { var x = palItems[i]; closePalette(); if (x) x.run(); }

  // ---------- frame ----------
  var frame;
  function isFull() { return frame && frame.classList.contains("is-full"); }
  function toggleFull(force) {
    var on = typeof force === "boolean" ? force : !isFull();
    frame.classList.toggle("is-full", on);
    document.documentElement.classList.toggle("lock", on);
    var b = app.querySelector('[data-act="fullscreen"]');
    if (b) { b.innerHTML = icon(on ? "min" : "max", 15); b.title = on ? "Exit full screen (Esc)" : "Full screen"; }
  }
  document.addEventListener("keydown", function (e) {
    if (!app) return;
    var inside = isFull() || app.contains(document.activeElement);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && inside) { e.preventDefault(); if (app.querySelector("#app-pal").hidden) openPalette(); else closePalette(); return; }
    if (e.key === "Escape") {
      if (!app.querySelector("#app-pal").hidden) { closePalette(); return; }
      if (!app.querySelector("#app-modal").hidden) { closeModal(); return; }
      if (isFull()) toggleFull(false);
    }
  });

  function mount(container, frameEl) {
    app = container; frame = frameEl;
    shell(); init(); render();
    setInterval(function () { if (!document.hidden && (W.view === "inbox" || W.view === "prs")) render(); }, 30000);
  }
  function open(view, full) {
    if (!app) return;
    if (view) go(view);
    if (full) toggleFull(view ? true : !isFull());
    else frame.scrollIntoView({ behavior: U.reduce ? "auto" : "smooth", block: "start" });
  }

  window.DriftfixWorkspace = { mount: mount, open: open, full: toggleFull };
})();
