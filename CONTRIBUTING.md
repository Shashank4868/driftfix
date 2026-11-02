# Contributing

Thanks for helping. The most useful contribution is a new **change**: one provider's breaking release, written as rules that are safe to apply without a human.

## Setup

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"    # macOS/Linux: .venv/bin/python
.venv/Scripts/python -m pytest -q
.venv/Scripts/python tests/parity.py    # browser engine == Python engine, needs node
```

## Adding a change

1. **Describe it** in `src/driftfix/changes.py`: id, provider, versions, release date, changelog URL, branch name, language, file extensions, and a cheap `marker` string used to skip files that can't be affected.
2. **Write the rules** in `src/driftfix/rules/<id>.py`, exposing `migrate(source: str) -> Result`. Register it in `src/driftfix/rules/__init__.py`.
3. **Pin bumps** go in `src/driftfix/deps.py` if the change needs a new major version.
4. **Tests** in `tests/test_<id>.py`. Every rule needs a test, and so does every pattern you decided *not* to rewrite.

## The bar for a rule

- **Precision over recall.** If a rewrite could be wrong, don't make it. Add a `Note` instead; it shows up under "Needs a human look" in the pull request.
- **Leave formatting alone.** Keep the file's quotes, semicolons, indentation and line endings.
- **Strings and comments are not code.** Python rules work on the libcst tree; JS/TS rules run on `mask(source)`, which blanks strings and comments first.
- **Test on real repositories** before opening a PR here. Mention which ones in the PR description.

## Pull requests

Keep them small and focused. Run `pytest` and `tests/parity.py` before pushing; CI runs both.
