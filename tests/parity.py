"""Parity check: the browser engine (site/engine.js) must produce the same code as the Python rules.

Run: python tests/parity.py   (needs node on PATH)
"""

import json
import subprocess
import sys
import textwrap
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from driftfix.rules.openai_v1 import migrate  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]

CASES = {
    "support-bot": (ROOT / "examples/support-bot/app.py").read_text(encoding="utf-8"),
    "chat": """
        import openai

        r = openai.ChatCompletion.create(model="gpt-4o-mini", messages=[])
        print(r["choices"][0]["message"]["content"])
        """,
    "settings": """
        import os
        import openai

        openai.api_key = os.environ["KEY"]
        openai.api_base = "https://proxy.example.com/v1"
        e = openai.Embedding.create(model="m", input=["a"])
        """,
    "async": """
        import openai

        async def go():
            r = await openai.ChatCompletion.acreate(model="m", messages=[])
            return r["choices"][0]["message"]["content"]
        """,
    "errors": """
        import openai

        try:
            openai.Completion.create(model="m", prompt="hi", request_timeout=5)
        except openai.error.InvalidRequestError:
            pass
        """,
    "alias": """
        import openai as oa

        resp = oa.Moderation.create(input="text")
        flagged = resp["results"][0]["flagged"]
        """,
    "unrelated": """
        import openai

        config = {"model": "gpt-4o-mini"}
        r = openai.ChatCompletion.create(model=config["model"], messages=[])
        """,
    "comments-and-strings": """
        import openai

        # openai.ChatCompletion.create is mentioned in this comment
        PROMPT = "call openai.ChatCompletion.create(...) here"
        r = openai.ChatCompletion.create(
            model="gpt-4o-mini",  # cheap
            messages=[{"role": "user", "content": PROMPT}],
        )
        """,
    "v1-already": "from openai import OpenAI\n\nclient = OpenAI()\n",
    "worker": (ROOT / "site/samples/worker.py").read_text(encoding="utf-8"),
    "call-subscript": """
        import openai

        def is_safe(text):
            return not openai.Moderation.create(input=text)["results"][0]["flagged"]
        """,
}


def main() -> int:
    cases = {k: textwrap.dedent(v).lstrip("\n") for k, v in CASES.items()}
    js = (
        "const e=require(process.argv[1]);const c=JSON.parse(require('fs').readFileSync(0,'utf8'));"
        "const o={};for(const k in c){o[k]=e.migrate(c[k]).code}process.stdout.write(JSON.stringify(o))"
    )
    proc = subprocess.run(["node", "-e", js, str(ROOT / "site/engine.js")], input=json.dumps(cases), capture_output=True, text=True, encoding="utf-8")
    if proc.returncode:
        print(proc.stderr)
        return 1
    browser = json.loads(proc.stdout)
    failed = 0
    for name, src in cases.items():
        expected = migrate(src).code
        if browser[name] == expected:
            print(f"  same  {name}")
        else:
            failed += 1
            print(f"  DIFF  {name}\n--- python\n{expected}\n--- browser\n{browser[name]}")
    print(f"\n{len(cases) - failed}/{len(cases)} cases identical")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
