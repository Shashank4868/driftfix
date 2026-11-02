/*
 * Sample repositories for the Driftfix demo workspace. Every number the
 * workspace shows is computed by running engine.js on these files in the
 * browser; nothing here is a pre-baked result.
 */
(function (root) {
  "use strict";

  var SUPPORT_APP = [
    '"""Customer-support helper for an online store. Written against openai 0.28."""',
    "",
    "import os",
    "",
    "import openai",
    "",
    'openai.api_key = os.getenv("OPENAI_API_KEY")',
    "",
    'SYSTEM = "You are a concise support agent for an online store. Answer in one or two sentences."',
    "",
    "",
    "def answer(question: str) -> str:",
    "    response = openai.ChatCompletion.create(",
    '        model="gpt-4o-mini",',
    "        messages=[",
    '            {"role": "system", "content": SYSTEM},',
    '            {"role": "user", "content": question},',
    "        ],",
    "        temperature=0.2,",
    "        request_timeout=20,",
    "    )",
    '    return response["choices"][0]["message"]["content"].strip()',
    "",
    "",
    "def embed(texts: list[str]) -> list[list[float]]:",
    '    result = openai.Embedding.create(model="text-embedding-3-small", input=texts)',
    '    return [row["embedding"] for row in result["data"]]',
    "",
    "",
    "def answer_with_retry(question: str, attempts: int = 3) -> str:",
    "    for _ in range(attempts):",
    "        try:",
    "            return answer(question)",
    "        except openai.error.RateLimitError:",
    "            continue",
    '    return "We\'re getting a lot of questions right now. A person will reply soon."',
    ""
  ].join("\n");

  var SUPPORT_TESTS = [
    "from types import SimpleNamespace",
    "",
    "import openai",
    "from openai.resources.chat.completions import Completions",
    "",
    "import app",
    "",
    "",
    "def test_answer_strips_reply(monkeypatch):",
    "    def create(self, **kwargs):",
    '        assert kwargs["timeout"] == 20',
    '        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="  Ships Monday.  "))])',
    "",
    '    monkeypatch.setattr(Completions, "create", create)',
    '    assert app.answer("When will my order ship?") == "Ships Monday."',
    ""
  ].join("\n");

  var WORKER = [
    '"""Background worker: summaries, streaming replies and moderation. Written against openai 0.27."""',
    "",
    "import asyncio",
    "",
    "import openai",
    "",
    "from settings import OPENAI_KEY, OPENAI_ORG",
    "",
    "openai.api_key = OPENAI_KEY",
    "openai.organization = OPENAI_ORG",
    "",
    "",
    "async def summarize(document: str) -> str:",
    "    reply = await openai.ChatCompletion.acreate(",
    '        model="gpt-4o-mini",',
    '        messages=[{"role": "user", "content": f"Summarize in three bullets:\\n{document}"}],',
    "    )",
    '    return reply["choices"][0]["message"]["content"]',
    "",
    "",
    "def stream_reply(prompt: str):",
    "    for chunk in openai.ChatCompletion.create(",
    '        model="gpt-4o-mini",',
    '        messages=[{"role": "user", "content": prompt}],',
    "        stream=True,",
    "    ):",
    '        yield chunk["choices"][0]["delta"].get("content", "")',
    "",
    "",
    "def is_safe(text: str) -> bool:",
    "    try:",
    '        return not openai.Moderation.create(input=text)["results"][0]["flagged"]',
    "    except openai.error.APIConnectionError:",
    "        return True  # fail open if moderation is down",
    "",
    "",
    "async def summarize_all(documents):",
    "    return await asyncio.gather(*(summarize(d) for d in documents))",
    ""
  ].join("\n");

  var EMBED_JOB = [
    '"""Nightly job: embed new help-center articles for search."""',
    "",
    "import openai as oa",
    "",
    "from store import load_new_articles, save_vectors",
    "",
    "BATCH = 64",
    "",
    "",
    "def run():",
    "    articles = load_new_articles()",
    "    for start in range(0, len(articles), BATCH):",
    "        batch = articles[start:start + BATCH]",
    "        try:",
    '            resp = oa.Embedding.create(model="text-embedding-3-small", input=[a.body for a in batch])',
    "        except oa.error.InvalidRequestError as err:",
    '            print("skipping batch", start, err)',
    "            continue",
    '        vectors = [item["embedding"] for item in resp["data"]]',
    "        save_vectors([a.id for a in batch], vectors)",
    '        print("tokens used:", resp["usage"]["total_tokens"])',
    ""
  ].join("\n");

  var CLASSIFY_JOB = [
    '"""Route incoming tickets to a queue with a cheap completion call."""',
    "",
    "import openai",
    "",
    'QUEUES = ["billing", "shipping", "returns", "other"]',
    "",
    "",
    "def classify(ticket_text: str) -> str:",
    "    completion = openai.Completion.create(",
    '        engine="gpt-35-turbo-instruct",',
    '        prompt=f"Queue for this ticket ({\', \'.join(QUEUES)}):\\n{ticket_text}\\nQueue:",',
    "        max_tokens=3,",
    "    )",
    '    label = completion["choices"][0]["text"].strip().lower()',
    '    return label if label in QUEUES else "other"',
    ""
  ].join("\n");

  var STOREFRONT = [
    '"""Checkout endpoints. Pinned to a Stripe API version in settings."""',
    "",
    "import stripe",
    "",
    "from settings import STRIPE_KEY",
    "",
    "stripe.api_key = STRIPE_KEY",
    'stripe.api_version = "2023-10-16"',
    "",
    "",
    "def create_checkout(cart):",
    "    return stripe.checkout.Session.create(",
    '        mode="payment",',
    '        line_items=[{"price": item.price_id, "quantity": item.qty} for item in cart],',
    '        success_url="https://shop.example.com/thanks",',
    "    )",
    ""
  ].join("\n");

  var COPYWRITER = [
    '"""Generates product blurbs. Already on the v1 client."""',
    "",
    "from openai import OpenAI",
    "",
    "client = OpenAI()",
    "",
    "",
    "def blurb(product: str) -> str:",
    "    reply = client.chat.completions.create(",
    '        model="gpt-4o-mini",',
    '        messages=[{"role": "user", "content": f"Two-line blurb for {product}"}],',
    "    )",
    "    return reply.choices[0].message.content",
    ""
  ].join("\n");

  var REPOS = [
    {
      name: "support-bot", lang: "Python", tests: "pytest", branch: "main",
      description: "Customer-support answers and FAQ search",
      files: [
        { path: "app.py", code: SUPPORT_APP },
        { path: "tests/test_app.py", code: SUPPORT_TESTS },
        { path: "requirements.txt", code: "openai==0.28.1\npytest>=7\n" }
      ],
      recorded: { before: "3 failed (APIRemovedInV1)", after: "3 passed", seconds: 2.3 }
    },
    {
      name: "insights-pipeline", lang: "Python", tests: "pytest", branch: "main",
      description: "Summaries, embeddings and ticket routing jobs",
      files: [
        { path: "worker.py", code: WORKER },
        { path: "jobs/embed_articles.py", code: EMBED_JOB },
        { path: "jobs/classify_tickets.py", code: CLASSIFY_JOB },
        { path: "requirements.txt", code: "openai==0.27.8\nhttpx\n" }
      ]
    },
    {
      name: "storefront-api", lang: "Python", tests: "pytest", branch: "main",
      description: "Checkout and order endpoints",
      files: [
        { path: "checkout.py", code: STOREFRONT },
        { path: "requirements.txt", code: "stripe==7.4.0\nfastapi\n" }
      ]
    },
    {
      name: "marketing-tools", lang: "Python", tests: "none", branch: "main",
      description: "Copy generation scripts for the marketing team",
      files: [
        { path: "copywriter.py", code: COPYWRITER },
        { path: "requirements.txt", code: "openai>=1.40\n" }
      ]
    }
  ];

  // Integrators of a hypothetical API provider, for the provider console.
  function integrator(name, style) {
    var lines = ["import openai", ""];
    if (style.key) lines.push('openai.api_key = os.environ["OPENAI_API_KEY"]', "");
    lines.push("def " + style.fn + "(text):");
    if (style.call === "chat") {
      lines.push("    r = openai.ChatCompletion.create(model=\"gpt-4o-mini\", messages=[{\"role\": \"user\", \"content\": text}]" + (style.timeout ? ", request_timeout=30" : "") + ")");
      lines.push('    return r["choices"][0]["message"]["content"]');
    } else if (style.call === "embed") {
      lines.push('    r = openai.Embedding.create(model="text-embedding-3-small", input=[text])');
      lines.push('    return r["data"][0]["embedding"]');
    } else if (style.call === "stream") {
      lines.push('    for chunk in openai.ChatCompletion.create(model="gpt-4o-mini", messages=[{"role": "user", "content": text}], stream=True):');
      lines.push('        yield chunk["choices"][0]["delta"].get("content", "")');
    } else if (style.call === "v1") {
      lines[0] = "from openai import OpenAI";
      lines.splice(1, 0, "", "client = OpenAI()");
      lines.push('    return client.chat.completions.create(model="gpt-4o-mini", messages=[{"role": "user", "content": text}]).choices[0].message.content');
    }
    if (style.key) lines.splice(1, 0, "import os");
    return { name: name, path: style.path, code: lines.join("\n") + "\n" };
  }

  var INTEGRATORS = [
    integrator("northwind-helpdesk", { path: "bot/reply.py", call: "chat", key: true, timeout: true, fn: "reply" }),
    integrator("lumen-notes", { path: "search/index.py", call: "embed", key: true, fn: "vectorize" }),
    integrator("quill-writer", { path: "editor/suggest.py", call: "stream", fn: "suggest" }),
    integrator("harbor-crm", { path: "crm/summaries.py", call: "chat", fn: "summarize_account" }),
    integrator("tinyledger", { path: "ai/categorize.py", call: "v1", fn: "categorize" }),
    integrator("orbit-docs", { path: "docs/qa.py", call: "chat", key: true, fn: "answer" })
  ];

  root.DriftfixWorkspaceData = { org: "acme", repos: REPOS, integrators: INTEGRATORS };
})(typeof window !== "undefined" ? window : this);
