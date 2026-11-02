"""The change map: one entry per breaking API change Driftfix knows how to migrate.

Each entry pairs a provider's published change with the files it applies to and
the rules that rewrite code for it. New providers are added here, not in the CLI.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Change:
    id: str
    provider: str
    title: str
    from_version: str
    to_version: str
    released: str
    summary: str
    changelog_url: str
    branch: str
    language: str
    extensions: tuple[str, ...]
    marker: str  # cheap substring test before parsing a file


OPENAI_PYTHON_V1 = Change(
    id="openai-python-v1",
    provider="OpenAI Python SDK",
    title="Migrate to the OpenAI Python SDK v1 client",
    from_version="0.x",
    to_version=">=1.0",
    released="2023-11-06",
    summary=(
        "Module-level calls such as openai.ChatCompletion.create were removed in "
        "openai 1.0.0 and now raise APIRemovedInV1. Calls move to a client object, "
        "responses become typed objects instead of dicts, and errors move from "
        "openai.error to the top-level module."
    ),
    changelog_url="https://github.com/openai/openai-python/discussions/742",
    branch="driftfix/openai-python-v1",
    language="Python",
    extensions=(".py",),
    marker="openai",
)

OPENAI_NODE_V4 = Change(
    id="openai-node-v4",
    provider="OpenAI Node.js SDK",
    title="Migrate to the OpenAI Node.js SDK v4 client",
    from_version="3.x",
    to_version=">=4.0",
    released="2023-08-10",
    summary=(
        "openai v4 replaces Configuration and OpenAIApi with a single OpenAI client, "
        "moves methods like createChatCompletion to resource namespaces "
        "(chat.completions.create), and returns the payload directly instead of an "
        "axios response under .data."
    ),
    changelog_url="https://github.com/openai/openai-node/discussions/217",
    branch="driftfix/openai-node-v4",
    language="JavaScript/TypeScript",
    extensions=(".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"),
    marker="OpenAIApi",
)

REGISTRY = {c.id: c for c in (OPENAI_PYTHON_V1, OPENAI_NODE_V4)}
