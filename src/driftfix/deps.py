"""Raise dependency pins that would keep a project on the old SDK after its code is migrated.

Only pins that exclude the new major are touched (e.g. `openai==0.28.1`,
`"openai": "^3.3.0"`); unpinned or already-compatible entries are left alone.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class DepChange:
    path: Path
    before: str
    after: str
    old_spec: str
    new_spec: str


PY_FILES = ("pyproject.toml", "setup.py", "setup.cfg", "Pipfile")
# requirements.txt, requirements-dev.txt, requirements/prod.txt, and misspellings like requirementx.txt
PY_REQ_GLOBS = ("requirement*.txt", "requirements/*.txt", "*requirements*.txt")


def _python_dep_files(root: Path) -> list[Path]:
    found = {root / n for n in PY_FILES if (root / n).exists()}
    for pattern in PY_REQ_GLOBS:
        found.update(p for p in root.glob(pattern) if p.is_file())
    return sorted(found)
PY_TARGET = "openai>=1.0"
NODE_TARGET = "^4.104.0"

# openai==0.28.1, openai<1, openai~=0.27, openai===0.27.10, openai<=0.28
_PY_PIN = re.compile(r"(?P<name>\bopenai(?:\[[^\]]*\])?)\s*(?P<spec>(?:===?|~=|<=?)\s*0(?:\.[\w*]+)*(?:\s*,\s*[<>=!~]=?\s*[\w.*]+)*|<\s*1(?:\.0)*)")


def python_pins(root: Path) -> list[DepChange]:
    changes = []
    for path in _python_dep_files(root):
        text = path.read_text(encoding="utf-8")
        new, specs = text, []
        for hit in reversed(list(_PY_PIN.finditer(text))):
            line_start = text.rfind("\n", 0, hit.start()) + 1
            if text[line_start:hit.start()].lstrip().startswith("#"):
                continue
            specs.append(hit.group("spec").strip())
            replacement = hit.group("name") + PY_TARGET[len("openai"):]
            if path.suffix == ".toml" and re.search(r"openai\s*=", text[line_start:hit.end()]):
                continue
            new = new[:hit.start()] + replacement + new[hit.end():]
        # poetry style: openai = "^0.27"
        if path.name == "pyproject.toml":
            def poetry(m: re.Match) -> str:
                specs.append(m.group(2))
                return f'{m.group(1)}">=1.0"'
            new = re.sub(r'(^\s*openai\s*=\s*)"([\^~<=]*0[\w.*]*)"', poetry, new, flags=re.M)
        if new != text:
            changes.append(DepChange(path, text, new, ", ".join(sorted(set(specs))), PY_TARGET))
    return changes


def node_pins(root: Path) -> list[DepChange]:
    path = root / "package.json"
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    try:
        data = json.loads(text)
    except ValueError:
        return []
    old = None
    for section in ("dependencies", "devDependencies", "peerDependencies"):
        spec = (data.get(section) or {}).get("openai")
        if spec and re.match(r"^[\^~=<>v ]*[0-3](\.|$)", spec):
            old = spec
    if not old:
        return []
    # edit the text, not the parsed JSON, so key order and formatting stay intact
    new = re.sub(r'("openai"\s*:\s*")' + re.escape(old) + '"', lambda m: m.group(1) + NODE_TARGET + '"', text)
    return [DepChange(path, text, new, old, NODE_TARGET)] if new != text else []


def plan_deps(root: Path, language: str) -> list[DepChange]:
    return python_pins(root) if language == "Python" else node_pins(root)


# lockfile -> command that rewrites it without installing or running scripts
LOCKFILES = (
    ("package-lock.json", ["npm", "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"]),
    ("pnpm-lock.yaml", ["pnpm", "install", "--lockfile-only", "--ignore-scripts"]),
    ("yarn.lock", ["yarn", "install", "--mode", "update-lockfile"]),
)


def refresh_lockfile(root: Path) -> tuple[Path | None, str | None, str]:
    """Returns (lockfile, its previous text, note for the PR). The caller restores the text on rollback."""
    import shutil
    import subprocess

    for name, cmd in LOCKFILES:
        lock = root / name
        if not lock.exists():
            continue
        exe = shutil.which(cmd[0])
        if not exe:
            return None, None, f"Run `{cmd[0]} install` to refresh `{name}`."
        previous = lock.read_text(encoding="utf-8")
        proc = subprocess.run([exe] + cmd[1:], cwd=root, capture_output=True, text=True)
        if proc.returncode or lock.read_text(encoding="utf-8") == previous:
            lock.write_text(previous, encoding="utf-8", newline="")
            return None, None, f"Run `{cmd[0]} install` to refresh `{name}`."
        return lock, previous, f"`{name}` refreshed with `{' '.join(cmd)}`."
    return None, None, ""
