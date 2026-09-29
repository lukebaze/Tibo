## Features

### Novel Theme
- Warm cream background (light mode)
- Dark mode with warm gold accents
- Libre Baskerville serif headings
- Inter body text, JetBrains Mono code
- Maximum 720px content width

### Mermaid.js Diagrams
- Auto-renders `mermaid` code blocks as diagrams
- Theme-aware (light/dark mode support)
- Full-width toggle: Click diagram to expand/collapse
- Error display with source preview for debugging

### Directory Browser
- Clean file listing with emoji icons
- Markdown files link to viewer
- Folders link to sub-directories
- Parent directory navigation (..)
- Light/dark mode support

### Focused Reader Mode
- **Auto-hide header**: Header hides on scroll down, shows on scroll up
- **Progress bar**: Always-visible horizontal progress bar tracks reading position
- **Distraction-free**: Minimal UI that gets out of the way while reading
- **Smooth transitions**: Gentle animations for header show/hide

### Plan Navigation
- Auto-detects plan directory structure
- Accordion sidebar with status badges (✓ complete, ⏳ in progress)
- Previous/Next navigation buttons
- Auto-hide header with progress bar on scroll
- Mobile FAB (floating action button) for navigation
- Bottom sheet sidebar for mobile devices

### Keyboard Shortcuts

**First-time toast**: Shows "Press ? for keyboard shortcuts" on first visit (auto-dismisses after 5s)

**Available shortcuts:**
- `?` - Show keyboard shortcuts cheatsheet (full-screen overlay)
- `T` - Toggle theme (light/dark)
- `S` - Toggle sidebar (desktop)
- `←` / `→` - Navigate previous/next phase
- `Esc` - Close sidebar (mobile) or cheatsheet modal

**Cheatsheet modal**: Press `?` to see all shortcuts in a full-screen overlay with backdrop blur. Close with `Esc`, `×` button, or backdrop click.

### Mobile Optimization
- **FAB (Floating Action Button)**: Fixed bottom-right button for navigation on mobile
- **Bottom sheet**: Slide-up sidebar with touch gestures
- **Touch-friendly**: Larger tap targets, swipe gestures
- **Responsive breakpoint**: Switches at 768px viewport width

## CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `--file <path>` | Markdown file to view | - |
| `--dir <path>` | Directory to browse | - |
| `--port <number>` | Server port | 3456 |
| `--host <addr>` | Host to bind (`0.0.0.0` for remote) | localhost |
| `--open` | Auto-open browser | false |
| `--background` | Run in background | false |
| `--stop` | Stop all servers | - |

## Architecture

```
scripts/
├── server.cjs               # Main entry point
└── lib/
    ├── port-finder.cjs      # Dynamic port allocation
    ├── process-mgr.cjs      # PID file management
    ├── http-server.cjs      # Core HTTP routing (/view, /browse)
    ├── markdown-renderer.cjs # MD→HTML conversion
    └── plan-navigator.cjs   # Plan detection & nav

assets/
├── template.html            # Markdown viewer template
├── reader.js                # Client-side interactivity
├── novel-theme.css          # Entry stylesheet (@imports styles/ modules)
├── directory-browser.css    # Directory browser styles
└── styles/                  # Theme modules (must all ship; entry @imports these)
    ├── novel-theme-variables.css  # Light/dark tokens, fonts, content width
    ├── novel-theme-base.css       # Reset, body, theme/font-size data attrs
    ├── novel-theme-header.css     # Auto-hide header, progress bar
    ├── novel-theme-sidebar.css    # Accordion sidebar, status badges
    ├── novel-theme-content.css    # Article typography, lists, images
    ├── novel-theme-components.css # Tables, code, links, buttons
    ├── novel-theme-mermaid.css    # Mermaid wrappers
    ├── novel-theme-overlays.css   # Toast, cheatsheet, FAB, bottom sheet
    └── novel-theme-responsive.css # Mobile breakpoint
```

## HTTP Routes

| Route | Description |
|-------|-------------|
| `/view?file=<path>` | Markdown file viewer |
| `/browse?dir=<path>` | Directory browser |
| `/assets/*` | Static assets |
| `/file/*` | Local file serving (images) |

## Dependencies

- Node.js built-in: `http`, `fs`, `path`, `net`
- npm: `marked`, `highlight.js`, `gray-matter` (installed via `npm install`)

## Customization

### Theme Colors (CSS Variables)

Light mode variables in `assets/styles/novel-theme-variables.css`:
```css
--bg-primary: #faf8f3;      /* Warm cream */
--accent: #8b4513;          /* Saddle brown */
```

Dark mode:
```css
--bg-primary: #1a1a1a;      /* Near black */
--accent: #d4a574;          /* Warm gold */
```

### Content Width
```css
--content-width: 720px;
```

## Remote Access

To access from another device on your network:

```bash
# Start with 0.0.0.0 to bind to all interfaces
node scripts/server.cjs --file ./README.md --host 0.0.0.0 --port 3456
```

When using `--host 0.0.0.0`, the server auto-detects your local network IP and includes it in the output:

```json
{
  "success": true,
  "url": "http://localhost:3456/view?file=...",
  "networkUrl": "http://192.168.2.75:3456/view?file=...",
  "port": 3456
}
```

Use `networkUrl` to access from other devices on the same network.

## Troubleshooting

**Port in use**: Server auto-increments to next available port (3456-3500)

**Images not loading**: Ensure image paths are relative to markdown file

**Server won't stop**: Check `/tmp/md-novel-viewer-*.pid` for stale PID files

**Remote access denied**: Use `--host 0.0.0.0` to bind to all interfaces

## Mermaid.js Diagrams

Load `references/mermaid-diagrams.md` when a document contains mermaid
blocks: fence usage, supported diagram types, validation, fixes for common
syntax errors, and the viewer debug output.
