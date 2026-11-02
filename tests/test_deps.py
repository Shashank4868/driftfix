import json

from driftfix.deps import node_pins, python_pins


def test_requirements_pins_are_raised(tmp_path):
    (tmp_path / "requirements.txt").write_text("flask==3.0\nopenai==0.28.1\n# openai==0.1 stays a comment\nrequests\n")
    [c] = python_pins(tmp_path)
    assert "openai>=1.0" in c.after and "flask==3.0" in c.after and "# openai==0.1" in c.after
    assert c.old_spec == "==0.28.1"


def test_triple_equals_and_upper_bound(tmp_path):
    (tmp_path / "requirements.txt").write_text("openai===0.27.10\n")
    assert python_pins(tmp_path)[0].after == "openai>=1.0\n"
    (tmp_path / "requirements.txt").write_text("openai<1\n")
    assert python_pins(tmp_path)[0].after == "openai>=1.0\n"


def test_unpinned_or_v1_left_alone(tmp_path):
    (tmp_path / "requirements.txt").write_text("openai\nopenai>=1.40\n")
    assert python_pins(tmp_path) == []


def test_poetry_pin(tmp_path):
    (tmp_path / "pyproject.toml").write_text('[tool.poetry.dependencies]\nopenai = "^0.27.8"\n')
    assert 'openai = ">=1.0"' in python_pins(tmp_path)[0].after


def test_package_json_v3_raised_and_formatting_kept(tmp_path):
    pkg = '{\n  "name": "bot",\n  "dependencies": {\n    "discord.js": "^14.0.0",\n    "openai": "^3.3.0"\n  }\n}\n'
    (tmp_path / "package.json").write_text(pkg)
    [c] = node_pins(tmp_path)
    assert json.loads(c.after)["dependencies"]["openai"] == "^4.104.0"
    assert c.after.replace("^4.104.0", "^3.3.0") == pkg


def test_package_json_v4_left_alone(tmp_path):
    (tmp_path / "package.json").write_text('{"dependencies": {"openai": "^4.20.0"}}')
    assert node_pins(tmp_path) == []


def test_misspelled_requirements_file_is_found(tmp_path):
    (tmp_path / "requirementx.txt").write_text("Flask==2.2.3\nopenai==0.27.2\n")
    changes = python_pins(tmp_path)
    assert [c.path.name for c in changes] == ["requirementx.txt"]
    assert "openai>=1.0" in changes[0].after
