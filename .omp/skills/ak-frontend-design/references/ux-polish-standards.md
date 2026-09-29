# UX polish standards: "Don't make me think"

A user should understand and use every screen and feature without stopping to think.
Everything is prepared for them, guidance is clear, and the experience feels smooth,
careful and refined, so the user can sense the craft and care behind the product.
Use this list to audit existing UI and as the bar for new UI; `product-ui-patterns.md`
has the concrete component specifications that meet it. The items are the
minimum, not the full list; keep looking for friction beyond them.

## State and continuity

- Reload, back/forward and shared links keep state: filters, sort, tabs, pagination,
  selected item and open panel live in the URL or persisted storage.
- Drafts and long forms survive accidental navigation or reload; failed submits keep input.
- Scroll position is restored when returning to a list.

## Inputs and controls

- No unstyled browser-default controls (raw `<select>`, date, file or number inputs) in
  product surfaces; use the design system's styled, accessible equivalents.
- Dropdowns with more than a handful of options are searchable comboboxes: pick from the
  list or type to filter, with keyboard navigation and a clear empty result.
- Sensible defaults are preselected; required vs optional is obvious; validation is
  inline, timely and says how to fix the problem.

## Search and navigation

- Search shows suggestions as the user types and returns results fast (debounced, with
  a loading hint); highlight matches and handle no-results with a next step.
- A `Ctrl/Cmd+K` command palette reaches pages, entities and common actions.
- Navigation shows where the user is (active state, breadcrumbs for depth) and the
  primary action of each page is obvious.

## Information architecture

- Account, profile, settings and sign-out sit in one predictable account menu.
- Notifications have a clear entry point, unread state, grouping and mark-as-read.
- A changelog or "What's new" surface shows recent version updates.
- Dashboards lead with the information the user needs most; secondary detail is one
  step away, not competing for attention.
- Empty states explain what belongs there and offer the first action.

## Layout and spacing

- Consistent spacing scale from tokens; elements never touch or crowd each other.
- Group related items, separate unrelated ones with whitespace instead of more borders.
- Avoid dense walls of controls; progressive disclosure for advanced options.
- No overflow, clipped text, awkward wrapping or misaligned edges at desktop, tablet
  or mobile widths; touch targets at least 44×44 px on touch devices.

## Feedback and motion

- Every interactive element has hover, active, focus-visible and disabled states.
- Actions give immediate feedback: pressed state, optimistic update or spinner, then a
  success or error toast with undo where reasonable.
- Loading uses skeletons that match the final layout; no layout shift on data arrival.
- Micro-animations and transitions (150–300 ms, eased) for opening panels, switching
  tabs, list changes and hover; they convey meaning and respect `prefers-reduced-motion`.

## Guidance and copy

- Labels and buttons use the user's words and name the outcome ("Create project", not "Submit").
- First-run onboarding, tooltips or inline hints for anything non-obvious.
- Errors say what happened and what to do next; destructive actions confirm and name
  the consequence.

## Finish and care

- Consistent icons, radii, shadows, typography and color across pages.
- Details are finished: favicon, page titles, truncation with tooltips, formatted
  numbers and dates, keyboard shortcuts where power users expect them, dark mode
  parity when supported.
- Nothing feels like a default left in place; each screen should look deliberate.
