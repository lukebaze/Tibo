# Project-Specific Compliance Rules — Worked Example

The "Project-specific compliance" section in SKILL.md is intentionally generic — every project has different architecture patterns, ID conventions, SQL store rules, and UI compliance requirements.

This reference is a **worked example** from a real production project (Go gateway service + React/Tailwind admin UI) showing how to encode project-specific reviewer rules. Adapt the pattern in your repository's existing instruction or standards authority, then reference that authority from the SKILL.md "Project-specific compliance" section.

The reviewer should adapt these rules to *your* project — do not flag PRs in unrelated codebases for not following these specific conventions.

---

## Example: Architecture patterns

**Cache invalidation goes through the pubsub pattern**:

```go
msgBus.Broadcast(bus.Event{
    Name:    protocol.EventCacheInvalidate,
    Payload: bus.CacheInvalidatePayload{Kind: ..., Key: ...},
})
```

Do NOT thread direct references to cache structs (e.g. `*ContextFileInterceptor`) through constructors. Subscribers in `cmd/gateway_managed.go` handle dispatch to the correct cache layer. See `internal/http/agents.go` `emitCacheInvalidate()` for the canonical pattern.

**Why this is a project-specific rule**: violating it works locally (cache gets invalidated) but breaks when the service runs multi-instance behind a load balancer (only the receiving instance's cache clears). The pubsub pattern fans out via the message bus.

**Lesson for your project**: identify the patterns where the "obvious" implementation works in dev but breaks in production. Encode them.

---

## Example: ID scoping

`store.UserIDFromContext(ctx)` returns DIFFERENT values depending on context:
- **In DM**: individual user ID (e.g. `"123456"`)
- **In group chat**: group-scoped compound ID (e.g. `"group:telegram:-1002541239372"`), composed in `gateway_consumer.go`

The individual sender is available separately via `store.SenderIDFromContext(ctx)`.

When reviewing code that uses UserID, verify:
1. Uses the correct ID type for its purpose — `UserID` for scoping/isolation, `SenderID` for identifying the actual person
2. Group chat behavior is correct — all group members share the same UserID
3. Code that filters/stores by `user_id` works correctly with the `"group:channel:chatID"` format

**Lesson for your project**: if your IDs change shape based on context, document it here. Reviewers can't catch this from the diff alone.

---

## Example: SQL store safety

When the PR touches `store/pg/*.go`, migrations, or any DB queries:

- All user inputs go through parameterized queries (`$1, $2, ...`) rather than string concatenation or `fmt.Sprintf`, because a concatenated SQL value is an injection path
- Queries avoid N+1 patterns and unnecessary full table scans
- WHERE clauses, JOINs, and ORDER BY columns use existing indices; cross-check the migration files for what is available
- Check `rows.Err()` after every `for rows.Next()` loop, since Go `database/sql` surfaces iteration errors only there
- Nullable columns take pointer types (`*string`, `*time.Time`, etc.) in Scan destinations

**Lesson for your project**: SQL store conventions are often the highest-leverage place to encode rules — bugs here cost production data.

---

## Example: i18n compliance

- New user-facing strings in Go code use `i18n.T(locale, i18n.MsgXxx, args...)`; no hardcoded English in error responses
- New user-facing strings in React components use `t("namespace.key")` from `useTranslation()`; no hardcoded English in JSX
- New i18n keys are added to all 3 locale files (en, vi, zh) for both backend (`internal/i18n/catalog_{en,vi,zh}.go`) and frontend (`ui/web/src/i18n/locales/{en,vi,zh}/`)
- `slog` messages and `console.log` stay English (internal logs, not user-facing)

**Lesson for your project**: if you support multiple locales, "added a string in English only" is a regression. Encode the catalog paths.

---

## Example: Web UI compliance (React + Tailwind + Radix)

When the PR touches the web UI:

- Use `h-dvh` instead of `h-screen`, because `h-screen` breaks on mobile (content hides behind browser chrome / virtual keyboard)
- All `<input>`, `<textarea>`, `<select>` use `text-base md:text-sm` (16px mobile), since a font-size below 16px triggers iOS Safari auto-zoom on focus
- Edge-anchored elements (app shell, sidebar, toasts, chat input) use `safe-top`, `safe-bottom`, `safe-left`, `safe-right` for notched devices
- Icon buttons need a ≥44px touch target on touch devices (CSS `@media (pointer: coarse)` with `::after` pseudo-elements)
- Wrap `<table>` in `<div className="overflow-x-auto">` with `min-w-[600px]` on the table
- Grid layouts are mobile-first: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-N`, not a fixed `grid-cols-N` without a mobile breakpoint
- Dialogs: full-screen on mobile (`max-sm:inset-0`), centered on desktop (`sm:max-w-lg`) — follow pattern in `ui/dialog.tsx`
- Scrollable areas use `overscroll-contain`, which prevents background scroll bleed
- Landscape phone: top bars should use `landscape-compact` class to reduce padding (`max-height: 500px`)
- Portal dropdowns in dialogs using `createPortal(content, document.body)` add `pointer-events-auto`, because Radix Dialog sets `pointer-events: none` on body. Radix-native portals (Select, Popover) handle this automatically
- Timezone: charts use `formatBucketTz()` from `lib/format.ts` with `Intl.DateTimeFormat`; no `date-fns-tz` dependency
- Package manager: `pnpm`, not `npm`, for `ui/web/`
- File size: individual component files should stay under 200 lines — split into focused modules if exceeding

**Lesson for your project**: encode mobile-first conventions, accessibility minimums, safe-area handling, and package-manager rules. These are easy to forget and tedious to enforce manually.

---

## How to encode project-specific rules in your own repo

1. Follow the repository's instruction and documentation navigation to find the authority that owns review standards; if none exists, choose a location consistent with the project's conventions
2. Reference them from your project's review instructions
3. Update them when patterns change — stale rules generate false-positive findings
4. Cross-check: when the reviewer cites a rule, the path/file referenced must still exist. Move with the code

The reviewer is only as good as the rules. Invest here.
