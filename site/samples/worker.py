"""Background worker: summaries, streaming replies and moderation. Written against openai 0.27."""

import asyncio

import openai

from settings import OPENAI_KEY, OPENAI_ORG

openai.api_key = OPENAI_KEY
openai.organization = OPENAI_ORG


async def summarize(document: str) -> str:
    reply = await openai.ChatCompletion.acreate(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": f"Summarize in three bullets:\n{document}"}],
    )
    return reply["choices"][0]["message"]["content"]


def stream_reply(prompt: str):
    for chunk in openai.ChatCompletion.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        stream=True,
    ):
        yield chunk["choices"][0]["delta"].get("content", "")


def is_safe(text: str) -> bool:
    try:
        return not openai.Moderation.create(input=text)["results"][0]["flagged"]
    except openai.error.APIConnectionError:
        return True  # fail open if moderation is down


async def summarize_all(documents):
    return await asyncio.gather(*(summarize(d) for d in documents))
