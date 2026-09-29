---
name: ak:pdf
description: Extract text/tables, create, merge, split PDFs. Fill PDF forms programmatically. Use for PDF processing, generation, form filling, document analysis, batch operations.
user-invocable: true
when_to_use: "Invoke for PDF extraction, generation, forms, or batch edits."
category: multimedia
keywords: [pdf, extract, text, pages]
license: Proprietary. LICENSE.txt has complete terms
argument-hint: "[path] [extract|create|merge|split|fill]"
metadata:
  author: agentkit
  version: "1.1.1"
---

# PDF processing

Choose the operation and validate its output:

| Operation | Recipe | Acceptance |
|---|---|---|
| Extract text/tables | `references/extract-recipes.md` | Expected content, table alignment, page coverage |
| Create | `references/create-recipes.md` | Page size/count, readable content and rendered layout |
| Merge/split/rotate | `references/page-recipes.md` | Exact page count/order/orientation |
| Fill forms | `forms.md` | Correct values and retained fillable fields |
| OCR / watermark / images | `references/common-tasks.md` | Scans recognized, content/layout retained |
| CLI operations | `references/cli-recipes.md` | Same operation-specific checks |

An empty extraction from scanned pages requires visual inspection/OCR, not a conclusion of
no content. Preserve inputs and templates; inspect rendered pages for layout-sensitive work.
Use `reference.md` for advanced library/troubleshooting details. Report unavailable tools or
unverified dimensions without fabricating successful checks.
