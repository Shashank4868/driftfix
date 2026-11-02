# Driftfix

**APIs change. Your code gets a pull request.**

Driftfix reads an API provider's breaking change, finds every affected call in a codebase, rewrites it, proves the fix with the repo's own tests, and writes a pull request that explains each edit. If verification fails, it rolls the patch back and opens nothing.

[Website and live playground](https://shashank4868.github.io/driftfix/) · [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md)

```
$ driftfix run .

  ▸ Change           OpenAI Python SDK 0.x -> >=1.0
  ▸ Scan             3 Python files, 1 affected, 8 edits
  ▸ Tests before     3 failed  APIRemovedInV1: v0 call removed in openai>=1.0
  ▸ Patch            app.py  +8 -7
  ▸ Verify           checked 1 file(s), tests 3 passed
  ▸ Commit           d0d3c0f on driftfix/openai-python-v1
  ▸ Pull request     ready  DRIFTFIX_PR.md

  Done in 2.3s. 8 edits, verified.
```

## Supported changes

| Change id | Migration | Languages | What it rewrites |
|---|---|---|---|
| `openai-python-v1` | OpenAI Python SDK 0.x -> 1.x | Python | module calls -> client (sync and async), settings into the client, dict access -> attributes, `openai.error.*`, `request_timeout`, aliased imports, dependency pins |
| `openai-node-v4` | OpenAI Node SDK 3.x -> 4.x | JavaScript, TypeScript | imports and `require`, `Configuration` folded into `new OpenAI()`, `createChatCompletion` and friends -> resources, `.data` unwrapping, `OpenAIApi` types, `package.json` + lockfile |

`driftfix changes` prints the list with release dates and changelog links. Anything a rule can't rewrite safely (streaming, Azure's `engine=`, axios request options, error shapes, `openai` imported inside a function) is left as it is and listed under **Needs a human look** in the pull request.

## Install

```bash
pip install git+https://github.com/Shashank4868/driftfix
```

## Use

```bash
driftfix scan path/to/repo              # list affected lines, edit nothing (exit 1 if any)
driftfix scan path/to/repo --markdown   # the same, as a Markdown report
driftfix run path/to/repo               # fix, verify, commit to a branch, write the PR description
driftfix run path/to/repo --open-pr     # also push the branch and open the PR with the GitHub CLI
```

Useful `run` options: `--change <id>` to pick a migration, `--skip-tests` to verify by syntax checks only, `--no-deps` to leave pins alone, `--python <exe>` to choose the interpreter for the repo's tests, `--json` for CI.

## GitHub Action

Report affected code on every pull request:

```yaml
- uses: actions/checkout@v4
- uses: Shashank4868/driftfix@main
  with:
    fail-on-findings: true
```

Or let it open the fix itself on a schedule (needs `contents: write` and `pull-requests: write`):

```yaml
on:
  schedule: [{ cron: "0 6 * * 1" }]
jobs:
  driftfix:
    runs-on: ubuntu-latest
    permissions: { contents: write, pull-requests: write }
    steps:
      - uses: actions/checkout@v4
      - uses: Shashank4868/driftfix@main
        with:
          mode: fix
```

## How it works

| Stage | What happens | Code |
|---|---|---|
| Change map | Each provider change is an entry with versions, dates, changelog link and rules | [`changes.py`](src/driftfix/changes.py) |
| Rewrite | Python: a two-pass codemod on the concrete syntax tree (libcst), so comments and formatting survive. JS/TS: rules over a masked copy of the source, so strings and comments are never touched | [`rules/`](src/driftfix/rules) |
| Dependencies | Raises pins that exclude the new major and refreshes the npm, pnpm or yarn lockfile | [`deps.py`](src/driftfix/deps.py) |
| Verify | Syntax-checks every changed file, runs the repo's tests before and after, rolls back on regression | [`verify.py`](src/driftfix/verify.py) |
| Pull request | Edit table, dependency changes, before/after test results, changelog link, items for a human | [`report.py`](src/driftfix/report.py) |

## Tried on real repositories

Driftfix's output was reviewed by hand on open-source projects that still call removed SDK APIs, and offered upstream as pull requests. Each was checked against the current SDK (`mypy` for Python, `tsc` for TypeScript) before opening. See [the list of pull requests](https://github.com/pulls?q=is%3Apr+author%3AShashank4868+driftfix) and their status.

Reviewing those diffs found real bugs in Driftfix (quote styles, re-indentation, `OpenAIApi` used as a type, function-local imports), and each one is now a regression test.

## Development

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"     # macOS/Linux: .venv/bin/python
.venv/Scripts/python -m pytest -q                   # rule tests
.venv/Scripts/python tests/parity.py                # browser engine == Python engine (needs node)
```

`site/` is the website. Its playground runs `site/engine.js`, a browser port of the rules, entirely in the page. For a screen recording of the CLI, run `demo.ps1` in PowerShell.

## Roadmap

Stripe API version upgrades, Google Ads API version sunsets, and Twilio, Slack and Shopify deprecations. [Open an issue](https://github.com/Shashank4868/driftfix/issues/new) to ask for a migration.

## License

[MIT](LICENSE)
