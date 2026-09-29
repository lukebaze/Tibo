---
name: ak-interview-docs
description: Extract a user's vision and decisions into durable project documents through a guided interview. Use for README, ADR, strategy, principles, and structured-doc authoring.
user-invocable: true
when_to_use: Invoke when the user's answers, not AI proposals or code inspection, should become the document.
category: workflow
keywords: [interview, documentation, adr, strategy, vision]
license: MIT
argument-hint: "<vision | document-path | topic>"
metadata:
  author: agentkit
  version: "1.0.1"
  upstream: "Pinned MIT source archive: brain-to-docs and interview-style-doc-building@ce70edaa26247b84c2b9491a0cdb4964f65cf3a5"
---

# Interview Docs

Turn the user's own knowledge, taste, and decisions into maintained documents.
This skill does not invent content, prioritize an unordered user list, or derive
documentation from source code.

## Select a Mode

- Use vision mode for project vision, README direction, and ADR decisions.
- Use structured-doc mode for one user-authored document such as principles,
  strategy, reviews, or a framework.
- If the request fits both modes, ask one concise question before writing.

## Vision Mode

1. Read README.md and repository docs navigation to locate the existing vision/decision owner. Do not assume docs/adr exists.
2. Ask a focused batch about unresolved vision decisions; skip questions answered by the brief or earlier replies. Preserve any user-requested interview cadence.
3. After every answer, re-read the affected document and patch the user’s words
   into the existing owning document before processing the next answer.
4. Keep README.md to vision and record confirmed decisions in the repository-selected owner. Use ADR files only when that is the established convention; never promote tentative opinions to decisions.
5. Continue until the user ends the interview. Keep replies concise and in
   plain English.

## Structured-Doc Mode

1. Read nearby documents and create a minimal skeleton once.
2. Ask exactly one specific, open question.
3. Wait for the answer, re-read the target section, and patch the document
   before asking the next question.
4. Treat a user-provided list as an unordered set. Ask explicitly before
   assigning rank, sequence, or priority.
5. Preserve user wording and edits. Never overwrite an existing document or
   add speculative sections.

## Boundaries and Safety

- Use ak-brainstorm when the AI should propose options; use ak-docs when
  documentation should be derived from code.
- Do not write secrets, personal data, or credentials into docs.
- Never use an ADR to make an unapproved architectural decision. Record only a
  decision the user has explicitly made.
