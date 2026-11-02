"""Parity check: the browser engine (site/engine.js) must produce the same code as the Python rules.

Run: python tests/parity.py   (needs node on PATH)
"""

import json
import subprocess
import sys
import textwrap
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from driftfix.rules.openai_node_v4 import migrate as migrate_node  # noqa: E402
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
    "local-import": """
        import os

        class GPT:
            def __init__(self):
                import openai
                openai.api_key = os.getenv("KEY")

            def ask(self, p):
                return openai.ChatCompletion.create(model="m", messages=[])
        """,
}

NODE_CASES = {
    "esm": """
        import { Configuration, OpenAIApi } from "openai";

        const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
        const openai = new OpenAIApi(configuration);

        export async function ask(prompt) {
          const completion = await openai.createChatCompletion({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
          });
          return completion.data.choices[0].message.content;
        }
        """,
    "cjs-inline": """
        const { Configuration, OpenAIApi } = require("openai");
        const openai = new OpenAIApi(new Configuration({ apiKey: key, basePath: "https://proxy/v1" }));
        const { data } = await openai.createEmbedding({ model: "m", input: "x" });
        const first = (await openai.createModeration({ input: "x" })).data.results[0];
        console.log(data.data[0].embedding, first);
        """,
    "ts-ternary": """
        import { Configuration, OpenAIApi } from 'openai'

        import { helper } from './helper'

        const openaiClient: OpenAIApi | null = process.env.OPENAI_KEY
            ? new OpenAIApi(
                  new Configuration({
                      apiKey: process.env.OPENAI_KEY,
                  })
              )
            : null

        const response = await openaiClient.createEmbedding({ model: 'text-embedding-ada-002', input: 'hi' })
        const vector = response.data.data[0].embedding
        """,
    "flagged": """
        import { Configuration, OpenAIApi, ChatCompletionRequestMessage } from "openai";
        const openai = new OpenAIApi(new Configuration({ apiKey }));
        try {
          const r = await openai.createChatCompletion({ model: "m", messages, stream: true }, { responseType: "stream" });
          await openai.createTranscription(file, "whisper-1");
        } catch (error) {
          console.log(error.response?.status, error.response.data);
        }
        """,
    "strings": """
        // openai.createChatCompletion in a comment
        import { OpenAIApi } from "openai";
        const s = `call openai.createChatCompletion(${x}) here`;
        """,
    "v4-already": 'import OpenAI from "openai";\nconst openai = new OpenAI();\n',
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
    failed += node_parity()
    total = len(cases) + len(NODE_CASES)
    print(f"\n{total - failed}/{total} cases identical")
    return 1 if failed else 0


def node_parity() -> int:
    cases = {k: textwrap.dedent(v).lstrip("\n") for k, v in NODE_CASES.items()}
    js = (
        "const e=require(process.argv[1]);const c=JSON.parse(require('fs').readFileSync(0,'utf8'));"
        "const o={};for(const k in c){const r=e.migrate(c[k]);o[k]={code:r.code,notes:r.notes.map(n=>[n.line,n.msg])}}"
        "process.stdout.write(JSON.stringify(o))"
    )
    proc = subprocess.run(["node", "-e", js, str(ROOT / "site/engine-node.js")], input=json.dumps(cases), capture_output=True, text=True, encoding="utf-8")
    if proc.returncode:
        print(proc.stderr)
        return len(cases)
    browser = json.loads(proc.stdout)
    failed = 0
    for name, src in cases.items():
        r = migrate_node(src)
        expected = {"code": r.code, "notes": [[n.line, n.message] for n in r.notes]}
        if browser[name] == expected:
            print(f"  same  node:{name}")
        else:
            failed += 1
            print(f"  DIFF  node:{name}\n--- python\n{expected}\n--- browser\n{browser[name]}")
    return failed


if __name__ == "__main__":
    raise SystemExit(main())
