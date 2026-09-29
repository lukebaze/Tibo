# Poster Design (Built-in)

20-30 curated styles x 15-20 palettes x 10-14 layouts x 8-12 textures. Model-agnostic: emits text prompts only, so the prompt can be sent to Gemini Nano Banana, GPT Image, Imagen, Midjourney, or another image model.

Three axes (style, palette, texture) stay locked per call to preserve identity; layout and variation seed can change for visible variety. Five calls with the same `--style` should read as one series while still producing distinct poster compositions.

Load `references/poster-design.md` for the full guide and `references/poster-prompt-engineering.md` for prompt anatomy and model-specific tweaks.

## Poster: Search Knowledge Base

```bash
python3 scripts/poster/search.py --domain style --query "swiss editorial"
python3 scripts/poster/search.py --domain palette --query "warm earthy"
python3 scripts/poster/search.py --domain texture --query "risograph"
python3 scripts/poster/search.py --domain layout --query "centered grid"
```

## Poster: Build Brief

```bash
python3 scripts/poster/search.py --poster-brief --topic "AI Conference" --query "minimal grid"
```

## Poster: Generate Prompt

```bash
python3 scripts/poster/generate.py --topic "AI Conference"
python3 scripts/poster/generate.py --topic "AI Conference" --query "swiss" --aspect a2
python3 scripts/poster/generate.py --topic "AI Conference" --style "Swiss Editorial Grid" --seed 42
```

Pipe stdout into the selected image model. For a series, reuse `--style` and vary `--seed`.

## Poster: Rebuild Knowledge Base

```bash
# Vision analysis (resume-safe; needs GEMINI_API_KEY)
python3 scripts/poster/analyze.py --input-dir /path/to/posters

# Re-cluster + regenerate CSVs
python3 scripts/poster/cluster.py
```
