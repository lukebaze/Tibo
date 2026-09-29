# Icon Design (Built-in)

15 styles, 12 categories. Gemini 3.1 Pro Preview generates SVG text output.

## Icon: Generate Single Icon

```bash
python3 scripts/icon/generate.py --prompt "settings gear" --style outlined
python3 scripts/icon/generate.py --prompt "shopping cart" --style filled --color "#6366F1"
python3 scripts/icon/generate.py --name "dashboard" --category navigation --style duotone
```

## Icon: Generate Batch Variations

```bash
python3 scripts/icon/generate.py --prompt "cloud upload" --batch 4 --output-dir ./icons
```

## Icon: Multi-size Export

```bash
python3 scripts/icon/generate.py --prompt "user profile" --sizes "16,24,32,48" --output-dir ./icons
```

## Icon: Top Styles

| Style | Best For |
|-------|----------|
| outlined | UI interfaces, web apps |
| filled | Mobile apps, nav bars |
| duotone | Marketing, landing pages |
| rounded | Friendly apps, health |
| sharp | Tech, fintech, enterprise |
| flat | Material design, Google-style |
| gradient | Modern brands, SaaS |

**Model:** `gemini-3.1-pro-preview` — text-only output (SVG is XML text). No image generation API needed.
