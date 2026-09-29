# CTI Expert HTML Mirror Contract (`--format html`)

When `--format html` is specified, `ak:cti-expert` emits a self-contained, offline editorial HTML mirror of the investigation report (`CTI-REPORT-<CASE-ID>-<YYYY-MM-DD>.html`).

## Shared Composition Contract

Follow the shared HTML composition contract in `../ak-preview/references/html-skill-composition.md`:
1. **Activate `ak:frontend-design` first** for layout, typography, responsive containers, dark/light styles, and accessibility.
2. **Activate `ak:diagram` second** (when installed) to compile typed JSON IR for threat models, entity graphs, and attack sequence flows.
3. **Fallback**: If `ak:diagram` is absent, produce clean semantic inline SVG/CSS with `<title>` and `<desc>`.

## Invariants & Offline Security

1. **Zero Outbound Requests**: All CSS, JS, and SVG assets must be inlined or vendored. No external CDNs (including AntV or Chart.js CDN links).
2. **Evidence & Confidence Levels**: Diagrams and charts must distinguish observed indicators from analyst inferences.
3. **Data Redaction**: Never leak sensitive case data, internal IP addresses, or private credentials in the HTML artifact.
4. **Offline Viewing**: The artifact must open directly from disk via `file://` with no network dependencies.
