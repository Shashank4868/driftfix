"""Customer-support helper for an online store. Written against openai 0.28."""

import os

import openai

openai.api_key = os.getenv("OPENAI_API_KEY")

SYSTEM = "You are a concise support agent for an online store. Answer in one or two sentences."


def answer(question: str) -> str:
    response = openai.ChatCompletion.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": question},
        ],
        temperature=0.2,
        request_timeout=20,
    )
    return response["choices"][0]["message"]["content"].strip()


def embed(texts: list[str]) -> list[list[float]]:
    result = openai.Embedding.create(model="text-embedding-3-small", input=texts)
    return [row["embedding"] for row in result["data"]]


def answer_with_retry(question: str, attempts: int = 3) -> str:
    for _ in range(attempts):
        try:
            return answer(question)
        except openai.error.RateLimitError:
            continue
    return "We're getting a lot of questions right now. A person will reply soon."
