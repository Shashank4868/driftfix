"""Rewrite rules for the OpenAI Node.js SDK v3 -> v4 migration (JavaScript and TypeScript).

v3 wrapped axios: `new OpenAIApi(new Configuration({...}))`, methods like
`openai.createChatCompletion(...)`, and every response under `.data`. v4 has one
client class, resource namespaces (`openai.chat.completions.create`) and returns
the payload directly.

JavaScript is lexed first so string, template-literal and comment contents are
never edited; rules run on that masked copy and write edits back to the source.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from driftfix.rules.openai_v1 import Edit, Note, Result

METHODS = {
    "createChatCompletion": "chat.completions.create",
    "createCompletion": "completions.create",
    "createEmbedding": "embeddings.create",
    "createImage": "images.generate",
    "createImageEdit": "images.edit",
    "createImageVariation": "images.createVariation",
    "createModeration": "moderations.create",
    "listModels": "models.list",
    "retrieveModel": "models.retrieve",
}
# v3 methods whose arguments changed shape; rewritten by hand, so only flagged.
FLAG_METHODS = {
    "createTranscription": "audio.transcriptions.create",
    "createTranslation": "audio.translations.create",
    "createFile": "files.create",
    "createFineTune": "fineTuning.jobs.create",
}
CONFIG_RENAMES = {"basePath": "baseURL"}
V3_TYPES = {"Configuration", "OpenAIApi"}

JS_EXTENSIONS = (".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx")


def mask(src: str) -> str:
    """Same-length copy with string, template and comment contents blanked (newlines kept)."""
    out = list(src)
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if c == "/" and nxt == "/":
            while i < n and src[i] != "\n":
                out[i] = " "
                i += 1
            continue
        if c == "/" and nxt == "*":
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            for k in range(i, j):
                if out[k] != "\n":
                    out[k] = " "
            i = j
            continue
        if c in "'\"`":
            q, j = c, i + 1
            depth = 0
            while j < n:
                ch = src[j]
                if ch == "\\":
                    j += 2
                    continue
                if q == "`" and ch == "$" and j + 1 < n and src[j + 1] == "{":
                    depth += 1
                    j += 2
                    continue
                if q == "`" and depth and ch == "}":
                    depth -= 1
                    j += 1
                    continue
                if ch == q and not depth:
                    break
                if q != "`" and ch == "\n":
                    break
                j += 1
            for k in range(i + 1, min(j, n)):
                if out[k] != "\n":
                    out[k] = " "
            i = min(n, j + 1)
            continue
        i += 1
    return "".join(out)


def match_close(m: str, open_i: int) -> int:
    pairs = {"(": ")", "[": "]", "{": "}"}
    stack: list[str] = []
    for i in range(open_i, len(m)):
        ch = m[i]
        if ch in pairs:
            stack.append(pairs[ch])
        elif ch in ")]}":
            if not stack or stack.pop() != ch:
                return -1
            if not stack:
                return i
    return -1


def statement_end(m: str, start: int) -> int:
    """Index just past the statement starting at `start` (handles `;`, newline at depth 0)."""
    depth = 0
    for i in range(start, len(m)):
        ch = m[i]
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif depth == 0 and ch == ";":
            return i + 1
        elif depth == 0 and ch == "\n" and i > start and m[start:i].strip():
            return i
    return len(m)


@dataclass
class _Edit:
    start: int
    end: int
    text: str
    rule: str = ""
    before: str = ""
    after: str = ""
    report: bool = True


def _line(src: str, i: int) -> int:
    return src.count("\n", 0, i) + 1


def _strip_line(src: str, start: int, end: int) -> tuple[int, int]:
    """Widen a removal to the whole line when nothing else lives on it."""
    ls = src.rfind("\n", 0, start) + 1
    le = src.find("\n", end)
    le = len(src) if le < 0 else le
    if src[ls:start].strip() == "" and src[end:le].strip() == "":
        return ls, min(len(src), le + 1)
    return start, end


def migrate(source: str) -> Result:
    src = source.replace("\r\n", "\n")
    m = mask(src)
    edits: list[_Edit] = []
    notes: list[Note] = []

    # Only files that import the v3 client classes from "openai"
    imp_es = re.compile(r"import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*(['\"])openai\2[ \t]*(;?)")
    imp_cjs = re.compile(r"(const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*(['\"])openai\3\s*\)[ \t]*(;?)")
    found_import = False
    for rx, kind in ((imp_es, "es"), (imp_cjs, "cjs")):
        for hit in rx.finditer(src):
            if m[hit.start()] == " ":  # inside a comment or string
                continue
            names_raw = hit.group(1) if kind == "es" else hit.group(2)
            names = [n.strip() for n in names_raw.split(",") if n.strip()]
            bare = [n.split(" as ")[0].strip() for n in names]
            if not V3_TYPES & set(bare):
                continue
            found_import = True
            rest = [n for n, b in zip(names, bare) if b not in V3_TYPES]
            # keep the file's own quote and semicolon style
            q = hit.group(2) if kind == "es" else hit.group(3)
            semi = hit.group(3) if kind == "es" else hit.group(4)
            if kind == "es":
                new = f"import OpenAI from {q}openai{q}{semi}" if not rest else "import OpenAI, { " + ", ".join(rest) + f" }} from {q}openai{q}{semi}"
            else:
                new = f"{hit.group(1)} OpenAI = require({q}openai{q}){semi}"
            if rest:
                notes.append(Note(_line(src, hit.start()), f"`{', '.join(rest)}` came from the v3 SDK and may not exist in v4; use the `OpenAI.Chat.*` types."))
            edits.append(_Edit(hit.start(), hit.end(), new, "import updated", hit.group(0).strip(), new))
    if not found_import:
        return Result(source, source)

    # new OpenAIApi(new Configuration({...})) inline
    for hit in re.finditer(r"new\s+OpenAIApi\s*\(\s*new\s+Configuration\s*\(", m):
        inner_open = m.index("(", m.index("Configuration", hit.start()))
        inner_close = match_close(m, inner_open)
        outer_open = m.index("(", hit.start())
        outer_close = match_close(m, outer_open)
        if inner_close < 0 or outer_close < 0:
            continue
        args = _rename_config(src[inner_open + 1:inner_close], m[inner_open + 1:inner_close])
        # Unwrapping one level of nesting: pull the inner block back to where the outer call sat.
        cfg_at = m.index("Configuration", hit.start())
        cfg_line = src.rfind("\n", 0, cfg_at) + 1
        out_line = src.rfind("\n", 0, hit.start()) + 1
        if cfg_line != out_line:
            outer_text = src[out_line:hit.start()]
            base = len(outer_text) - len(outer_text.lstrip(" \t"))
            if outer_text.lstrip().startswith(("?", ":")):
                base += 2
            lead = src[cfg_line:cfg_at]
            cfg_indent = len(lead) - len(lead.lstrip(" \t"))
            shift = max(0, cfg_indent - base)
            if shift:
                args = "\n".join(ln[shift:] if ln[:shift].strip() == "" else ln for ln in args.split("\n"))
        new = "new OpenAI(" + args + ")"
        edits.append(_Edit(hit.start(), outer_close + 1, new, "client constructed directly", src[hit.start():outer_close + 1].split("\n")[0], "new OpenAI(...)"))

    # const configuration = new Configuration({...}); ... new OpenAIApi(configuration)
    for hit in re.finditer(r"(?:const|let|var)\s+(\w+)\s*(?::\s*\w+\s*)?=\s*new\s+Configuration\s*\(", m):
        cfg = hit.group(1)
        open_i = m.index("(", hit.end() - 1)
        close_i = match_close(m, open_i)
        if close_i < 0:
            continue
        args = _rename_config(src[open_i + 1:close_i], m[open_i + 1:close_i])
        use = re.search(r"new\s+OpenAIApi\s*\(\s*" + re.escape(cfg) + r"\s*\)", m)
        if not use:
            notes.append(Note(_line(src, hit.start()), f"`{cfg}` is a v3 Configuration that isn't passed to OpenAIApi here; pass its options to `new OpenAI()`."))
            continue
        end = statement_end(m, hit.start())
        s, e = _strip_line(src, hit.start(), end)
        edits.append(_Edit(s, e, "", "configuration folded into client", src[hit.start():end].strip().split("\n")[0], "(removed)"))
        edits.append(_Edit(use.start(), use.end(), "new OpenAI(" + args + ")", "client constructed directly", src[use.start():use.end()], "new OpenAI({ ... })"))

    # method calls
    calls = []
    for hit in re.finditer(r"\.(" + "|".join(list(METHODS) + list(FLAG_METHODS)) + r")\s*\(", m):
        name = hit.group(1)
        open_i = hit.end() - 1
        close_i = match_close(m, open_i)
        if name in FLAG_METHODS:
            notes.append(Note(_line(src, hit.start()), f"`{name}` takes different arguments in v4 (`{FLAG_METHODS[name]}`); migrate it by hand."))
            continue
        new = "." + METHODS[name]
        edits.append(_Edit(hit.start(), hit.start() + 1 + len(name), new, "method moved to resource", "." + name, new))
        calls.append((hit.start(), close_i))
        if close_i > 0:
            args = m[open_i + 1:close_i]
            depth, split = 0, -1
            for k, ch in enumerate(args):
                if ch in "([{":
                    depth += 1
                elif ch in ")]}":
                    depth -= 1
                elif ch == "," and depth == 0 and args[k + 1:].strip():
                    split = k
                    break
            if split >= 0:
                notes.append(Note(_line(src, hit.start()), "A second (axios request options) argument was passed; v4 takes request options like `{ timeout }` instead. Check it."))
            if re.search(r"responseType\s*:", src[open_i:close_i]):
                notes.append(Note(_line(src, hit.start()), "`responseType: \"stream\"` streaming changed in v4: pass `stream: true` and iterate with `for await`."))

    # response unwrapping: v3 payload lived under `.data`
    tracked: set[str] = set()
    for start, close_i in calls:
        line_start = m.rfind("\n", 0, start) + 1
        prefix = m[line_start:start]
        hit = re.search(r"(?:const|let|var)?\s*(\w+)\s*(?::\s*[\w.<>\[\]]+\s*)?=\s*(?:await\s+)?[\w.$]+$", prefix)
        dest = re.search(r"(?:const|let|var)\s*\{\s*data(?:\s*:\s*(\w+))?\s*\}\s*=\s*(?:await\s+)?[\w.$]+$", prefix)
        if dest:
            name = dest.group(1) or "data"
            brace = m.index("{", line_start + dest.start())
            brace_end = m.index("}", brace) + 1
            edits.append(_Edit(brace, brace_end, name, "response unwrapped", src[brace:brace_end], name))
        elif hit:
            tracked.add(hit.group(1))
        if close_i > 0:
            after = m[close_i + 1:close_i + 7]
            if after.startswith(").data") or after.startswith(".data"):
                at = m.index(".data", close_i + 1)
                edits.append(_Edit(at, at + 5, "", "response unwrapped", ".data", "(removed)"))
    for name in tracked:
        for hit in re.finditer(r"(?<![\w.$])" + re.escape(name) + r"(\?)?\.data\b", m):
            optional = hit.group(1) or ""
            edits.append(_Edit(hit.start(), hit.end(), name + optional, "response unwrapped", src[hit.start():hit.end()], name + optional))

    # error shape changed
    for hit in re.finditer(r"\b(\w+)(\?)?\.response(\?)?\.(status|data)\b", m):
        if hit.group(1) in ("res", "response", "window", "document"):
            continue
        notes.append(Note(_line(src, hit.start()), f"`{src[hit.start():hit.end()]}` reads an axios error; v4 errors are `OpenAI.APIError` with `.status` and `.error`."))

    # leftover references to the removed classes (type annotations, instanceof, ...)
    for hit in re.finditer(r"(?<![\w.$])(OpenAIApi|Configuration)(?![\w$])", m):
        if any(e.start <= hit.start() < e.end for e in edits):
            continue
        if hit.group(1) == "OpenAIApi":
            edits.append(_Edit(hit.start(), hit.end(), "OpenAI", "type renamed", "OpenAIApi", "OpenAI"))
        else:
            notes.append(Note(_line(src, hit.start()), "`Configuration` no longer exists in v4; pass these options to `new OpenAI()`."))

    # apply, last first, skipping overlaps
    code = src
    guard = len(src) + 1
    for e in sorted(edits, key=lambda x: (x.start, x.end), reverse=True):
        if e.end > guard:
            continue
        code = code[:e.start] + e.text + code[e.end:]
        guard = e.start

    out_edits = [Edit(_line(src, e.start), e.rule, e.before, e.after) for e in sorted(edits, key=lambda x: x.start) if e.report and e.rule]
    uniq_notes = []
    seen = set()
    for n in notes:
        if (n.line, n.message) not in seen:
            seen.add((n.line, n.message))
            uniq_notes.append(n)
    return Result(source.replace("\r\n", "\n"), code, edits=out_edits, notes=sorted(uniq_notes, key=lambda n: n.line))


def _rename_config(args: str, masked: str) -> str:
    out = args
    for old, new in CONFIG_RENAMES.items():
        for hit in reversed(list(re.finditer(r"\b" + old + r"\s*:", masked))):
            out = out[:hit.start()] + new + out[hit.start() + len(old):]
    return out
