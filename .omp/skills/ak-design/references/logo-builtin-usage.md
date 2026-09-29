# Logo Design (Built-in)

55+ styles, 30 color palettes, 25 industry guides. Gemini Nano Banana models.

## Logo: Generate Design Brief

```bash
python3 scripts/logo/search.py "tech startup modern" --design-brief -p "BrandName"
```

## Logo: Search Styles/Colors/Industries

```bash
python3 scripts/logo/search.py "minimalist clean" --domain style
python3 scripts/logo/search.py "tech professional" --domain color
python3 scripts/logo/search.py "healthcare medical" --domain industry
```

## Logo: Generate with AI

Generate logo images on a white background, so the mark can be cut out and placed on any surface later.

```bash
python3 scripts/logo/generate.py --brand "TechFlow" --style minimalist --industry tech
python3 scripts/logo/generate.py --prompt "coffee shop vintage badge" --style vintage
```

When a script fails, fix the script rather than working around it.

After generation, ask the user about an HTML preview with the `ask_user capability`. If yes, invoke `/ui-ux-pro-max` for the gallery.
