from driftfix.rules import openai_node_v4, openai_v1

RULES = {
    "openai-python-v1": openai_v1.migrate,
    "openai-node-v4": openai_node_v4.migrate,
}
