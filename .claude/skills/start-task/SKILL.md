---
name: start-task
description: Claim a GitHub issue, branch for it and load its task card. Use when the user runs /start-task <issue-number>.
argument-hint: <issue-number>
disable-model-invocation: true
---

Start task #$0. Stop and tell me (don't work around it) if any check fails.

1. **Who am I.** Run `gh api user -q .login` and find my row in the CLAUDE.md ownership table. That gives my
   first name (lowercase, for the branch) and my area. If I'm not in the table, stop.
2. **Read the issue.** `gh issue view $0`. Its label must match my area: Musa → `data`; Aadit → `ai` or `pitch`;
   Eric → `web` or `3d`. `bug` and `demo` are anyone's. If it's another area's task, stop.
3. **Claim it.** If someone else is assigned, stop. Otherwise `gh issue edit $0 --add-assignee @me`.
4. **Clean start.** `git status --porcelain` must be empty. If not, ask whether to `/ship` or stash first.
5. **Branch.** `git switch main && git pull --ff-only`, then
   `git switch -c <firstname>/$0-<slug>` (slug: 2–4 lowercase words from the title, joined by hyphens).
6. **Load context.** Read this task's card in `docs/ROADMAP.md` and the parts of `contracts/` it touches.
   For each "Depends on" task, check whether its issue is closed; if not, plan to mock it from `contracts/fixtures/`.
7. **Report back in at most 8 lines:** branch name, the done-when checklist, the files you'll create or edit
   (all inside my area), anything you'll mock, and the effort level you recommend (rules in CLAUDE.md). Then ask
   "Go?" and wait; I'll switch effort first if needed. When I say go, start from the issue's
   "Prompt to start with".
