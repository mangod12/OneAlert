# OneAlert Mission Control Design System

## Physical scene

An analyst uses OneAlert on a 24–27 inch monitor during a long shift in a dim operations room, repeatedly scanning changing severity, device, and approval signals. A low-glare dark theme with restrained high-contrast accents is therefore the default.

## Color strategy

Restrained tinted neutrals with semantic data colors. Cyan is used for navigation, focus, and primary actions—not decoration.

- Canvas: ink/navy 950–900.
- Elevated surfaces: navy 875–800.
- Borders: cool slate 750–650.
- Primary: cyan 500–300.
- Danger: rose/red 500–300.
- Warning: amber 500–300.
- Success: emerald 500–300.
- Text: tinted neutral 50–500; pure white and pure black are avoided.

The Tailwind theme in `frontend-v2/src/index.css` is the source of truth. Components consume semantic tokens rather than ad-hoc colors.

## Typography

- UI: Inter/system sans, compact and highly legible.
- Technical data: ui-monospace for IPs, CVEs, ports, IDs, timestamps, and generated queries.
- Page titles: 24–30px, 700 weight.
- Section titles: 16–18px, 600–700 weight.
- Body: 13–14px.
- Labels/eyebrows: 10–12px with restrained tracking.

## Geometry and elevation

- 4px base spacing scale: 4, 8, 12, 16, 24, 32, 48.
- Controls: 36–40px; mobile touch targets at least 44px.
- Radii: 4px for tokens, 8px for controls/panels, 12px only for major overlays.
- Panels use borders and tonal separation; shadows are reserved for overlays and sticky command surfaces.

## Application shell

- Desktop: fixed 248px grouped sidebar and sticky 56px command bar.
- Tablet: collapsible/icon-aware navigation.
- Mobile: compact command bar plus modal navigation drawer; dense tables scroll horizontally.
- Main content uses a fluid grid and wide working area, not a narrow centered container.

## Standard page anatomy

1. Page header: eyebrow/breadcrumb, title, context, primary action.
2. Operational strip: compact key counts, scope, freshness, and health.
3. Filter/action bar: search, filters, result count, reset/retry.
4. Primary work surface: dense table, timeline, graph, or investigation view.
5. Contextual detail: drawer or secondary panel without losing list position.

## Required states

Every remote-data surface defines loading skeleton, populated, filtered-empty, true-empty, partial failure, full failure with retry, stale/refreshing, and permission/session failure. Errors use icon + title + actionable explanation and never collapse to zero-valued metrics.

## Interaction and accessibility

- Semantic buttons, links, tables, headings, labels, and status regions.
- Visible focus; keyboard-accessible navigation/drawers/dialogs; Escape closes overlays.
- Status never relies on color alone.
- Motion is functional and under 250ms; `prefers-reduced-motion` disables it.
- Charts have textual summaries or labels.
