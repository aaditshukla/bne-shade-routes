---
name: ship
description: Smoke-check, commit, open a PR and squash-merge the current task branch into main. Use when the user runs /ship.
disable-model-invocation: true
---

Ship the current task branch to main. Stop and tell me if any check fails; never force-push or bypass a check.

1. **Branch.** `git branch --show-current` must look like `<name>/<n>-<slug>`. Take the issue number `n` from it.
   If you're on `main`, stop.
2. **Area guard.** Run `gh api user -q .login` and find my area in the CLAUDE.md table. List the changed files
   (`git status --porcelain` plus `git diff --name-only origin/main...HEAD`). If any file is outside my area, stop
   and list them. Never stage `.env`, `data/cache/`, `ai/cache/`, `node_modules/` or `dist/`.
3. **Smoke check.** Skip any part that doesn't exist yet and say what you skipped:
   - `data/validate.py` exists → `cd data && uv run python validate.py`
   - `web/package.json` exists → `cd web && npm ci` (only if `node_modules/` is missing), then `npm run build`
   If it fails, fix it (at most 2 attempts), then stop with the exact error.
4. **Commit.** Stage only my files. Message `[<area>] <what changed> (#n)`, where area is the issue label
   (`data`, `ai`, `pitch`, `web`, `3d`, `demo`). No AI attribution, no Co-Authored-By trailer.
5. **Catch up.** `git fetch origin && git rebase origin/main`. On a conflict in a file outside my area, abort the
   rebase and stop. If the rebase pulled anything in, rerun step 3.
6. **PR.** `git push -u origin HEAD`, then `gh pr create --title "<commit message>" --body "<body>"`. The body is
   `Closes #n` if every done-when item in the issue is met, otherwise `Part of #n`, followed by the done-when
   checklist ticked as it stands. No AI attribution.
7. **Merge.** `gh pr merge --squash --delete-branch`, then `git switch main && git pull --ff-only`.
8. **Report in at most 5 lines:** PR URL, whether the issue closed, and anything the team must hear out loud:
   a contract or fixture change, a gate met (with its `git tag <tag> && git push origin <tag>` command from
   `docs/ROADMAP.md`, which I'll run myself), or edge IDs frozen. Vercel deploys main on its own.
