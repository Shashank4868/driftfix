"""Tests run against the installed openai package with the network layer stubbed out.

The stubs replace the v1 resource methods, so these tests pass only once app.py
talks to the v1 client the way the real SDK expects.
"""

from types import SimpleNamespace

import openai
from openai.resources.chat.completions import Completions
from openai.resources.embeddings import Embeddings

import app


def rate_limit_error():
    # Built without the SDK's HTTP layer so the test works on every openai>=1 release.
    err = openai.RateLimitError.__new__(openai.RateLimitError)
    Exception.__init__(err, "rate limited")
    return err


def chat_reply(text):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])


def test_answer_strips_reply(monkeypatch):
    def create(self, **kwargs):
        assert kwargs["model"] == "gpt-4o-mini"
        assert kwargs["timeout"] == 20
        return chat_reply("  Orders ship within 2 business days.  ")

    monkeypatch.setattr(Completions, "create", create)
    assert app.answer("When will my order ship?") == "Orders ship within 2 business days."


def test_embed_returns_vectors(monkeypatch):
    def create(self, **kwargs):
        rows = [SimpleNamespace(embedding=[0.1, 0.2]) for _ in kwargs["input"]]
        return SimpleNamespace(data=rows)

    monkeypatch.setattr(Embeddings, "create", create)
    assert app.embed(["refund policy", "shipping times"]) == [[0.1, 0.2], [0.1, 0.2]]


def test_retry_after_rate_limit(monkeypatch):
    calls = {"n": 0}

    def create(self, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise rate_limit_error()
        return chat_reply("Yes, we ship to Canada.")

    monkeypatch.setattr(Completions, "create", create)
    assert app.answer_with_retry("Do you ship to Canada?") == "Yes, we ship to Canada."
    assert calls["n"] == 2
