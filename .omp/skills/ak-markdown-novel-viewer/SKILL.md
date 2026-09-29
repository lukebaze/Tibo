---
name: ak-markdown-novel-viewer
description: View markdown files in a calm, book-like reader served via HTTP. Use for long-form content review — RFCs, runbooks, design docs, reports, specs, novels — anywhere you want a distraction-free reading mode in the browser.
user-invocable: true
when_to_use: "Invoke to read long markdown comfortably in the browser."
category: media
keywords: [markdown, viewer, reading, preview]
argument-hint: "[file-or-directory]"
metadata:
  author: agentkit
  version: "1.1.1"
---

# Markdown novel viewer

Open a Markdown file or directory in the local reader. Resolve and quote paths, including
Windows paths containing spaces. HTML generation belongs to `ak:preview --html`.

1. Reuse a known owned server for this project; inspect its process/port before starting one.
2. Verify Node and required `marked`, `highlight.js`, `gray-matter` dependencies. Run
   `npm install` in this skill directory only if dependencies are missing.
3. Run `node scripts/server.cjs --file "<absolute-path>" --open` or use `--dir` for a directory.
   Keep localhost binding unless remote access is explicitly requested. Return the actual URL
   printed by the server rather than assuming a port.
4. Record process PID, port and project. When done, stop only the server this task owns.
   `node scripts/server.cjs --stop` stops all viewer servers: use it only if all are owned by
   this task; otherwise stop the verified individual PID. Never terminate another session.

For rendering features, theme changes, routes or failures load
`references/development-and-troubleshooting.md`. For Mermaid content use
`references/mermaid-diagrams.md`. Confirm the requested file loads, then return its URL.
