import textwrap

from driftfix.rules.openai_v1 import migrate


def run(src: str) -> str:
    return migrate(textwrap.dedent(src)).code


def test_chat_call_moves_to_client_and_response_becomes_attributes():
    out = run(
        """
        import openai

        r = openai.ChatCompletion.create(model="gpt-4o-mini", messages=[])
        print(r["choices"][0]["message"]["content"])
        """
    )
    assert "from openai import OpenAI" in out
    assert "client = OpenAI()" in out
    assert "client.chat.completions.create(" in out
    assert "r.choices[0].message.content" in out
    assert "import openai\n" not in out  # no longer referenced, so dropped


def test_api_key_setting_becomes_client_argument():
    out = run(
        """
        import os
        import openai

        openai.api_key = os.environ["KEY"]
        openai.api_base = "https://proxy.example.com/v1"
        e = openai.Embedding.create(model="m", input=["a"])
        """
    )
    assert 'client = OpenAI(api_key=os.environ["KEY"], base_url="https://proxy.example.com/v1")' in out
    assert "openai.api_key" not in out and "openai.api_base" not in out
    assert out.count("client = OpenAI(") == 1


def test_async_calls_use_async_client():
    out = run(
        """
        import openai

        async def go():
            r = await openai.ChatCompletion.acreate(model="m", messages=[])
            return r["choices"][0]["message"]["content"]
        """
    )
    assert "from openai import OpenAI, AsyncOpenAI" in out
    assert "async_client = AsyncOpenAI()" in out
    assert "await async_client.chat.completions.create(" in out
    assert "r.choices[0].message.content" in out


def test_errors_move_and_import_is_kept_when_still_used():
    out = run(
        """
        import openai

        try:
            openai.Completion.create(model="m", prompt="hi", request_timeout=5)
        except openai.error.InvalidRequestError:
            pass
        """
    )
    assert "except openai.BadRequestError:" in out
    assert "timeout=5" in out and "request_timeout" not in out
    assert "import openai\n" in out


def test_aliased_import_is_followed():
    out = run(
        """
        import openai as oa

        resp = oa.Moderation.create(input="text")
        flagged = resp["results"][0]["flagged"]
        """
    )
    assert "client.moderations.create(" in out
    assert "resp.results[0].flagged" in out


def test_unrelated_dicts_are_left_alone():
    out = run(
        """
        import openai

        config = {"model": "gpt-4o-mini"}
        r = openai.ChatCompletion.create(model=config["model"], messages=[])
        """
    )
    assert 'config["model"]' in out


def test_streaming_get_is_flagged_for_review():
    result = migrate(
        textwrap.dedent(
            """
            import openai

            for chunk in openai.ChatCompletion.create(model="m", messages=[], stream=True):
                print(chunk["choices"][0]["delta"].get("content", ""))
            """
        )
    )
    assert "chunk.choices[0].delta.get(" in result.code
    assert any("attribute access" in n.message for n in result.notes)


def test_file_without_v0_usage_is_untouched():
    src = "from openai import OpenAI\n\nclient = OpenAI()\n"
    assert not migrate(src).changed


def test_formatting_and_comments_survive():
    src = textwrap.dedent(
        """
        import openai

        # ask the model
        r = openai.ChatCompletion.create(
            model="gpt-4o-mini",  # cheap
            messages=[],
        )
        """
    )
    out = migrate(src).code
    assert "# ask the model" in out and "# cheap" in out


def test_dict_access_directly_on_a_call_is_fully_converted():
    out = run(
        """
        import openai

        def is_safe(text):
            return not openai.Moderation.create(input=text)["results"][0]["flagged"]
        """
    )
    assert "client.moderations.create(input=text).results[0].flagged" in out


def test_function_local_import_is_left_for_a_human():
    src = textwrap.dedent(
        """
        import os

        class GPT:
            def __init__(self):
                import openai
                openai.api_key = os.getenv("OPENAI_API_KEY")

            def ask(self, prompt):
                return openai.ChatCompletion.create(model="gpt-4o-mini", messages=[])
        """
    )
    r = migrate(src)
    assert r.code == src
    assert any("inside a function" in n.message for n in r.notes)
