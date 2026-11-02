# Changelog

## 0.2.0 (2026-11-03)

- New change: **OpenAI Node.js SDK 3.x -> 4.x** (`openai-node-v4`) for JavaScript and TypeScript. Rewrites imports and `require`, folds `Configuration` into `new OpenAI({...})`, moves `createChatCompletion` and friends to their resources, unwraps `.data`, renames leftover `OpenAIApi` types, and flags streaming, axios options and error-shape changes for a human.
- Dependency pins are raised with the code: `requirements*.txt` (including misspelled names), `pyproject.toml` (PEP 621 and Poetry), `setup.py`, `setup.cfg`, `Pipfile`, and `package.json`.
- Lockfiles are refreshed after a pin change with npm, pnpm or yarn when available, and restored on rollback.
- Imports keep the file's own quote and semicolon style; unwrapped constructors are re-indented.
- Files that import `openai` inside a function are now left for a human instead of having a client hoisted to module level.
- `driftfix run` lists flagged items even when there is nothing safe to change; `--json` reports `needs_human`.
- `scan --json`, `changes --json` and a reusable GitHub Action (`action.yml`).

## 0.1.0 (2026-10-21)

- First release: OpenAI Python SDK 0.x -> 1.x (`openai-python-v1`) with libcst rules, before/after test runs, rollback on regression, branch + commit, and a pull request description.
- Browser port of the Python rules for the website playground, kept identical by `tests/parity.py`.
