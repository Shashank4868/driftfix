"""Proves a patch works before anyone sees it: check every changed file, then run the repo's own tests."""

from __future__ import annotations

import json
import py_compile
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass
class TestRun:
    ran: bool
    passed: int = 0
    failed: int = 0
    errors: int = 0
    seconds: float = 0.0
    reason: str = ""
    output: str = ""
    runner: str = ""

    @property
    def ok(self) -> bool:
        return self.ran and self.failed == 0 and self.errors == 0 and (self.passed > 0 or self.runner == "npm")

    def summary(self) -> str:
        if not self.ran:
            return self.reason or "no tests found"
        parts = []
        if self.passed:
            parts.append(f"{self.passed} passed")
        if self.failed:
            parts.append(f"{self.failed} failed")
        if self.errors:
            parts.append(f"{self.errors} errors")
        if not parts:
            return "passed" if self.ok else "failed"
        return ", ".join(parts)

    def as_dict(self) -> dict:
        return {"ran": self.ran, "runner": self.runner, "passed": self.passed, "failed": self.failed,
                "errors": self.errors, "ok": self.ok, "summary": self.summary(), "reason": self.reason,
                "seconds": round(self.seconds, 2)}


KNOWN_FAILURES = [
    ("APIRemovedInV1", "APIRemovedInV1: v0 call removed in openai>=1.0"),
    ("has no attribute 'error'", "openai.error no longer exists"),
    ("is not a constructor", "v3 class removed in openai>=4"),
    ("ModuleNotFoundError", "missing module"),
]


def find_python(repo: Path, override: str | None = None) -> str:
    """The interpreter that runs the repo's tests: an explicit choice, the repo's own venv, then ours."""
    if override:
        return override
    for venv in (".venv", "venv", "env"):
        for exe in ("Scripts/python.exe", "bin/python"):
            candidate = repo / venv / exe
            if candidate.exists():
                return str(candidate)
    for exe in ("Scripts/python.exe", "bin/python"):
        candidate = Path(sys.prefix) / exe
        if candidate.exists():
            return str(candidate)
    return sys.executable


def has_python_tests(repo: Path) -> bool:
    return any(repo.glob("test_*.py")) or any(repo.glob("tests/**/test_*.py")) or any(repo.glob("**/*_test.py"))


def npm_test_script(repo: Path) -> str | None:
    pkg = repo / "package.json"
    if not pkg.exists():
        return None
    try:
        script = (json.loads(pkg.read_text(encoding="utf-8")).get("scripts") or {}).get("test", "")
    except (ValueError, OSError):
        return None
    if not script or "no test specified" in script:
        return None
    return script


def run_tests(repo: Path, language: str = "Python", python: str | None = None, timeout: int = 900) -> TestRun:
    if language != "Python":
        return _run_npm(repo, timeout)
    if not has_python_tests(repo):
        return TestRun(ran=False, reason="no tests found")
    python = find_python(repo, python)
    start = time.perf_counter()
    proc = subprocess.run([python, "-m", "pytest", "-q", "-p", "no:cacheprovider", "--no-header"],
                          cwd=repo, capture_output=True, text=True, timeout=timeout)
    out = proc.stdout + proc.stderr
    run = TestRun(ran=True, seconds=time.perf_counter() - start, output=out, runner="pytest")
    tail = out.strip().splitlines()[-1] if out.strip() else ""
    for label, attr in (("passed", "passed"), ("failed", "failed"), ("error", "errors")):
        match = re.search(rf"(\d+) {label}", tail)
        if match:
            setattr(run, attr, int(match.group(1)))
    _reason(run, out)
    return run


def _run_npm(repo: Path, timeout: int) -> TestRun:
    if not npm_test_script(repo):
        return TestRun(ran=False, reason="no test script in package.json")
    if not (repo / "node_modules").exists():
        return TestRun(ran=False, reason="dependencies not installed (run npm install to enable tests)")
    npm = shutil.which("npm")
    if not npm:
        return TestRun(ran=False, reason="npm not found")
    start = time.perf_counter()
    proc = subprocess.run([npm, "test", "--silent"], cwd=repo, capture_output=True, text=True, timeout=timeout)
    out = proc.stdout + proc.stderr
    run = TestRun(ran=True, seconds=time.perf_counter() - start, output=out, runner="npm")
    if proc.returncode:
        run.failed = 1
    _reason(run, out)
    return run


def _reason(run: TestRun, out: str) -> None:
    for needle, reason in KNOWN_FAILURES:
        if needle in out:
            run.reason = reason
            break


def check_files(paths: list[Path]) -> list[str]:
    """Syntax-check changed files: Python compiles, JavaScript passes `node --check`, TypeScript balances."""
    problems = []
    node = shutil.which("node")
    for path in paths:
        suffix = path.suffix.lower()
        if suffix == ".py":
            try:
                py_compile.compile(str(path), doraise=True)
            except py_compile.PyCompileError as exc:
                problems.append(f"{path.name}: {exc.msg}")
        elif suffix in (".js", ".mjs", ".cjs") and node:
            proc = subprocess.run([node, "--check", str(path)], capture_output=True, text=True)
            if proc.returncode:
                problems.append(f"{path.name}: {proc.stderr.strip().splitlines()[-1] if proc.stderr.strip() else 'syntax error'}")
        elif suffix in (".ts", ".tsx", ".mts", ".cts", ".jsx", ".js", ".mjs", ".cjs"):
            from driftfix.rules.openai_node_v4 import mask
            if not _balanced(mask(path.read_text(encoding="utf-8"))):
                problems.append(f"{path.name}: brackets do not balance")
    return problems


def _balanced(masked: str) -> bool:
    pairs = {")": "(", "]": "[", "}": "{"}
    stack: list[str] = []
    for ch in masked:
        if ch in "([{":
            stack.append(ch)
        elif ch in pairs:
            if not stack or stack.pop() != pairs[ch]:
                return False
    return not stack
