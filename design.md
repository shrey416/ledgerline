# Ledgerline design system — mandatory UI contract

## 1. Visual direction: the financial workbench

Make Ledgerline feel like a mature instrument panel and a carefully typeset ledger. Interpret “tacky, satisfying” as tactile and assertive: crisp divisions, an ink-colored navigation rail, warm paper surfaces, precise tabular figures, compact controls, decisive accent blocks and mechanical alignment. The result should have personality without decorative clutter. Every screen must use the same tokens, primitives, spacing, table behavior and motion language.

The defining motif is a **ledger rail**: a 3px semantic stripe beside a record or summary, a compact uppercase section label, and a hairline baseline. Use it for budgets, upcoming charges, claim stages and dashboard sections. Distinctiveness comes from composition and typography, not custom AI artwork. No gradients, glassmorphism, glow, animated ambient blobs, giant empty hero cards, pill buttons, arbitrary illustrations or generated icon paths. Standard icon/chart libraries may render SVG internally; the prohibition is on inventing ad hoc illustration/icon SVGs.

## 2. Frontend stack

React and TypeScript strict mode; Vite; React Router; Tailwind CSS with its Vite integration; Radix primitives for accessible dialog/menu/popover/tabs/tooltip; `lucide-react` for icons; TanStack Query, Table and Virtual; React Hook Form with Zod; `decimal.js` for money; `date-fns` and a timezone library or tested Temporal polyfill for calendar work; i18next for localization; Apache ECharts for charts; GSAP with `@gsap/react` for coordinated transitions; Storybook, Vitest/Testing Library, Playwright and axe-core for verification. Generated OpenAPI clients come from one shared configuration. Zustand may hold transient shell state only; server state belongs in Query.

Lenis is the likely intended name behind “lenin.” Preserve native scrolling for the finance application: tables, forms, keyboard focus and scroll restoration must behave predictably. Do not install a smoothing library into core screens. Consistent GSAP/CSS motion already meets the animation requirement. Use library versions validated together, pin lockfiles, and reject packages with incompatible licenses or support policies during bootstrap.

## 3. Tokens

| Token | Light value | Dark value | Usage |
|---|---|---|---|
| canvas | #F4F1EA | #151A1F | Main workspace background |
| surface | #FFFFFF | #1E252C | Tables, drawers, form sections |
| surface-muted | #EAE6DD | #26313A | Headers, hover surfaces |
| ink | #18232C | #F3F4F0 | Main text |
| ink-muted | #4D5C68 | #B2BDC5 | Secondary readable text |
| border | #ABB4BA | #62727F | Control boundaries |
| divider | #D3D8DA | #3A4650 | Noninteractive subdivisions |
| accent | #A8ED35 | #A8ED35 | Selected nav marker/primary button surface |
| accent-ink | #17230C | #17230C | Text on accent |
| positive | #17613A | #7BDD9E | Income/healthy status |
| warning | #754B00 | #F3C76B | Due soon/attention |
| danger | #AB2835 | #FF9FA8 | Overdue/error/destructive action |
| info | #24528E | #9ABEF8 | Transfers/help/processing |
| focus | #24528E | #9ABEF8 | Visible keyboard focus |

Use pale semantic backgrounds with dark text in light mode; dark semantic backgrounds with light text in dark mode. Accent lime is a surface/marker, never small lime text on white. Validate actual rendered contrast rather than relying on a token table. Semantic icons and labels accompany colors. Category colors are separate user-configurable swatches; they never change error/success meaning.

Implement named CSS variables and Tailwind theme mapping. Arbitrary hex values in page code are prohibited. Spacing uses 4px increments: 4/8/12/16/20/24/32/40/48/64. Border widths 1px or semantic 3px. Radii: 0px for tables/sections, 2px for buttons and inputs, 4px for dialogs/popovers; circles only for avatar/progress indicators with genuine circular meaning. No 12–32px default card rounding.

Shadows are functional: popover/dialog `0 8px 24px rgba(15,23,32,.16)` light, stronger dark; static panels use borders. Avoid stacking shadows on every block. Status chips are rectangular, 2px radius, 12px type, 20px height; never color-only dots.

## 4. Typography and financial formatting

Self-host licensed Inter or IBM Plex Sans for interface and IBM Plex Mono for numeric summaries, account suffixes, amounts and audit IDs. Font fallback must work while assets load. Interface scale 12/14/16/20/24/32px; table and form default 14px, labels 12px, page title 24px/32px line-height, dashboard primary value 32px/40px. Body copy line-height 1.5. Use weight 400/500/600; avoid thin type. Section labels uppercase with modest letter-spacing only for short labels.

All money uses tabular numerals and right alignment. Format using Intl.NumberFormat and supported currency exponent; decimal inputs use exact string parsing. Show currency code when ambiguous or mixed currency. Explicit transaction kind labels explain negative/refund amounts; don't depend on minus sign alone. Currency conversion detail shows original, account debit, base booked amount, quote source and date. Rounded display never changes stored amount.

Dates follow user locale, tooltips reveal full timestamp/timezone, and upcoming dates use “Due 12 Oct” with absolute date available. Date-only bills remain local date values; do not format a UTC midnight date into yesterday. Indian number grouping and non-Latin formatting must be tested. Audit IDs can truncate visually with copy control and accessible full label.

## 5. Application shell

Desktop at 1280px and above: 232px fixed left navigation rail, 56px top utility bar, content padding 24px, maximum reading width 1600px, primary work area expanding to viewport. Header has workspace switcher, contextual breadcrumb, global search, notification icon and account menu. Rail top has Ledgerline wordmark in plain type, workspace type badge and quick Add. Financial sections use dividers, not decorative gradient cards.

At 768–1279px the rail becomes 72px icon rail with labels on tooltip/focus and expandable overlay. Below 768px use 56px top bar and five-item bottom navigation: Home, Activity, Due, Plan, More. Add is a fixed accessible rectangular action above the bar or in header, not a circular floating decoration covering content. Business approval item can show a badge in More and Home. Ensure browser safe-area spacing and keyboard opening doesn't hide save controls.

Navigation groups: Overview (Home, Activity, Calendar); Money (Accounts, Budgets, Goals, Shared balances); Commitments (Bills, Subscriptions, Vendors); Business (Claims, Approvals, Departments/Projects, Policies); Intelligence (Reports, Review); Tools (Imports, Receipts, Rules, Integrations); Workspace (Members, Audit, Settings). Business group hidden where unavailable, with server permissions independently enforced. Settings uses nested vertical tabs; financial detail pages use horizontal summary/detail tabs.

Breadcrumbs identify list > record. Browser Back returns to the previous list filter, page and scroll. Deep links must render independently of prior navigation. Active navigation uses lime rail plus text/accessible current-page state. Badge counts represent actual work; don't display meaningless decorative numbers.

## 6. Component contracts

**Buttons:** compact 32px visual or standard 40px; touch hit region at least 44px. Primary is lime/ink; secondary is bordered surface; destructive is danger text/border with explicit destructive dialog. Icon-only control has aria-label and tooltip. Loading button retains width, announces progress and blocks duplicate activation. Each page has one dominant primary action; secondary actions don't compete.

**Inputs:** standard 40px, 1px border, 2px radius, visible label above, helper below, error inline plus summary for long forms. Focus outline 2px with offset 2px. Required status is textual. Placeholder is an example, never the only label. Decimal amount input has separate currency selector and visible sign/type context. Validate on blur and submit; avoid flashing errors while the user is still entering a field. Preserve input on failed save.

**Select/combobox:** keyboard searchable, virtualized above 200 options, exact selected value, permission-aware options and inline create only where authorized. Currency selector includes code/name and no national flag assumption. Merchant combo supports suggestion versus saved vendor distinction. Multi-select tags show count and removable labels.

**Data table:** shared `DataGrid` primitive, sticky header, sticky selection/identity columns where needed, right-aligned numeric columns, column visibility, sort state and server pagination. Dense row height 36px desktop; comfortable 44px; mobile 56px cards or horizontal scroll for necessary comparisons. Avoid virtualized accessibility regressions; provide paginated mode for assistive technology. Use header cells, row names, selected count and bulk-action bar. Skeleton preserves columns and doesn't pretend there are zero transactions. A row opens detail except when control/link is clicked.

**Panels:** heading, optional context label, content and footer; use grids of meaningful sections, not 30 disconnected statistic cards. Keep KPI strip to 4–6 values; subsequent information is tables/agenda/bars. Money columns line up across adjacent panels.

**Drawer:** right side at 480px desktop for quick entry, 640px for complex split forms; modal bottom/full-screen form on mobile with labeled close and sticky action footer. Page behind retains scroll position. Complex claim editing and import mapping use full pages. A drawer is not a second page template in sitemap counts.

**Dialogs:** reserved for destructive confirmation, ownership transfer, conflict resolution and short decisions. Explain object, amount, effect and recoverability. Focus trapped and restored; Escape permitted except while committed critical operation finishes. No nested dialog stacks. Form drafts remain recoverable when accidental dismissal occurs.

**Feedback:** toast for successful save with contextual action and undo only when reversible; inline error for invalid fields; persistent banner for connectivity, stale data or unresolved integration. Toast never carries the only error detail. In-app notifications remain durable; transient toast doesn't replace inbox.

**Empty/loading/error states:** every page implements first-use empty with one helpful action, filtered empty with clear filters, fetching skeleton, background-refresh subtle state, unavailable dependency with retry/freshness, forbidden state and not-found state. Never display zero spend because analytics timed out. Preserve stale data marked with time if authorized and appropriate.

**Files:** use standard thumbnail/filename/MIME/size/status component, progress per file, accessible cancel/retry, quarantined/unscanned state distinct from ready. PDFs/images preview in controlled sandbox; downloadable untrusted HTML is never rendered inline as trusted application content.

## 7. Motion rules

Three durations: 100ms control feedback, 180ms panel/menu, 240ms route/drawer. Easing `cubic-bezier(.2,.8,.2,1)`; no bounce, rubber band, overshoot or perpetual shimmer. Hover changes surface or border and never scales financial text. Drawer slides at most 24px plus opacity; menu 4px; page content 8px. Route shell remains still. Amount update can briefly highlight changed cells; do not spin digits or animate account balances through false values.

CSS transitions handle button/focus/hover. GSAP handles grouped drawer/section transitions and chart coordination using `useGSAP` cleanup. Do not have CSS and GSAP animate the same property concurrently. Reduced motion disables transform animation, uses near-instant opacity, and stops nonessential animated charts. Tab changes and saved table filters must feel identical everywhere. Disable animations during initial SSR-equivalent hydration/loading so pages don't flicker.

Notifications enter with one 180ms transition; duplicate updates do not bounce repeatedly. Drag/drop reordering uses keyboard equivalent and immediate order feedback. Long-running progress uses real stages and indeterminate state if total unknown, never invented percentages.

## 8. Chart vocabulary

Use ECharts through shared wrappers: time-series line for cash/forecast, stacked bars for category/time spend, horizontal bars for budget/department comparison, waterfall for meaningful flow and heatmap for calendar density only when useful. Prefer bars over donut charts for comparing many categories. Small charts have direct labels and data table alternative. Forecast is dashed, actual solid; uncertainty bands explicitly labeled. Never render a line across missing data as if measured.

Use colorblind-safe palette and patterns/icons where categorical distinction matters. Tooltip contains exact currency, period and source mode. Axis units and base currency visible. Export includes same filter set and as-of time. Chart click drills into filtered transaction table, with accessible button equivalent. No 3D charts, gradients, random rainbow colors, decorative sparklines with fake data or giant revenue-style numbers unrelated to user tasks.

## 9. Required page compositions

Home: title/date filter > four-value ledger strip > 8-column spending/budget section + 4-column due agenda > action queue > recent transactions. Mobile becomes agenda first after summary. Transactions: title/Add > search/filter toolbar > compact totals by currency > table > pagination; detail drawer presents core amount/date/account followed by links/audit.

Bills/subscriptions: compact totals > segmented List/Calendar control > filters > due-state table; no card-only layout that hides comparisons. Budgets: period control > allocation summary > category progress table > upcoming commitments. Business approvals: actionable queue > selected claim summary/receipt panel > policy findings > stage history > approve/return/reject footer. Reports: query filter bar > summary with as-of > chart/table pair > drill-down/export.

Form sections follow financial order: amount/type > who/when > funding > classification/splits > links/receipt > notes/business fields > preview. Amount always visible before save. Required business fields are conditional but explicit; a generic personal entry does not show department and tax complexity until requested.

## 10. Accessibility, language and quality gate

Target WCAG 2.2 AA: text contrast, visible keyboard focus, semantic landmarks/headings, screen-reader announcements, touch targets and keyboard alternatives. Provide Skip to content; focus new page heading on route changes; announce saved/failed operations. Tables never require color perception. Charts offer a structured data view. 200% text zoom and 320px viewport must work without lost actions; necessary tabular horizontal scrolling is allowed.

Voice is concise and factual: “Bill has ₹2,400 remaining,” “Reference rate from 6 Oct,” “Receipt needs review.” Avoid celebratory confetti, moral judgment about spending, financial advice claims and AI buzzwords. Tooltips explain computation. Errors say what happened, whether save succeeded and what to do next.

Before implementing pages, build Storybook specimens for 25 primitives: Button, IconButton, Input, MoneyInput, Select, Combobox, DateInput, Checkbox, Radio, Switch, TagPicker, Badge, Table, Pagination, FilterBar, Tabs, Drawer, Dialog, Toast, Banner, Skeleton, EmptyState, FileAttachment, ChartFrame, AuditTimeline. Add StatusRail, KPI strip, split editor, occurrence preview, approval stepper and command palette compositions. Token contract must be shared with charts and email templates.

Verify at 390×844, 768×1024, 1440×900 and 1920×1080, both themes and reduced motion. Use realistic Indian and international merchants, long names, negative/refund amounts, zero and large balances, 0/3-decimal currencies, missing receipts and overdue records. Screenshot baselines must capture populated and failure states. A page fails design acceptance if it introduces new arbitrary colors/radii or a control pattern not in the component system. Design consistency is reviewable evidence, not a promise in the agent's final message.


## Implemented control contract — 9 Oct 2026

Use the shared Radix-based Select for workspace, filters, categories, accounts, cadence and reminder lead times. Popup content stays inside native dialogs so the browser top layer does not hide it. Use Lucide checks/chevrons and theme variables. Mouse field focus uses a restrained inset border; keyboard navigation retains a visible focus indicator. Errors render beneath fixed-height inputs, outside password groups. Login/registration use packaged Lucide Eye/EyeOff assets and one bound password handler; controls enable only after JavaScript is ready. Destructive actions use the shared confirmation dialog. Overall budget is the default scope; category limits are visibly separate.
