"""Writes the pull request a maintainer reads: what changed, why, and proof it works."""

from __future__ import annotations

import difflib
from dataclasses import dataclass
from pathlib import Path

from driftfix.changes import Change
from driftfix.rules.openai_v1 import Edit, Note
from driftfix.verify import TestRun


@dataclass
class FilePatch:
    path: Path
    before: str
    after: str
    edits: list[Edit]
    notes: list[Note]

    def diff(self, root: Path) -> str:
        name = self.path.relative_to(root).as_posix()
        return "".join(
            difflib.unified_diff(
                self.before.splitlines(keepends=True),
                self.after.splitlines(keepends=True),
                fromfile=f"a/{name}",
                tofile=f"b/{name}",
            )
        )

    def stats(self) -> tuple[int, int]:
        added = removed = 0
        for line in difflib.unified_diff(self.before.splitlines(), self.after.splitlines(), lineterm=""):
            if line.startswith("+") and not line.startswith("+++"):
                added += 1
            elif line.startswith("-") and not line.startswith("---"):
                removed += 1
        return added, removed


def pull_request(change: Change, root: Path, patches: list[FilePatch], before: TestRun, after: TestRun, compiled: int, deps=None, lock_note: str = "") -> str:
    edits = sum(len(p.edits) for p in patches)
    lines = [
        f"# {change.title}",
        "",
        change.summary,
        "",
        f"Changelog: {change.changelog_url}",
        "",
        f"## What changed ({edits} edits in {len(patches)} file{'s' if len(patches) != 1 else ''})",
        "",
        "| File | Line | Change | Before | After |",
        "|---|---|---|---|---|",
    ]
    for patch in patches:
        name = patch.path.relative_to(root).as_posix()
        for e in patch.edits:
            lines.append(f"| `{name}` | {e.line} | {e.rule} | `{_cell(e.before)}` | `{_cell(e.after)}` |")

    if deps:
        lines += ["", "## Dependencies", ""]
        for d in deps:
            lines.append(f"- `{d.path.relative_to(root).as_posix()}`: openai `{d.old_spec}` -> `{d.new_spec}`")
        if lock_note:
            lines.append(f"- {lock_note}")

    lines += ["", "## Verification", ""]
    lines.append(f"- Syntax-checked {compiled} changed file{'s' if compiled != 1 else ''} without errors.")
    if before.ran:
        why = f" ({before.reason})" if before.reason and not before.ok else ""
        lines.append(f"- Tests before this change: {before.summary()}{why}.")
    if after.ran:
        lines.append(f"- Tests after this change: {after.summary()}.")
    else:
        lines.append("- No test suite ran for this repository, so the change was verified by syntax checks and a re-scan only. Please run the app once before merging.")

    notes = [(p, n) for p in patches for n in p.notes]
    if notes:
        lines += ["", "## Needs a human look", ""]
        for patch, note in notes:
            lines.append(f"- `{patch.path.relative_to(root).as_posix()}` line {note.line}: {note.message}")

    lines += [
        "",
        "---",
        f"Prepared with [Driftfix](https://github.com/Shashank4868/driftfix) ({change.id}). Every edit above is mechanical and reviewable. Happy to adjust anything.",
    ]
    return "\n".join(lines) + "\n"


def _cell(text: str) -> str:
    text = " ".join(text.split())
    return (text[:70] + "...") if len(text) > 73 else text.replace("|", "\\|")
