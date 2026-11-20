"""A3 - First vision pass with claude-haiku-5-5.

For each cached image, ask whether the LEFT and RIGHT footpath is covered
overhead (awning, verandah, shade sail, covered walkway). Trees do not count.

Appends one line per image to ai/cache/detections.jsonl. Resumable.
Force JSON with a tool schema.

Env: ANTHROPIC_API_KEY from ../.env
Task card: docs/ROADMAP.md -> A3
"""

# TODO: implement per docs/ROADMAP.md task A3
