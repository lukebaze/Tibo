# Taste exemplars: typical output vs tasteful output

Each pair shows the output a model produces when it falls back to defaults, then a
tasteful version of the same content, with the reasons. Copy the reasoning, not the
exact styling: the brief decides the direction. Token names come from
`../assets/starter-tokens-*.css`.

## 1. Brand hero

Typical output:

```html
<section style="height:100vh;display:flex;flex-direction:column;align-items:center;
  justify-content:center;text-align:center;background:linear-gradient(135deg,#667eea,#764ba2)">
  <span class="badge">✨ NEW · v2.0</span>
  <h1 style="font:700 64px Inter;background:linear-gradient(90deg,#fff,#c3b5ff);
    -webkit-background-clip:text;color:transparent">Supercharge Your Workflow</h1>
  <p>Seamlessly elevate your productivity with our next-gen AI-powered platform.</p>
  <button>Get Started</button> <button>Learn More</button>
  <div class="avatars">★★★★★ Loved by 10,000+ teams</div>
</section>
```

Why it reads as generated: purple gradient, gradient text, centered stack, cliché copy
("Supercharge", "Seamlessly", "next-gen"), version badge, fake round social proof,
Inter as display type, `100vh`, five competing elements.

Tasteful version (brief: Brand; scene "operations leads reviewing shipments on a
laptop at 8am"; direction Swiss editorial; Committed color on one block):

```html
<header class="hero">
  <div class="hero__copy">
    <h1>Every shipment, one calm timeline.</h1>
    <p>Track carriers, customs and delays in a single view your whole team can read.</p>
    <a class="btn btn--primary" href="/signup">Start tracking</a>
  </div>
  <figure class="hero__visual"><img src="timeline.webp" alt="Shipment timeline with three delayed legs highlighted"></figure>
</header>
<style>
.hero { min-height: 100dvh; display: grid; grid-template-columns: 5fr 7fr;
  gap: var(--space-8); align-items: end; padding: var(--space-9) var(--gutter) var(--space-8);
  max-width: var(--container); margin-inline: auto; }
.hero h1 { font-size: var(--step-5); max-width: 12ch; }
.hero p { font-size: var(--step-1); color: var(--ink-2); margin-block: var(--space-5) var(--space-6); max-width: 34ch; }
.hero__visual { background: var(--accent-deep); border-radius: var(--radius); padding: var(--space-6); }
.btn--primary { background: var(--ink); color: var(--paper); padding: 14px 22px;
  border-radius: var(--radius-sm); transition: transform var(--dur-press) var(--ease-out); }
.btn--primary:hover { transform: translateY(-2px); }
.btn--primary:active { transform: translateY(1px); }
@media (max-width: 768px) { .hero { grid-template-columns: 1fr; align-items: start; } }
</style>
```

Why it works: a concrete headline in the user's words, one CTA, an asymmetric 5/7
grid aligned to a shared baseline, display serif against a grotesque body, the only
saturated color on the product visual, and hover that moves instead of only recoloring.

## 2. Feature section

Typical output: three equal cards, each with a rounded colored icon, a bold title and
two lines of text, all centered, with `box-shadow: 0 4px 6px rgba(0,0,0,.1)` and a
1px border.

Why it fails: every item has the same weight, so nothing is important; icon circles
are decoration; shadow plus border mixes two depth strategies; centered body text is
hard to scan.

Tasteful version: rank the features. Give the most important one a large cell with a
real screenshot, and list the rest as a compact, left-aligned definition list.

```html
<section class="features">
  <article class="features__lead">
    <h2>Delays surface before customers notice</h2>
    <p>Carrier events are compared with the promised date every 15 minutes.</p>
    <img src="delay-alert.webp" alt="Delay alert on a shipment row">
  </article>
  <dl class="features__list">
    <div><dt>Customs documents</dt><dd>Stored per shipment, shared by link.</dd></div>
    <div><dt>Carrier coverage</dt><dd>48 carriers, including regional couriers.</dd></div>
    <div><dt>Team views</dt><dd>Saved filters for each warehouse.</dd></div>
  </dl>
</section>
<style>
.features { display: grid; grid-template-columns: 7fr 5fr; gap: var(--space-8);
  padding-block: var(--section-y); }
.features__list > div { padding-block: var(--space-5); border-top: 1px solid var(--line); }
.features__list dt { font-weight: 600; }
.features__list dd { color: var(--ink-2); margin: var(--space-1) 0 0; }
@media (max-width: 768px) { .features { grid-template-columns: 1fr; } }
</style>
```

## 3. Dashboard overview

Typical output: eight KPI cards in a row with icons, green/red arrows and gradients;
below them a table with zebra stripes, centered text, every column the same width and
a raw `<select>` for filtering.

Why it fails: eight numbers compete, so none is read; color is spent on decoration
instead of state; centered numbers cannot be compared; the default select looks
unfinished and cannot be searched.

Tasteful version:

- At most four KPIs, the primary one larger; each shows value, delta and period in
  words ("+4.1% vs last week"), `tabular-nums`, no icons.
- The table is the hero: text left-aligned, numbers right-aligned, 40px rows, hairline
  separators instead of zebra stripes, a sticky header, a sortable column indicator, and
  row hover in `--surface-sunken`.
- The filter bar sits directly above the table: a searchable combobox, a date range,
  and a "Clear filters" link that appears only when a filter is active; filters are
  written to the URL.

```css
.kpis { display: grid; grid-template-columns: 2fr repeat(3, 1fr); gap: var(--space-4); }
.kpi { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg);
  padding: var(--space-5); }
.kpi__value { font-size: var(--text-xl); font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums; }
.kpi--primary .kpi__value { font-size: var(--text-2xl); }
.kpi__delta { font-size: var(--text-xs); color: var(--text-muted); }
.table th { position: sticky; top: 0; background: var(--surface); font-size: var(--text-xs);
  color: var(--text-muted); font-weight: var(--weight-medium); text-align: left; }
.table td { height: 40px; border-bottom: 1px solid var(--border); font-size: var(--text-sm); }
.table td.num, .table th.num { text-align: right; font-variant-numeric: tabular-nums; }
.table tbody tr:hover { background: var(--surface-sunken); }
```

## 4. Settings form

Typical output: a single column of twelve inputs with placeholder-only labels, a
floating "Save" button at the bottom, errors shown in an alert after submit.

Why it fails: no grouping, placeholders disappear while typing, the user cannot tell
what changed, and errors are far from their field.

Tasteful version:

- Group fields into sections of at most four, each with a title and one-line
  explanation in a left column (1/3) and the fields in the right column (2/3).
- Visible labels above inputs, helper text below, validation on blur with the message
  under the field (`aria-describedby`).
- A sticky footer appears only when there are unsaved changes: "You have unsaved
  changes" with "Discard" and "Save changes"; saving shows a pressed state, then a toast.

```css
.settings-section { display: grid; grid-template-columns: 1fr 2fr; gap: var(--space-7);
  padding-block: var(--space-7); border-bottom: 1px solid var(--border); }
.field { display: grid; gap: var(--space-2); }
.field + .field { margin-top: var(--space-5); }
.field label { font-weight: var(--weight-medium); }
.field__help { font-size: var(--text-xs); color: var(--text-muted); }
.field__error { font-size: var(--text-xs); color: var(--danger); }
.input { height: var(--control-h); padding-inline: var(--space-3); border: 1px solid var(--border-strong);
  border-radius: var(--radius-md); background: var(--surface);
  transition: border-color var(--dur) var(--ease-out), box-shadow var(--dur) var(--ease-out); }
.input:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.save-bar { position: sticky; bottom: 0; display: flex; justify-content: flex-end; gap: var(--space-3);
  padding: var(--space-3) var(--space-6); background: var(--surface); border-top: 1px solid var(--border); }
@media (max-width: 768px) { .settings-section { grid-template-columns: 1fr; gap: var(--space-4); } }
```

## The pattern behind all four

1. Rank the content, then give the top item visibly more space, size or color.
2. Replace decoration (icons in circles, gradients, badges) with real content.
3. Spend color on meaning: one accent for action, selection or state.
4. Align to a grid and a shared baseline; left-align text, right-align numbers.
5. Group with space first, lines second, boxes last.
6. Write copy in the user's words about their outcome.
