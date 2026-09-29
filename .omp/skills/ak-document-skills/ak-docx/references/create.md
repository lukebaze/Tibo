## Creating a new Word document

When creating a new Word document from scratch, use **docx-js**, which allows you to create Word documents using JavaScript/TypeScript.

### Workflow
1. Read [`docx-js.md`](../docx-js.md) (~500 lines) in full, without a range limit: the syntax, formatting rules, and known pitfalls are spread across the whole file, and a partial read produces documents that Word refuses to open.
2. Create a JavaScript/TypeScript file using Document, Paragraph, TextRun components (You can assume all dependencies are installed, but if not, refer to the dependencies section below)
3. Export as .docx using Packer.toBuffer()
