"""Write the two secrets into the repo-root .env, safely.

Prompts with a hidden input, so the key never appears in your shell history,
in a chat, or in a log. Writes to the exact path the pipeline reads.

Run:  cd ai && uv run python setup_env.py
"""

from __future__ import annotations

import getpass
from pathlib import Path

import common as C

TARGET = C.REPO / ".env"
KEYS = ("MAPILLARY_TOKEN", "ANTHROPIC_API_KEY")


def read_existing() -> dict[str, str]:
    values: dict[str, str] = {}
    if TARGET.exists():
        for line in TARGET.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip()
    return values


def main() -> None:
    print(f"Writing to {TARGET}")
    values = read_existing()

    for key in KEYS:
        current = values.get(key, "")
        hint = f" (currently {len(current)} characters)" if current else " (currently empty)"
        print(f"{key}{hint}")
        entered = getpass.getpass("  paste it and press Enter, or just Enter to keep: ").strip()
        if entered:
            values[key] = entered

    lines = [
        "# local only, git-ignored. Never print or commit this file.",
        *(f"{key}={values.get(key, '')}" for key in KEYS),
        "",
    ]
    TARGET.write_text("\n".join(lines), encoding="utf-8")

    print(f"\nSaved {TARGET}")
    for key in KEYS:
        value = values.get(key, "")
        status = f"{len(value)} characters" if value else "EMPTY"
        print(f"  {key}: {status}")

    if any(not values.get(key) for key in KEYS):
        print("\nSome keys are still empty. Run this again when you have them.")


if __name__ == "__main__":
    main()
