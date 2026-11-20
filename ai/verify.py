"""A4 - Verifier pass with claude-sonnet-5-5.

Re-check every positive from detections.jsonl in a fresh request that sees
only the image and the claim, never the first pass's reasoning.
Verified only when both passes agree it is covered.

Writes ai/cache/verified.jsonl. Resumable.

Env: ANTHROPIC_API_KEY from ../.env
Task card: docs/ROADMAP.md -> A4
"""

# TODO: implement per docs/ROADMAP.md task A4
