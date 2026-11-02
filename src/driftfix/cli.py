"""driftfix: find code broken by an API change, fix it, prove the fix, write the pull request.

  driftfix changes            list the breaking changes Driftfix can migrate
  driftfix scan [PATH]        show affected lines without editing (exit 1 if any)
  driftfix run [PATH]         fix, verify with the repo's tests, commit, write the PR
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from driftfix import __version__
from driftfix.changes import REGISTRY, Change
from driftfix.deps import plan_deps, refresh_lockfile
from driftfix.report import FilePatch, pull_request
from driftfix.rules import RULES
from driftfix.verify import TestRun, check_files, run_tests

SKIP_DIRS = {".git", ".venv", "venv", "env", "node_modules", "__pycache__", "site-packages", "build", "dist",
             ".tox", ".mypy_cache", ".next", "out", "coverage", ".turbo", "vendor"}

for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass

COLOR = sys.stdout.isatty() and "NO_COLOR" not in os.environ


def _c(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if COLOR else text


dim = lambda t: _c("2", t)  # noqa: E731
bold = lambda t: _c("1", t)  # noqa: E731
green = lambda t: _c("32", t)  # noqa: E731
red = lambda t: _c("31", t)  # noqa: E731
amber = lambda t: _c("33", t)  # noqa: E731


def step(label: str, value: str) -> None:
    print(f"  {amber('▸')} {label:<16} {value}")


def read(path: Path) -> str:
    # newline="" keeps the file's own line endings, so untouched lines stay byte-identical
    with open(path, encoding="utf-8", newline="") as f:
        return f.read()


def write(path: Path, text: str) -> None:
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def source_files(root: Path, change: Change):
    for path in sorted(root.rglob("*")):
        if path.suffix.lower() in change.extensions and path.is_file():
            if not any(part in SKIP_DIRS for part in path.relative_to(root).parts):
                yield path


def plan(root: Path, change: Change) -> tuple[list[Path], list[FilePatch]]:
    migrate = RULES[change.id]
    files, patches = [], []
    for path in source_files(root, change):
        files.append(path)
        try:
            source = read(path)
        except (UnicodeDecodeError, OSError):
            continue
        if change.marker not in source:
            continue
        result = migrate(source)
        if result.changed or result.notes:
            after = result.code
            if "\r\n" in source and "\r\n" not in after:
                after = after.replace("\n", "\r\n")
            if after == source.replace("\r\n", "\n") or after == source:
                after = source
            patches.append(FilePatch(path, source, after, result.edits, result.notes))
    return files, patches


def pick_changes(root: Path, wanted: str) -> list[tuple[Change, list[Path], list[FilePatch]]]:
    ids = list(REGISTRY) if wanted == "auto" else [wanted]
    out = []
    for cid in ids:
        files, patches = plan(root, REGISTRY[cid])
        if wanted != "auto" or patches:
            out.append((REGISTRY[cid], files, patches))
    return out


def _rel(root: Path, p: Path) -> str:
    return p.relative_to(root).as_posix()


def cmd_changes(args: argparse.Namespace) -> int:
    if args.json:
        print(json.dumps([{"id": c.id, "provider": c.provider, "from": c.from_version, "to": c.to_version,
                           "released": c.released, "language": c.language, "changelog": c.changelog_url} for c in REGISTRY.values()], indent=2))
        return 0
    print(f"\n{bold('driftfix')} {dim(__version__)}  change map\n")
    for c in REGISTRY.values():
        print(f"  {bold(c.id):<22} {c.provider} {c.from_version} -> {c.to_version}  {dim(c.language + ', released ' + c.released)}")
        print(f"  {'':<22} {dim(c.changelog_url)}")
    print()
    return 0


def cmd_scan(args: argparse.Namespace) -> int:
    root = Path(args.path).resolve()
    found = pick_changes(root, args.change)
    total = sum(len(p.edits) for _, _, patches in found for p in patches)
    if args.json:
        print(json.dumps({"version": __version__, "path": str(root), "edits": total, "changes": [
            {"id": c.id, "provider": c.provider, "files_scanned": len(files), "files": [
                {"path": _rel(root, p.path), "edits": [e.__dict__ for e in p.edits], "notes": [n.__dict__ for n in p.notes]}
                for p in patches]} for c, files, patches in found]}, indent=2))
        return 1 if total else 0
    if args.markdown:
        print(_scan_markdown(root, found, total))
        return 1 if total else 0
    print(f"\n{bold('driftfix')} {dim(__version__)}  {dim(str(root))}\n")
    if not total and not any(p.notes for _, _, ps in found for p in ps):
        print(green("  No code affected by a known breaking change.\n"))
        return 0
    for change, files, patches in found:
        if not patches:
            continue
        print(f"  {bold(change.provider)} {change.from_version} -> {change.to_version}  {dim(f'{len(files)} files scanned')}\n")
        for patch in patches:
            print(f"  {bold(_rel(root, patch.path))}")
            for e in patch.edits:
                print(f"    {dim(f'L{e.line:<4}')} {e.before}  {dim('->')}  {green(e.after)}")
            for n in patch.notes:
                print(f"    {dim(f'L{n.line:<4}')} {amber('review')} {n.message}")
        print()
    if total:
        print(f"  {total} edits. Run `driftfix run {args.path}` to fix and verify.\n")
    else:
        print("  No safe mechanical edits here; the items marked review need a person.\n")
    return 1 if total else 0


def _scan_markdown(root: Path, found, total: int) -> str:
    """The job summary the GitHub Action writes: one table per change."""
    notes = sum(len(p.notes) for _, _, ps in found for p in ps)
    if not total and not notes:
        return "### Driftfix\n\nNo code affected by a known breaking change.\n"
    out = [f"### Driftfix: {total} edit{'s' if total != 1 else ''} ready, {notes} item{'s' if notes != 1 else ''} for review", ""]
    for change, files, patches in found:
        if not patches:
            continue
        out += [f"**{change.provider} {change.from_version} -> {change.to_version}** ({len(files)} files scanned, [changelog]({change.changelog_url}))", "",
                "| File | Line | | Change |", "|---|---|---|---|"]
        for patch in patches:
            name = _rel(root, patch.path)
            for e in patch.edits:
                out.append(f"| `{name}` | {e.line} | fix | `{e.before}` -> `{e.after}` |".replace("\n", " "))
            for n in patch.notes:
                out.append(f"| `{name}` | {n.line} | review | {n.message} |")
        out.append("")
    if total:
        out.append("Run `driftfix run` locally, or `driftfix run --open-pr` in a workflow, to apply and verify these edits.")
    return "\n".join(out) + "\n"


def _git(root: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True)


def cmd_run(args: argparse.Namespace) -> int:
    root = Path(args.path).resolve()
    started = time.perf_counter()
    found = [x for x in pick_changes(root, args.change) if any(p.before != p.after for p in x[2])]
    quiet = args.json
    if not quiet:
        print(f"\n{bold('driftfix')} {dim(__version__)}  {dim(root.name)}\n")
    if not found:
        flagged = [(p, n) for _, _, ps in pick_changes(root, args.change) for p in ps for n in p.notes]
        if quiet:
            print(json.dumps({"status": "needs_human" if flagged else "clean",
                              "notes": [{"file": _rel(root, p.path), "line": n.line, "message": n.message} for p, n in flagged]}))
        elif flagged:
            print(amber("  Nothing Driftfix can change safely. Needs a human look:\n"))
            for p, n in flagged:
                print(f"    {_rel(root, p.path)}:{n.line}  {n.message}")
            print()
        else:
            print(green("  Nothing to migrate.\n"))
        return 0
    change, files, patches = found[0]
    others = [c.id for c, _, _ in found[1:]]
    edits = sum(len(p.edits) for p in patches)
    report: dict = {"change": change.id, "edits": edits, "files": [_rel(root, p.path) for p in patches]}

    if not quiet:
        step("Change", f"{change.provider} {change.from_version} -> {change.to_version}  {dim('(' + change.changelog_url + ')')}")
        step("Scan", f"{len(files)} {change.language} files, {len(patches)} affected, {edits} edits")

    before = TestRun(ran=False, reason="skipped")
    if not args.skip_tests:
        before = run_tests(root, change.language, args.python)
        if not quiet:
            status = green(before.summary()) if before.ok else (red(before.summary()) if before.ran else dim(before.summary()))
            reason = f"  {dim(before.reason)}" if before.reason and not before.ok and before.ran else ""
            step("Tests before", f"{status}{reason}")

    for patch in patches:
        if patch.before == patch.after:
            continue
        write(patch.path, patch.after)
        added, removed = patch.stats()
        if not quiet:
            step("Patch", f"{_rel(root, patch.path)}  {green(f'+{added}')} {red(f'-{removed}')}")

    deps = [] if args.no_deps else plan_deps(root, change.language)
    lock_note = ""
    for d in deps:
        write(d.path, d.after)
        if not quiet:
            step("Dependency", f"{_rel(root, d.path)}  openai {red(d.old_spec)} -> {green(d.new_spec)}")
    lockfile = lock_before = None
    if deps and change.language != "Python":
        lockfile, lock_before, lock_note = refresh_lockfile(root)
        if lock_note and not quiet:
            step("Lockfile", lock_note)

    changed = [p.path for p in patches if p.before != p.after]
    problems = check_files(changed)
    after = TestRun(ran=False, reason="skipped")
    if not problems and not args.skip_tests:
        after = run_tests(root, change.language, args.python)
    # A suite that was already failing for unrelated reasons must not get worse.
    regressed = after.ran and not after.ok and (before.ok or (before.ran and after.failed + after.errors > before.failed + before.errors))
    verified = not problems and not regressed
    if not quiet:
        if problems:
            step("Verify", red("syntax check failed: " + "; ".join(problems)))
        else:
            tests = green(after.summary()) if after.ok else (red(after.summary()) if after.ran else dim(after.summary()))
            step("Verify", f"checked {len(changed)} file(s), tests {tests}")

    report.update({"tests_before": before.as_dict(), "tests_after": after.as_dict(), "problems": problems})
    if not verified:
        for patch in patches:
            write(patch.path, patch.before)
        for d in deps:
            write(d.path, d.before)
        if lockfile:
            write(lockfile, lock_before)
        report["status"] = "rolled_back"
        if quiet:
            print(json.dumps(report, indent=2))
        else:
            print(red("\n  Patch rolled back. No pull request opened, because the fix did not pass verification.\n"))
            if after.output:
                print(dim(after.output[-2000:]))
        return 1

    body = pull_request(change, root, patches, before, after, len(changed), deps, lock_note)
    report["dependencies"] = [{"file": _rel(root, d.path), "from": d.old_spec, "to": d.new_spec} for d in deps]
    pr_path = Path(args.pr_out).resolve() if args.pr_out else root / "DRIFTFIX_PR.md"
    write(pr_path, body)
    report.update({"status": "verified", "pr_body": str(pr_path)})

    if (root / ".git").exists() and not args.no_branch:
        branch = args.branch or change.branch
        _git(root, "checkout", "-q", "-B", branch)
        for p in changed + [d.path for d in deps] + ([lockfile] if lockfile else []):
            _git(root, "add", str(p.relative_to(root)))
        commit = _git(root, "commit", "-q", "-m", change.title, "-m", f"Changelog: {change.changelog_url}\n\nGenerated by Driftfix ({change.id}); verified before commit.")
        sha = _git(root, "rev-parse", "--short", "HEAD").stdout.strip()
        report.update({"branch": branch, "commit": sha if commit.returncode == 0 else None})
        if not quiet:
            step("Commit", f"{sha} on {branch}" if commit.returncode == 0 else dim("nothing to commit"))
        if args.open_pr and shutil.which("gh"):
            _git(root, "push", "-q", "-u", "origin", branch)
            pr = subprocess.run(["gh", "pr", "create", "--title", change.title, "--body-file", str(pr_path)], cwd=root, capture_output=True, text=True)
            report["pr_url"] = pr.stdout.strip() or None
            if not quiet:
                step("Pull request", pr.stdout.strip() or red(pr.stderr.strip()))
        elif not quiet:
            shown = str(pr_path.relative_to(root)) if pr_path.is_relative_to(root) else str(pr_path)
            step("Pull request", f"ready  {dim(shown)}")
    elif not quiet:
        step("Pull request", f"description written to {pr_path}")

    notes = sum(len(p.notes) for p in patches)
    report["notes"] = notes
    if quiet:
        print(json.dumps(report, indent=2))
        return 0
    if notes:
        step("Review", amber(f"{notes} item(s) flagged for a human in the PR"))
    if others:
        step("Also found", ", ".join(others) + dim("  (run again with --change <id>)"))
    print(f"\n  {green('Done')} in {time.perf_counter() - started:.1f}s. {edits} edits, verified.\n")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="driftfix", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command", required=True)
    choices = ["auto", *sorted(REGISTRY)]

    ch = sub.add_parser("changes", help="list the breaking changes Driftfix can migrate")
    ch.add_argument("--json", action="store_true")
    ch.set_defaults(func=cmd_changes)

    scan = sub.add_parser("scan", help="list code affected by a breaking change, without editing")
    scan.add_argument("path", nargs="?", default=".")
    scan.add_argument("--change", default="auto", choices=choices)
    scan.add_argument("--json", action="store_true", help="machine-readable output for CI")
    scan.add_argument("--markdown", action="store_true", help="a Markdown report, e.g. for a CI job summary")
    scan.set_defaults(func=cmd_scan)

    run = sub.add_parser("run", help="fix, verify with the repo's tests, commit, and write the pull request")
    run.add_argument("path", nargs="?", default=".")
    run.add_argument("--change", default="auto", choices=choices)
    run.add_argument("--skip-tests", action="store_true", help="verify by syntax checks only")
    run.add_argument("--no-branch", action="store_true", help="edit files in place without a git branch")
    run.add_argument("--branch", help="branch name (default: driftfix/<change>)")
    run.add_argument("--open-pr", action="store_true", help="push the branch and open the PR with the GitHub CLI")
    run.add_argument("--pr-out", help="where to write the PR description")
    run.add_argument("--no-deps", action="store_true", help="leave dependency pins unchanged")
    run.add_argument("--python", help="interpreter for the repo's tests (default: the repo's .venv, else this one)")
    run.add_argument("--json", action="store_true", help="machine-readable output for CI")
    run.set_defaults(func=cmd_run)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
