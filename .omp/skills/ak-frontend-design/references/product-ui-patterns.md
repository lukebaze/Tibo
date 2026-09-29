# Product UI patterns

Concrete specifications for app, dashboard, admin and settings surfaces. Values assume
`../assets/starter-tokens-product.css`; map them to the project's tokens when they exist.
The experience standards these patterns serve are in `ux-polish-standards.md`.

## App shell

- Sidebar 240px (collapsible to 56px icons with tooltips), top bar 56px, content max
  1280px with 24–32px gutters. On tablet the sidebar collapses; on mobile it becomes a
  drawer opened from the top bar.
- Sidebar groups: primary destinations (≤ 7), a divider, secondary (settings, help).
  Active item: `--accent-soft` background, `--text` color, medium weight; hover:
  `--surface-sunken`. Icons 16–18px, one stroke width.
- Top bar right side, in order: search trigger showing `⌘K`/`Ctrl K`, notifications
  bell with unread dot, account avatar menu (profile, settings, theme, what's new,
  sign out).
- Build the shell as a grid with exactly the sidebar and the main column as in-flow
  children. Drawer backdrops, toasts and overlays are `position: fixed` at every
  breakpoint or live outside the grid; an empty in-flow element inside the grid takes
  a track and pushes the main column into the sidebar's slot.

## Page header

- Title (`--text-xl`, semibold), optional one-line description in `--text-muted`,
  primary action button on the right. Breadcrumbs above the title only at depth ≥ 2.
- Tabs for sibling views sit under the header, underline style, and are reflected in
  the URL.

## Buttons

- Heights 28/36/44px; horizontal padding 12/14/18px; label ≤ 3 words, verb first.
- Variants: primary (accent fill, one per view), secondary (surface + border), ghost
  (text only, for toolbars), danger (only for destructive confirmations).
- Loading: keep the width, swap the label for a spinner plus "Saving…"; disable double submit.
- Icon-only buttons need a tooltip and `aria-label`.

## Tables

- Row height 40px (compact 32px, comfortable 48px); cell padding 12–16px horizontal.
- Text left, numbers and dates right with `tabular-nums`; status as a small dot plus a
  word, not color alone.
- Sticky header; sortable columns show an arrow only on the sorted column and on hover.
- Row hover `--surface-sunken`; row click opens a detail drawer or page; row actions
  appear in a trailing "⋯" menu, visible on hover and always on touch.
- Selection checkbox column enables a bulk-action bar that replaces the filter bar.
- Pagination or "Load more" with the total count; preserve page, sort and filters in the URL.
- Long text truncates with an ellipsis and a tooltip; never wraps into tall rows.
- On mobile, convert rows to stacked cards showing the 3–4 most important fields.
- Two-line cells (name over detail) use block elements or a flex column with a gap, so
  the lines never run together as "Elena VasquezCleaning".

## Filters and search

- Filter bar directly above the content it filters: search input first, then
  filter chips or comboboxes, then "Clear filters" when any filter is active.
- Search input debounced 150–250ms, shows a spinner in the field while loading, and
  highlights matches in results.
- Comboboxes (not raw `<select>`) for lists longer than about seven options: type to
  filter, arrow keys to move, Enter to select, clear button, "No results for X".
- Date inputs use a styled date-range picker with presets (Today, Last 7 days, This month).

## Forms

- Visible label above each field; helper text below; required fields marked, or
  optional fields marked, consistently, never both.
- Fields in groups of ≤ 4 with a group title; two-column layout only for short,
  related fields (first and last name).
- Validate on blur and on submit; message under the field with `aria-describedby`;
  focus the first invalid field on submit.
- Inputs 36–40px high, `--text-md` (16px on mobile to avoid zoom), 1px `--border-strong`,
  focus ring `0 0 0 3px var(--accent-soft)` plus accent border.
- Unsaved-change guard: sticky save bar appears when dirty; warn before navigating away.

## Overlays

- Prefer inline editing or a side drawer (480–560px) for detail and edit views;
  reserve centered modals (≤ 560px wide) for short confirmations and focused tasks.
- Every overlay: focus trap, Escape to close, restore focus to the trigger, scroll
  lock, and an enter transition of 180–240ms (fade plus 4–8px translate or 0.98 scale).
- Destructive confirmation names the object and consequence: "Delete 'Q3 report'?
  This removes 14 linked charts." The confirm button repeats the verb: "Delete report".
- Dropdowns and popovers render in a portal or top layer so parent overflow never clips them.
- Closed overlays are invisible: style a native `<dialog>` only under `dialog[open]`
  (setting `display` on a closed dialog shows it on the page), and hide custom overlays
  with `display: none` or `hidden` until opened.

## Feedback

- Toasts bottom-right (bottom-center on mobile), 4–6s, pause on hover, with Undo for
  reversible actions; never more than three stacked.
- Skeletons match the final layout for loads over ~300ms; no spinner for faster loads.
- Optimistic updates for low-risk actions, rolled back with an error toast on failure.
- Inline banners for page-level problems (connection lost, trial ending), dismissible
  when not critical.

## Empty, loading and error states

- Empty: an illustration is optional; a one-line explanation and the first action are
  required ("No invoices yet. Create your first invoice.").
- No-results: echo the query and offer to clear filters.
- Error: say what failed in plain words, offer Retry, and keep the user's input.

## Command palette

- Opens with `Ctrl/Cmd+K` and from the search trigger; 560–640px wide, 20vh from top.
- Sections: recent, pages, entities (search results), actions; each item shows an icon,
  label, context and shortcut if any.
- Fuzzy matching, arrow-key navigation, Enter to run, Escape to close; results appear
  within 100ms for local items and show a loading row for remote ones.

## Notifications and what's new

- Notification panel: grouped by day, unread items marked, "Mark all as read", each
  item links to its object; empty state says "You're all caught up".
- What's new: a changelog entry in the account menu or help menu with a dot when a
  release is unseen; each entry has version, date and 1–3 plain-language bullets.

## Charts

- One chart answers one question stated in its title ("Revenue by week, last 12 weeks").
- Muted gridlines, labeled axes with units, tooltips with exact values, the accent for
  the primary series and grays for comparison series; legends only when two or more series.
- Use the installed data-visualization owner, when present, for palette and chart rules.

## Density and rhythm

- Default spacing: 8px between related controls, 16px inside cards, 24px between cards,
  32–48px between page regions.
- Keep one primary action per view, at most four KPIs above the fold, at most seven
  sidebar destinations; move the rest behind progressive disclosure.
