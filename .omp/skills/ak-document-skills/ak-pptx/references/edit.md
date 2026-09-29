## Editing an existing PowerPoint presentation

When edit slides in an existing PowerPoint presentation, you need to work with the raw Office Open XML (OOXML) format. This involves unpacking the .pptx file, editing the XML content, and repacking it.

### Workflow
1. Read [`ooxml.md`](../ooxml.md) (~500 lines) in full, without a range limit: the OOXML structure guidance and the editing workflows are spread across the whole file.
2. Unpack the presentation: `python ooxml/scripts/unpack.py <office_file> <output_dir>`
3. Edit the XML files (primarily `ppt/slides/slide{N}.xml` and related files)
4. Validate immediately after each edit and fix the errors before continuing, because a later edit on invalid XML is far harder to diagnose: `python ooxml/scripts/validate.py <dir> --original <file>`
5. Pack the final presentation: `python ooxml/scripts/pack.py <input_directory> <office_file>`
