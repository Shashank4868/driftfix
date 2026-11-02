import textwrap

from driftfix.rules.openai_node_v4 import migrate


def run(src: str):
    return migrate(textwrap.dedent(src).lstrip("\n"))


def test_esm_client_and_chat_call():
    r = run(
        """
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
        """
    )
    out = r.code
    assert 'import OpenAI from "openai";' in out
    assert "new Configuration" not in out
    assert "const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });" in out
    assert "openai.chat.completions.create({" in out
    assert "completion.choices[0].message.content" in out
    assert not r.notes


def test_commonjs_inline_constructor_and_base_path():
    r = run(
        """
        const { Configuration, OpenAIApi } = require("openai");
        const openai = new OpenAIApi(new Configuration({ apiKey: key, basePath: "https://proxy/v1" }));
        """
    )
    assert 'const OpenAI = require("openai");' in r.code
    assert 'const openai = new OpenAI({ apiKey: key, baseURL: "https://proxy/v1" });' in r.code


def test_destructured_data_and_chained_data():
    r = run(
        """
        import { Configuration, OpenAIApi } from "openai";
        const openai = new OpenAIApi(new Configuration({ apiKey: k }));
        const { data } = await openai.createEmbedding({ model: "m", input: "x" });
        const vec = data.data[0].embedding;
        const text = (await openai.createCompletion({ model: "m", prompt: "p" })).data.choices[0].text;
        """
    )
    assert "const data = await openai.embeddings.create(" in r.code
    assert "data.data[0].embedding" in r.code  # v4 embeddings list lives under .data
    assert '(await openai.completions.create({ model: "m", prompt: "p" })).choices[0].text' in r.code


def test_types_and_streaming_and_errors_are_flagged():
    r = run(
        """
        import { Configuration, OpenAIApi, ChatCompletionRequestMessage } from "openai";
        const openai = new OpenAIApi(new Configuration({ apiKey: k }));
        try {
          const res = await openai.createChatCompletion({ model: "m", messages, stream: true }, { responseType: "stream" });
        } catch (error) {
          console.log(error.response.status);
        }
        """
    )
    assert 'import OpenAI, { ChatCompletionRequestMessage } from "openai";' in r.code
    messages = " ".join(n.message for n in r.notes)
    assert "ChatCompletionRequestMessage" in messages
    assert "responseType" in messages
    assert "axios error" in messages


def test_strings_and_comments_untouched():
    src = textwrap.dedent(
        """
        import { Configuration, OpenAIApi } from "openai";
        // old: openai.createChatCompletion(...)
        const doc = "call openai.createChatCompletion here";
        const openai = new OpenAIApi(new Configuration({ apiKey: k }));
        """
    ).lstrip("\n")
    out = migrate(src).code
    assert "// old: openai.createChatCompletion(...)" in out
    assert '"call openai.createChatCompletion here"' in out


def test_v4_code_is_left_alone():
    src = 'import OpenAI from "openai";\nconst openai = new OpenAI();\n'
    assert not migrate(src).changed


def test_typescript_annotations():
    r = run(
        """
        import { Configuration, OpenAIApi } from "openai";
        const configuration: Configuration = new Configuration({ apiKey: process.env.KEY });
        const openai = new OpenAIApi(configuration);
        const res = await openai.createChatCompletion({ model: "m", messages: [] });
        const first: string | undefined = res.data.choices[0].message?.content;
        """
    )
    assert "new Configuration" not in r.code
    assert "res.choices[0].message?.content" in r.code


def test_import_keeps_quote_style_and_following_lines():
    r = run(
        """
        import { Configuration, OpenAIApi } from 'openai'

        import { helper } from './helper'

        const openai = new OpenAIApi(new Configuration({ apiKey: key }))
        """
    )
    assert r.code.startswith("import OpenAI from 'openai'\n\nimport { helper } from './helper'\n")


def test_leftover_type_references_renamed():
    r = run(
        """
        import { Configuration, OpenAIApi } from 'openai'

        let client: OpenAIApi | null = null
        const openai = new OpenAIApi(new Configuration({ apiKey: key }))
        """
    )
    assert "let client: OpenAI | null = null" in r.code
    assert "OpenAIApi" not in r.code


def test_multiline_inline_constructor_reindented():
    r = run(
        """
        import { Configuration, OpenAIApi } from 'openai'

        const client = key
          ? new OpenAIApi(
              new Configuration({
                apiKey: key,
              })
            )
          : null
        """
    )
    assert "  ? new OpenAI({\n      apiKey: key,\n    })\n  : null" in r.code
