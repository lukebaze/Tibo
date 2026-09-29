---
name: ak:pptx
description: Create, edit, analyze .pptx PowerPoint files. Use for presentations, slides, layouts, speaker notes, template modification, content extraction, slide generation.
user-invocable: true
when_to_use: "Invoke for presentation deck creation, edits, or extraction."
category: multimedia
keywords: [pptx, powerpoint, slides, office]
license: Proprietary. LICENSE.txt has complete terms
argument-hint: "[path] [create|edit|extract]"
metadata:
  author: agentkit
  version: "1.1.1"
---

# PowerPoint documents

Choose create, template, edit or extract before loading detail. Preserve template masters,
notes, relationships and untouched elements. Match layout to content; a dense table can
use a full slide and is not forced into two columns.

| Intent | Load |
|---|---|
| Extract/analyze | `references/extract.md` |
| Create without template | `references/create.md` then full `html2pptx.md` |
| Use template | `references/template-workflow.md` |
| Edit | `references/edit.md` then full `ooxml.md` |
| Render/dependencies | `references/render-and-dependencies.md` |

Keep full format-guide reads until consumer validation supports narrowing them. Validate
XML when editing; render and inspect every output slide for loss, overlap, clipping and
contrast. Compare slide count, notes and expected content; report missing visual checks.
