# GitHub & AgentWiki Publishing (`--github`, `--wiki`)

## GitHub Issue Integration (`--github`)

When `--github` is passed, create or update a GitHub issue after plan validation and red-team gates:

1. **Prerequisites**: Ensure `gh` CLI is installed and authenticated (`gh auth status`). If unauthenticated, report the error without failing plan creation.
2. **Issue Content**:
   - Issue Title: `Plan: {plan-title}` (or comment on source issue if one exists).
   - Plan Summary: Objectives, phases roadmap, estimated effort.
   - Links: Repo-relative link to `plan.md` (and `plan.html` when `--html` is active).
   - Labels: Apply `ready to review` label after gates pass.
3. **Combined `--html --github`**: `plan.html` remains the authoritative plan. `plan.md` acts as the concise index satisfying GitHub issue link requirements.

## AgentWiki Publishing (`--wiki`)

When `--wiki` is passed, publish the reviewed plan to AgentWiki:

1. **CLI / MCP Availability**: Check `command -v agentwiki && agentwiki whoami` or MCP tool availability.
2. **Private-First Default**:
   ```bash
   agentwiki doc upload "{plan-dir}/plan.md" \
     --title "{plan-title}" \
     --category "plans" \
     --tags "plan,{repo-slug}" \
     --json
   agentwiki doc share <id> --json
   ```
3. **Public Publish**: Run `agentwiki doc publish <id>` ONLY when the user explicitly requests public visibility.
4. **HTML Site Upload**: When combined with `--html`, upload as a static site only upon explicit request:
   ```bash
   agentwiki sites upload "{plan-dir}/plan.html" --title "{plan-title}" --json
   ```
5. **Output**: Include the returned private share URL in the final handoff response.
