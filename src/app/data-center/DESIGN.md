# The Data Center's visual system

Written from the built module, not from an intention. Everything below is in the
code; where a rule was broken on purpose, the exception says so.

Scope: `src/app/data-center/**`. The host app owns its own chrome and this
module never touches it. `src/styles.css` is not edited by anything here.

## The idea

**One instrument panel in five colour-coded sections.** Colour is wayfinding
and state, never decoration. Before the module had this, eleven different jobs
were eleven identical white cards with gray borders, and nothing on screen told
you where you were.

It refuses the category default it started as: uniform cards, uniform borders,
one accent used only on buttons.

## Tokens

`theme.css`, on `:root`, prefixed `--dc-`. Not scoped under the wrapper, because
Radix portals dialogs and popovers to `<body>` where a scoped variable would not
reach them. The file loads only with the lazily-imported module, so a user who
never opens the Data Center never downloads it.

| Token | Value | Role |
|---|---|---|
| `--dc-primary` | `#4a5d0f` | The host's olive. The module's anchor |
| `--dc-primary-strong` | `#3d4d0c` | Pressed and hover on olive |
| `--dc-primary-mid` | `#6b8016` | Default bar fill |
| `--dc-primary-soft` | `#eef3c4` | Olive tint |
| `--dc-surface` / `--dc-surface-muted` | `#ffffff` / `#fafafa` | Card and inset grounds |
| `--dc-accent` / `-strong` / `-soft` | per area | What every surface actually reads |

## The five accents

Set by `.dc-root[data-area="…"]`, which `DataCentreShell` puts on the page from
an `area` prop. A portaled dialog carries `dc-root data-area` in its own
className, because it renders outside the page's tree.

| Area | Accent | Strong | Soft |
|---|---|---|---|
| Explore, Dashboard | `#4a5d0f` | `#3d4d0c` | `#eef3c4` |
| Call Centre | `#0e5a56` | `#0a4744` | `#d9efec` |
| Partner Records | `#8a5a08` | `#6f4806` | `#f7ecd2` |
| Stove Records | `#33527b` | `#28405f` | `#e0e9f4` |
| Import | `#6b3a6e` | `#542c57` | `#f1e2f2` |

Every accent holds at least 4.5:1 on white and on `--dc-surface-muted`, so an
accent-coloured label is readable text rather than only a decoration colour.

## Semantic state, which never changes with the area

| | Meaning |
|---|---|
| amber | Warning, partial verification, a batch waiting on a decision |
| orange | Unreachable |
| blue | Informational, an open batch, a resolved correction |
| purple | Reclaimed |
| red | Danger, an open correction, a destructive action |

A state colour is never used as an area accent and an area accent is never used
to mean a state. Import's plum and "reclaimed" purple are close enough that the
two never appear on the same element.

## Borders, which carry the system

- **A 3px rail on the top of a feature card.** On the top edge, not the left: a
  left rail on every card turns a page of cards into a page of stripes, and the
  craft floor names the thick coloured left border as the most recognisable
  mark of a generated interface. The rail is absent from the small stat figures
  on the dashboard, where eight rails would be stripes again.
- **A coloured hairline on all four sides**, plus an inset ring where the thing
  is a card, for callouts and banners. This replaced a left rail.
- **A dashed accent border** on every empty state. A solid gray box says
  "broken"; a dashed accent box says "nothing yet".
- **Two-pixel accent rules** under the page title and under a table head, which
  is how a head separates from a body without a shadow.

## Surfaces

- Feature card: white, `rounded-xl`, `border-gray-200`, top rail, `shadow-sm`.
- Card head: `bg-(--dc-accent-soft)/30`, so a card has a head and a body rather
  than one flat plane. The import upload strip is the exception: it sits on
  white, because it is where you act.
- Table head: solid `--dc-accent-soft` with `--dc-accent-strong` text. Solid,
  not translucent, because the first column pins and a see-through pinned cell
  lets the scrolled columns read through it.
- Row hover: `--dc-accent-soft` at 40 to 60 percent, applied through `group-hover`
  so a pinned cell and its row tint together.

## Type

The host's system stack, unchanged. No webfont: this is an Operate surface where
a display face in a data label is noise, and a font file is a dependency the
daily contractor merge would have to carry.

One family, four steps: `text-2xl` page title, `text-base` card title, `text-sm`
body and table, `text-xs` labels and pills. Uppercase with `tracking-wide` marks
a label; sentence case is content. Numbers are `tabular-nums` everywhere so a
column of figures lines up.

## Interaction

- **Every figure on the dashboard is a link** to the rows behind it, as a URL.
  Drill-through is never component state, so back restores the dashboard and a
  narrowed table can be sent to someone as a link.
- A linking card lifts half a pixel on hover and shows an arrow at
  `--dc-accent` at 60 percent, visible at rest because a phone has no hover.
- Rows that lead nowhere stay plain. Stock by status has no surface listing
  stoves that way, and a row leading somewhere close enough is worse than a row
  leading nowhere.
- 150 to 250ms on state transitions. No load choreography: the module opens into
  a task.

## Overlays

All portaled, from `@/components/ui`, which is what the host app uses.

| Kind | Treatment |
|---|---|
| A record to work on | `Dialog`, centred, `w-[90vw] h-[90dvh]`, body capped at `max-w-5xl` |
| A yes or no | `AlertDialog`, centred, content-sized |
| A search result list | `Popover`, anchored, focus left in the input |

The 90 percent dialog needs `sm:max-w-[90vw]` as well as `max-w-[90vw]`, because
shadcn's own `sm:max-w-lg` otherwise wins. Its body caps at `5xl` and centres:
90 percent of a wide screen is far wider than a phone number needs, and a field
stretched to 550px reads as a mistake rather than as generosity.

## Responsive

Structural, never fluid type.

- Below `sm`, the two virtualized tables render each record as a stacked card.
  One table that knows how wide it is, not two tables to keep in step: the
  virtual window is arithmetic over a row height, so `useMediaQuery` changes the
  height and the row renderer together.
- The three real tables keep their wide layout at every width and pin the first
  column, so a sideways scroll still says whose row you are reading.
- Scrollers use `maxHeight: clamp(320px, 62dvh, 560px)`. `maxHeight` so five
  rows do not sit above 340px of white; `dvh` so a mobile browser's collapsing
  toolbar does not cut the last row off.
- Search boxes and selects go full width below `sm` and back to their lanes
  above it. Grids step 1 to 2 to 4.

## Rules for anything added here

1. No hex literals in JSX. Everything reads a `--dc-` token.
2. A new area declares its accent in `theme.css` and passes `area` to the shell.
3. A figure that names a countable thing links to that thing, or stays plain.
4. No thick coloured side borders. The top rail and the four-sided hairline are
   the two border devices this system has.
5. Counts go through `lib/plural.ts`. "1 record(s)" is the mark of an interface
   nobody finished.
6. No new dependencies. `package.json` and `bun.lock` are in the daily
   contractor merge.
