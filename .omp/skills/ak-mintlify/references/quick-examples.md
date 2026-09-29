# Illustrative Mintlify examples

Check the installed version and project schema before using these examples.

## Common Patterns

**Basic docs.json:**
```json
{
  "theme": "mint",
  "name": "My Docs",
  "colors": {
    "primary": "#0D9373"
  },
  "navigation": [
    {
      "group": "Getting Started",
      "pages": ["introduction", "quickstart"]
    }
  ]
}
```

**MDX page with components:**
```mdx
---
title: "Getting Started"
description: "Quick introduction"
---

<Note>Important information</Note>

<CodeGroup>
```bash
npm install
```

```python
pip install
```
</CodeGroup>

<Steps>
  <Step title="Install">Install the package</Step>
  <Step title="Configure">Set up config</Step>
</Steps>
```
