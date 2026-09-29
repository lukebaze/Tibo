---
name: ak-agentkit
description: "Task router for AgentKit installs. Classifies the task, activates the right installed skills, chains them into the shortest workflow that fits, and spawns installed subagents at defined trigger points to raise output quality. Use at the start of multi-step, multi-domain, or ambiguous work, or when unsure which skill or agent applies."
user-invocable: true
when_to_use: "Invoke at the start of multi-step or multi-domain work, when the right skill is unclear, when skills need sequencing into a workflow, or when deciding whether and when to spawn subagents."
category: meta
keywords: [routing, dispatch, skills, chaining, subagents, delegation, workflow, quality]
argument-hint: "[task to route]"
metadata:
  author: agentkit
  version: "1.0.2"
---

# AgentKit router

Return one concrete route to an installed owner, then let that owner execute. Reuse the
accepted outcome, constraints, non-goals, acceptance criteria and current evidence.

## Proportionality gate

A named skill goes directly to that skill. A single obvious domain goes directly to its
owner. Pure conversation needs no workflow. For ambiguous or multi-domain work, match the
live installed catalog; never infer a skill or agent from a different kit or remembered roster.

Use `references/task-taxonomy.md` only for unclear classification and
`references/chaining-patterns.md` when more than one owner is actually needed. Select one
primary owner per intent, pass existing artifacts and stop routing. Do not repeat outcome,
inspection, planning or verification gates that the owner already completed on current state.

Risk determines verification: bounded reversible work uses relevant checks and direct review;
cross-module/public-contract/security work needs broader affected checks and independent
review where required. Reuse exact-revision evidence, never scores as proof. Delegate only
when available, authorized, useful and scoped; `references/subagent-timing.md` supplies the
contract. Missing optional agents permits inline work with honest limitations.

Headless cross-runtime work belongs to an installed orchestration capability. Missing owners
fall back to native capabilities; report the gap instead of inventing an invocation. On a
failed route, change approach from evidence and resume useful work. Ask only for a material
missing decision or authorization beyond the current scope. Report outcome and verification.
