---
name: ak-research-prompt
description: Draft a self-contained research brief for a human or AI researcher. Use when users ask for a research prompt, research brief, or a deep-research task to hand off.
user-invocable: true
when_to_use: Invoke to write the research assignment, not to perform the research.
category: workflow
keywords: [research, brief, prompt, sources, evidence]
license: MIT
argument-hint: "<research topic | decision>"
metadata:
  author: agentkit
  version: "1.0.1"
  upstream: "Pinned MIT source archive: research-prompt@ce70edaa26247b84c2b9491a0cdb4964f65cf3a5"
---

# Research Prompt

Write a self-contained brief, structured to match its complexity, that gives a researcher enough context to
produce decision-ready, source-backed findings without a follow-up exchange.
This skill writes the brief; it does not perform the research.

## Workflow

1. Gather the decision, audience, deadline, known facts, constraints, and
   intended use from the conversation and relevant project files.
2. State the project and situation for a reader with no prior context.
3. Define one research question and the decision it will inform.
4. Add the sub-questions needed to cover the
   decision. Do not combine unrelated missions.
5. Specify include and avoid constraints, source hierarchy, contradiction
   handling, a completion bar, and the per-finding output format.
6. Return only the brief. Use one paragraph for a simple decision or when requested; use short sections for multiple questions/constraints. Do not perform the research or add a second deliverable.

## Required Brief Content

The brief must:

- lead with plain-English project context, the research goal, and the decision;
- prefer primary sources such as official documentation, repositories, papers,
  filings, and changelogs;
- treat forums and social posts as weak signals, never as factual proof;
- separate confirmed facts, inference, and unresolved uncertainty when sources
  conflict;
- require a gap round that revisits contradictions and single-source claims;
- require a source URL, specific claim, and one-line decision relevance for
  every finding; and
- require a single detailed Markdown result.

## Boundaries

- Do not manufacture facts or include secrets, private URLs, credentials, or
  personal data in a brief.
- Use ak-research, available in the engineer kit, or another research runner to
  execute the completed brief.
- Keep the brief focused on evidence and a decision, not marketing
  copy or a speculative solution.
