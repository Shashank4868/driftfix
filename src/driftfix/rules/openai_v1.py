"""Rewrite rules for the OpenAI Python SDK v0 -> v1 migration.

Works on the concrete syntax tree (libcst), so comments, formatting and quoting
in the user's file are preserved. Two passes: the first collects what the file
does with the openai module, the second rewrites it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import libcst as cst
from libcst.metadata import MetadataWrapper, PositionProvider

# (Resource, method) -> (client path, is_async)
CALLS: dict[tuple[str, str], tuple[str, bool]] = {
    ("ChatCompletion", "create"): ("chat.completions.create", False),
    ("ChatCompletion", "acreate"): ("chat.completions.create", True),
    ("Completion", "create"): ("completions.create", False),
    ("Completion", "acreate"): ("completions.create", True),
    ("Embedding", "create"): ("embeddings.create", False),
    ("Embedding", "acreate"): ("embeddings.create", True),
    ("Moderation", "create"): ("moderations.create", False),
    ("Moderation", "acreate"): ("moderations.create", True),
    ("Image", "create"): ("images.generate", False),
    ("Image", "acreate"): ("images.generate", True),
    ("Audio", "transcribe"): ("audio.transcriptions.create", False),
    ("Audio", "translate"): ("audio.translations.create", False),
}

# Keys of v0 response dicts that become attributes on v1 response objects.
RESPONSE_KEYS = frozenset(
    {
        "choices", "message", "content", "text", "delta", "role", "finish_reason",
        "index", "data", "embedding", "usage", "total_tokens", "prompt_tokens",
        "completion_tokens", "results", "flagged", "categories", "url", "b64_json",
        "id", "model", "created", "tool_calls", "function_call", "arguments", "name",
    }
)

# openai.error.X -> openai.Y
ERRORS = {
    "OpenAIError": "OpenAIError",
    "APIError": "APIError",
    "APIConnectionError": "APIConnectionError",
    "RateLimitError": "RateLimitError",
    "AuthenticationError": "AuthenticationError",
    "PermissionError": "PermissionDeniedError",
    "InvalidRequestError": "BadRequestError",
    "Timeout": "APITimeoutError",
    "ServiceUnavailableError": "InternalServerError",
    "TryAgain": "APIError",
}

KWARG_RENAMES = {"request_timeout": "timeout"}

# module-level settings -> client constructor arguments
SETTINGS = {"api_key": "api_key", "api_base": "base_url", "organization": "organization"}

SYNC_CLIENT = "client"
ASYNC_CLIENT = "async_client"


@dataclass
class Edit:
    line: int
    rule: str
    before: str
    after: str


@dataclass
class Note:
    line: int
    message: str


@dataclass
class Result:
    source: str
    code: str
    edits: list[Edit] = field(default_factory=list)
    notes: list[Note] = field(default_factory=list)

    @property
    def changed(self) -> bool:
        return self.code != self.source


def _code(node: cst.CSTNode) -> str:
    return cst.Module(body=[]).code_for_node(node).strip()


def _chain(node: cst.BaseExpression) -> list[str] | None:
    """openai.ChatCompletion.create -> ["openai", "ChatCompletion", "create"]."""
    parts: list[str] = []
    while isinstance(node, cst.Attribute):
        parts.append(node.attr.value)
        node = node.value
    if isinstance(node, cst.Name):
        parts.append(node.value)
        return parts[::-1]
    return None


def _root(node: cst.BaseExpression) -> str | None:
    while True:
        if isinstance(node, cst.Await):
            node = node.expression
        elif isinstance(node, cst.Call):
            node = node.func
        elif isinstance(node, (cst.Subscript, cst.Attribute)):
            node = node.value
        else:
            break
    return node.value if isinstance(node, cst.Name) else None


def _string_key(node: cst.Subscript) -> str | None:
    if len(node.slice) != 1:
        return None
    sl = node.slice[0].slice
    if isinstance(sl, cst.Index) and isinstance(sl.value, cst.SimpleString):
        return sl.value.evaluated_value  # type: ignore[return-value]
    return None


def _dotted(path: str) -> cst.BaseExpression:
    names = path.split(".")
    expr: cst.BaseExpression = cst.Name(names[0])
    for name in names[1:]:
        expr = cst.Attribute(value=expr, attr=cst.Name(name))
    return expr


class _Collector(cst.CSTVisitor):
    METADATA_DEPENDENCIES = (PositionProvider,)

    def __init__(self) -> None:
        self.aliases: set[str] = set()
        self.local_import: int | None = None  # line of an `import openai` inside a function
        self.tracked: set[str] = set()
        self.settings: dict[str, cst.BaseExpression] = {}
        self.calls = 0
        self.needs_async = False
        self.errors = 0
        self.notes: list[Note] = []
        self._depth = 0

    def _line(self, node: cst.CSTNode) -> int:
        return self.get_metadata(PositionProvider, node).start.line

    def match_call(self, node: cst.BaseExpression) -> tuple[str, bool] | None:
        if isinstance(node, cst.Await):
            node = node.expression
        if not isinstance(node, cst.Call):
            return None
        chain = _chain(node.func)
        if chain and len(chain) == 3 and chain[0] in self.aliases:
            return CALLS.get((chain[1], chain[2]))
        return None

    def is_response(self, node: cst.BaseExpression) -> bool:
        # walk r["choices"][0] / create(...)["results"][0] back to what produced it
        base = node
        while isinstance(base, (cst.Subscript, cst.Attribute)):
            base = base.value
        return self.match_call(base) is not None or _root(node) in self.tracked

    # scope depth, so settings are only moved when they live at module level
    def visit_FunctionDef(self, node: cst.FunctionDef) -> None:
        self._depth += 1

    def leave_FunctionDef(self, node: cst.FunctionDef) -> None:
        self._depth -= 1

    def visit_ClassDef(self, node: cst.ClassDef) -> None:
        self._depth += 1

    def leave_ClassDef(self, node: cst.ClassDef) -> None:
        self._depth -= 1

    def visit_Import(self, node: cst.Import) -> None:
        for alias in node.names:
            if isinstance(alias.name, cst.Name) and alias.name.value == "openai":
                asname = alias.asname.name.value if alias.asname else "openai"  # type: ignore[union-attr]
                self.aliases.add(asname)
                if self._depth and self.local_import is None:
                    self.local_import = self._line(node)

    def visit_ImportFrom(self, node: cst.ImportFrom) -> None:
        if isinstance(node.module, cst.Name) and node.module.value == "openai" and not isinstance(node.names, cst.ImportStar):
            legacy = [a.name.value for a in node.names if isinstance(a.name, cst.Name) and a.name.value in {r for r, _ in CALLS}]
            if legacy:
                self.notes.append(Note(self._line(node), f"`from openai import {', '.join(legacy)}` uses removed v0 names; update by hand."))

    def visit_Assign(self, node: cst.Assign) -> None:
        if self.is_response(node.value):
            for target in node.targets:
                if isinstance(target.target, cst.Name):
                    self.tracked.add(target.target.value)
        if len(node.targets) == 1:
            chain = _chain(node.targets[0].target)  # type: ignore[arg-type]
            if chain and len(chain) == 2 and chain[0] in self.aliases and chain[1] in SETTINGS:
                if self._depth == 0:
                    self.settings[chain[1]] = node.value
                else:
                    self.notes.append(Note(self._line(node), f"`{'.'.join(chain)}` is set inside a function; pass it to the client instead."))

    def visit_For(self, node: cst.For) -> None:
        if self.is_response(node.iter) and isinstance(node.target, cst.Name):
            self.tracked.add(node.target.value)

    def visit_CompFor(self, node: cst.CompFor) -> None:
        if self.is_response(node.iter) and isinstance(node.target, cst.Name):
            self.tracked.add(node.target.value)

    def visit_Call(self, node: cst.Call) -> None:
        match = self.match_call(node)
        if match:
            self.calls += 1
            self.needs_async |= match[1]
            for arg in node.args:
                if arg.keyword and arg.keyword.value == "engine":
                    self.notes.append(Note(self._line(node), "`engine=` is an Azure v0 argument; use `model=` with the AzureOpenAI client."))
        func = node.func
        if isinstance(func, cst.Attribute) and func.attr.value == "get" and _root(func.value) in self.tracked:
            self.notes.append(Note(self._line(node), f"`{_code(node)}` reads a v1 response like a dict; use attribute access."))

    def visit_Attribute(self, node: cst.Attribute) -> None:
        chain = _chain(node)
        if chain and len(chain) == 3 and chain[0] in self.aliases and chain[1] == "error":
            self.errors += 1


class _Rewriter(cst.CSTTransformer):
    METADATA_DEPENDENCIES = (PositionProvider,)

    def __init__(self, info: _Collector) -> None:
        self.info = info
        self.edits: list[Edit] = []
        self._client_placed = False
        self._depth = 0

    def _line(self, node: cst.CSTNode) -> int:
        return self.get_metadata(PositionProvider, node).start.line

    def visit_FunctionDef(self, node: cst.FunctionDef) -> None:
        self._depth += 1

    def leave_FunctionDef(self, original: cst.FunctionDef, updated: cst.FunctionDef) -> cst.FunctionDef:
        self._depth -= 1
        return updated

    def visit_ClassDef(self, node: cst.ClassDef) -> None:
        self._depth += 1

    def leave_ClassDef(self, original: cst.ClassDef, updated: cst.ClassDef) -> cst.ClassDef:
        self._depth -= 1
        return updated

    def leave_Call(self, original: cst.Call, updated: cst.Call) -> cst.Call:
        match = self.info.match_call(original)
        if not match:
            return updated
        path, is_async = match
        client = ASYNC_CLIENT if is_async else SYNC_CLIENT
        args = [
            a.with_changes(keyword=cst.Name(KWARG_RENAMES[a.keyword.value]))
            if a.keyword and a.keyword.value in KWARG_RENAMES
            else a
            for a in updated.args
        ]
        new = updated.with_changes(func=_dotted(f"{client}.{path}"), args=args)
        self.edits.append(Edit(self._line(original), "call moved to client", _code(original.func), _code(new.func)))
        if len(args) and any(a.keyword and a.keyword.value in KWARG_RENAMES for a in updated.args):
            self.edits.append(Edit(self._line(original), "argument renamed", "request_timeout=", "timeout="))
        return new

    def leave_Subscript(self, original: cst.Subscript, updated: cst.Subscript) -> cst.BaseExpression:
        key = _string_key(original)
        if key in RESPONSE_KEYS and self.info.is_response(original.value):
            new = cst.Attribute(value=updated.value, attr=cst.Name(key))
            self.edits.append(Edit(self._line(original), "dict access to attribute", _code(original), _code(new)))
            return new
        return updated

    def leave_Attribute(self, original: cst.Attribute, updated: cst.Attribute) -> cst.BaseExpression:
        chain = _chain(original)
        if chain and len(chain) == 3 and chain[0] in self.info.aliases and chain[1] == "error":
            renamed = ERRORS.get(chain[2], chain[2])
            new = cst.Attribute(value=cst.Name(chain[0]), attr=cst.Name(renamed))
            self.edits.append(Edit(self._line(original), "error class moved", _code(original), _code(new)))
            return new
        return updated

    def _client_lines(self) -> list[cst.SimpleStatementLine]:
        kwargs = [
            cst.Arg(
                keyword=cst.Name(SETTINGS[name]),
                value=value,
                equal=cst.AssignEqual(whitespace_before=cst.SimpleWhitespace(""), whitespace_after=cst.SimpleWhitespace("")),
            )
            for name, value in self.info.settings.items()
        ]
        lines = [cst.parse_statement(f"{SYNC_CLIENT} = OpenAI()")]
        if self.info.needs_async:
            lines.append(cst.parse_statement(f"{ASYNC_CLIENT} = AsyncOpenAI()"))
        out = []
        for line in lines:
            assign = line.body[0]  # type: ignore[union-attr]
            call = assign.value.with_changes(args=kwargs)  # type: ignore[union-attr]
            out.append(line.with_changes(body=[assign.with_changes(value=call)]))  # type: ignore[union-attr]
        return out  # type: ignore[return-value]

    def leave_SimpleStatementLine(self, original: cst.SimpleStatementLine, updated: cst.SimpleStatementLine):
        if self._depth or len(original.body) != 1 or not isinstance(original.body[0], cst.Assign):
            return updated
        assign = original.body[0]
        chain = _chain(assign.targets[0].target) if len(assign.targets) == 1 else None  # type: ignore[arg-type]
        if not (chain and len(chain) == 2 and chain[0] in self.info.aliases and chain[1] in SETTINGS):
            return updated
        self.edits.append(Edit(self._line(original), "setting moved to client", _code(assign), f"{SYNC_CLIENT} = OpenAI({SETTINGS[chain[1]]}=...)"))
        if self._client_placed:
            return cst.RemoveFromParent()
        self._client_placed = True
        lines = self._client_lines()
        lines[0] = lines[0].with_changes(leading_lines=original.leading_lines)
        return cst.FlattenSentinel(lines)

    def leave_Module(self, original: cst.Module, updated: cst.Module) -> cst.Module:
        body = list(updated.body)
        names = "OpenAI, AsyncOpenAI" if self.info.needs_async else "OpenAI"
        import_line = cst.parse_statement(f"from openai import {names}")

        last_import = -1
        for i, stmt in enumerate(body):
            if isinstance(stmt, cst.SimpleStatementLine) and any(isinstance(s, (cst.Import, cst.ImportFrom)) for s in stmt.body):
                last_import = i
        insert = [import_line]
        if not self._client_placed:
            insert += self._client_lines()
            self._client_placed = True
        body[last_import + 1:last_import + 1] = insert

        module = updated.with_changes(body=body)
        if not _alias_still_used(module, self.info.aliases):
            module = _drop_openai_import(module)
        return module


class _AliasUse(cst.CSTVisitor):
    def __init__(self, aliases: set[str]) -> None:
        self.aliases = aliases
        self.used = False

    def visit_Import(self, node: cst.Import) -> bool:
        return False

    def visit_ImportFrom(self, node: cst.ImportFrom) -> bool:
        return False

    def visit_Name(self, node: cst.Name) -> None:
        if node.value in self.aliases:
            self.used = True


def _alias_still_used(module: cst.Module, aliases: set[str]) -> bool:
    visitor = _AliasUse(aliases)
    module.visit(visitor)
    return visitor.used


def _drop_openai_import(module: cst.Module) -> cst.Module:
    body = []
    for stmt in module.body:
        if (
            isinstance(stmt, cst.SimpleStatementLine)
            and len(stmt.body) == 1
            and isinstance(stmt.body[0], cst.Import)
            and all(isinstance(a.name, cst.Name) and a.name.value == "openai" for a in stmt.body[0].names)
        ):
            continue
        body.append(stmt)
    return module.with_changes(body=body)


def migrate(source: str) -> Result:
    """Rewrite one Python file. Returns the new code, the edits made and anything left for a human."""
    try:
        wrapper = MetadataWrapper(cst.parse_module(source))
    except cst.ParserSyntaxError as exc:
        return Result(source, source, notes=[Note(getattr(exc, "raw_line", 0), f"could not parse: {exc.message}")])

    info = _Collector()
    wrapper.visit(info)
    if not info.aliases or (info.calls == 0 and info.errors == 0 and not info.settings):
        return Result(source, source, notes=info.notes)
    if info.local_import is not None:
        # A client hoisted to module level would run before the function that configures it.
        note = Note(info.local_import, "`openai` is imported inside a function, so where the client should live is a design choice; migrate this file by hand.")
        return Result(source, source, notes=info.notes + [note])

    rewriter = _Rewriter(info)
    module = wrapper.visit(rewriter)
    edits = _dedupe(rewriter.edits)
    return Result(source, module.code, edits=edits, notes=info.notes)


def _dedupe(edits: list[Edit]) -> list[Edit]:
    """A chain like r["choices"][0]["message"] yields one edit per key; keep the outermost."""
    kept: list[Edit] = []
    for edit in sorted(edits, key=lambda e: (e.line, -len(e.before))):
        if any(k.line == edit.line and k.rule == edit.rule and edit.before in k.before for k in kept):
            continue
        kept.append(edit)
    return kept
