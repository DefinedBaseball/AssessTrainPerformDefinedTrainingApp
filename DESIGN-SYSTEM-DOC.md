# Player Development App — Design System Document

> A complete reference covering **Theme**, **UI Components**, and **Button / App Layout**.
> Share this with Claude, Perplexity, or any designer to explore alternative directions
> while preserving the existing structure, hierarchy, and component patterns.

**App:** Baseball Player Development Platform (coaches + athletes)
**Stack:** Next.js (App Router) · React Native (Expo) · CSS Modules
**Current theme name:** "Premium Graphite" — dark, layered-black, monochrome, muted accents
**Goal of this doc:** Provide enough fidelity that an AI or designer can propose 2–3 alternative
visual directions (e.g. "Stadium Night," "Clay + Chalk," "Dugout Neon") without breaking the
information architecture.

---

## Table of Contents

1. [THEME](#1-theme) — Tokens, colors, typography, spacing, motion
2. [UI](#2-ui-components) — Cards, badges, chips, inputs, modals, lists, tables, hover states
3. [BUTTON / APP LAYOUT](#3-button--app-layout) — Button variants, page layouts, navigation, responsive rules
4. [CODE ARCHITECTURE](#4-code-architecture) — Stack, folder structure, how styles cascade, how to change things
5. [Prompt-Ready Remix Brief](#5-prompt-ready-remix-brief) — Copy/paste into Claude or Perplexity

---

# 1. THEME

## 1.1 Design Philosophy

- **Near-black base** (#010101) — so color accents pop without fighting each other
- **Monochrome-first** — color is earned; UI chrome stays grayscale
- **Subtle luminance layers** — cards are 1.5%–4% white-on-black, not solid gray
- **Muted semantic colors** — all status colors use 13% opacity fills (never saturated solid)
- **Inverted primary** — primary button is white-on-black (opposite of typical dark UIs)
- **Generous radii** — 16–30px for a premium, soft, non-industrial feel
- **Quiet motion** — 200ms cubic-bezier(0.16, 1, 0.3, 1), no bounces

## 1.2 Color Tokens

```css
/* ── Backgrounds ── */
--bg:            #010101;   /* page */
--surface:       #040405;   /* form fields, scroll track */
--surface2:      #08090b;   /* slight elevation */
--surface-light: #0d0f12;   /* modal top */
--card:          rgba(255,255,255,0.015);
--card-hover:    rgba(255,255,255,0.03);
--card-gradient: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015));

/* ── Text ── */
--text:           #f1f4f6;
--text-secondary: #919ba1;
--text-muted:     #626b71;
--faint:          #3a3f45;

/* ── Accent (white / silver) ── */
--accent:       #FFFFFF;
--accent-light: #FFFFFF;
--accent-dim:   rgba(255,255,255,0.06);

/* ── Graphite accent ── */
--graphite:      #686c72;
--graphite-dim:  rgba(104,108,114,0.07);
--graphite-line: rgba(104,108,114,0.18);

/* ── Semantic (always paired with -dim 13% fill) ── */
--green:  #6DAA45;   --green-dim:  rgba(109,170,69,0.13);
--gold:   #E8AF34;   --gold-dim:   rgba(232,175,52,0.13);
--red:    #DD6974;   --red-dim:    rgba(221,105,116,0.13);
--orange: #FDAB43;   --orange-dim: rgba(253,171,67,0.13);

/* ── Borders ── */
--border:       rgba(255,255,255,0.08);
--border-light: rgba(255,255,255,0.12);
```

### Semantic mapping (what each color means)

| Token     | Meaning in app                                           |
|-----------|----------------------------------------------------------|
| `green`   | Positive progress, high level, committed, healthy        |
| `gold`    | Intermediate level, college commitment, notable moment   |
| `red`     | Pro signing, danger / delete, advanced-expert skill      |
| `orange`  | Advanced level, warnings, secondary alerts               |
| `graphite`| Neutral UI chrome, dividers, unactive state              |
| `accent`  | White — primary buttons, key CTAs, unbranded highlight   |

## 1.3 Typography

```css
font-family: 'Satoshi', 'DM Sans', -apple-system, 'Segoe UI', Roboto, sans-serif;
```

| Role              | Family          | Weight | Size    | Letter-spacing |
|-------------------|-----------------|--------|---------|----------------|
| Body              | Satoshi         | 400    | 15px    | 0              |
| Section heading   | Clash Grotesk   | 700–800| 28px    | -0.03em        |
| Hero eyebrow      | Satoshi         | 600    | 11px    | 0.1em UPPER    |
| Card title        | Clash Grotesk   | 700    | 18–20px | -0.02em        |
| Label (form)      | Satoshi         | 600    | 11px    | 0.1em UPPER    |
| Stat number       | **DM Mono**     | 600    | 28–36px | -0.02em        |
| Table column hdr  | Satoshi         | 700    | 10px    | 0.12em UPPER   |
| Badge / tag       | Satoshi         | 700    | 10–11px | 0.08em UPPER   |

**Key rule:** All *numbers* (stats, ages, heights, weights, velocities) use **DM Mono** for
tabular alignment. All *labels* (section titles, form labels, column headers) use UPPERCASE
with wide tracking. All *headings* use Clash Grotesk with tight tracking.

## 1.4 Spacing Scale

```
4  · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80
```

Most padding/gap values stick to this scale. Cards use 16–28px padding. Sections are
separated by 24–32px. Page gutters are 24px desktop / 16px tablet / 12px mobile.

## 1.5 Radii

```css
--radius-sm:   10px;   /* buttons, inputs, chips */
--radius-md:   16px;   /* cards */
--radius-lg:   24px;   /* large list containers, hero cards */
--radius-xl:   30px;   /* modals */
--radius-full: 999px;  /* pills, avatars, FAB */
```

## 1.6 Shadows & Elevation

```css
--shadow-card: 0 18px 40px rgba(0,0,0,0.3);   /* standard elevated card */
--shadow-lg:   0 32px 80px rgba(0,0,0,0.58);  /* modal */
```

No colored shadows. No glow effects. Elevation is signaled via:
1. A slightly brighter gradient top-edge (white 4% → 1.5%)
2. A deeper black drop shadow
3. Border brightens on hover (`0.08` → `0.14`)

## 1.7 Motion

```css
--transition: 200ms cubic-bezier(0.16, 1, 0.3, 1);
```

- Hover lifts: `translateY(-2px)` max
- FAB hover: `scale(1.08)`
- Modal enter: fade + 8px slide-up
- **No spring physics, no bounces, no shimmer.** Calm and deliberate.

---

# 2. UI COMPONENTS

## 2.1 Cards

```css
.card {
  background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015));
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 16px;   /* or 24px for large */
  padding: 16px;
  transition: border-color 200ms;
}
.card:hover { border-color: rgba(255,255,255,0.14); }
```

**Variants:**
- **Standard card** — 16px radius, 16px padding
- **Hub card** — 18–24px radius, 28px padding, hover `translateY(-2px)` + shadow
- **Stat card** — houses one big DM Mono number + small label below
- **Post card** — houses type badge + title + body + author footer

## 2.2 Badges & Tags

Pill-shaped (`border-radius: 999px`). 10–11px, uppercase, 0.08em tracking, weight 700.

```css
.badge-high  { background: var(--green-dim); color: var(--green); }   /* positive */
.badge-mid   { background: var(--gold-dim);  color: var(--gold); }    /* warning */
.badge-low   { background: var(--red-dim);   color: var(--red); }     /* danger */
.badge-teal  { background: var(--accent-dim); color: var(--accent-light); }
```

## 2.3 Chips (Filter Pills)

Used for filter rows (grad year, sport, level). Toggle between inactive and active state:

```css
.filterChip {
  padding: 6px 16px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: rgba(255,255,255,0.015);
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 600;
}
.filterChip:hover        { border-color: rgba(255,255,255,0.18); color: var(--text-secondary); }
.filterChipActive        { background: rgba(255,255,255,0.08); color: #f1f4f6;
                           border-color: rgba(255,255,255,0.14); }
```

## 2.4 Inputs & Forms

```css
input, select, textarea {
  background: var(--surface);          /* #040405 */
  border: 1px solid var(--border);     /* rgba(255,255,255,0.08) */
  border-radius: 10px;
  color: var(--text);
  font-size: 14px;
  padding: 10px 14px;
  width: 100%;
}
input:focus { border-color: rgba(255,255,255,0.18); }
```

**Labels:** 11px uppercase, 0.1em tracking, `--text-muted` color, 8px below label → input.

## 2.5 Modals

```css
.overlay  { background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); }
.modal    {
  background: linear-gradient(180deg, #0d0f12 0%, #060708 100%);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 30px;
  box-shadow: 0 32px 80px rgba(0,0,0,0.65);
  padding: 32px;
  max-width: 560px;
}
```

Modals have a close `×` in top-right, a bold Clash Grotesk title, and a footer row with
`Cancel` (outline) + primary action button right-aligned.

## 2.6 Hover-Reveal Actions (Coach-only Edit/Delete)

Coach-only controls (pencil + `×`) are rendered in the DOM only for coaches (gated by
`{isCoach && ...}`). For players these buttons are entirely absent — not merely hidden.
For coaches they start at `opacity: 0` and reveal on card hover:

```css
.actions              { opacity: 0; transition: opacity 200ms; display: flex; gap: 4px; }
.card:hover .actions  { opacity: 1; }
.cardBtnEdit:hover    { background: var(--accent-dim); color: var(--accent-light); }
.cardBtnDel:hover     { background: var(--red-dim);   color: var(--red); }
```

## 2.7 Lists & Tables

**Grid-based row layout** (not HTML `<table>`) for flexible column widths:

```css
.listHeader, .listRow {
  display: grid;
  grid-template-columns: 2.2fr 0.6fr 0.7fr 1.2fr 0.7fr 0.7fr 0.7fr 0.6fr;
  gap: 8px;
  padding: 14px 20px;
}
.listHeader { background: rgba(255,255,255,0.025); }
.listRow    { border-bottom: 1px solid var(--border); cursor: pointer; }
.listRow:hover { background: rgba(255,255,255,0.03); }
```

Numbers in rows use `font-variant-numeric: tabular-nums`.

## 2.8 Avatar

```css
.avatar {
  width: 36px; height: 36px;
  border-radius: 50%;
  background: linear-gradient(180deg, #36342f, #1d1c1a);
  border: 1px solid rgba(255,255,255,0.08);
  font-weight: 700; font-size: 12px;
}
```

Holds 2-letter initials. Sizes: 28px (list), 36px (table), 64px (profile header).

## 2.9 Weekly Schedule Strip (Player Dashboard)

Seven equal columns, each a small card with day name (Mon/Tue/…), date number, and
colored dots indicating workout categories for that day. "TODAY" label on the current day.

```
┌───┬───┬───┬───┬───┬───┬───┐
│Mon│TUE│Wed│Thu│Fri│Sat│Sun│
│ 13│ 14│ 15│ 16│ 17│ 18│ 19│
│ ●●│●●●│ ●●│   │ ●●│   │   │
│   │TOD│   │   │   │   │   │
└───┴───┴───┴───┴───┴───┴───┘
```

## 2.10 Empty States

Centered, 64px vertical padding, `--text-muted`, friendly single-sentence message
("No athletes yet — add one to get started").

---

# 3. BUTTON / APP LAYOUT

## 3.1 Button Variants

| Variant    | Background                                          | Text        | Use                           |
|------------|-----------------------------------------------------|-------------|-------------------------------|
| Primary    | linear-gradient white 95% → 85%                     | `#010101`   | Main CTA (save, submit)       |
| Outline    | `rgba(255,255,255,0.018)` + `--border`              | `--text-secondary` | Secondary actions      |
| Danger     | red-tinted gradient `rgba(225,143,151,0.1 → 0.03)`  | `#f2bcc3`   | Destructive (delete, remove)  |
| Ghost Icon | transparent, no border                              | `--text-muted` | Icon-only (×, pencil)       |
| FAB        | white gradient, 56px circle                         | `#010101`   | Fixed bottom-right create     |

```css
.btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 20px; border-radius: 10px;
  font-size: 14px; font-weight: 700;
  transition: all 200ms;
}
.btn-primary  { background: linear-gradient(180deg, rgba(255,255,255,0.95), rgba(255,255,255,0.85)); color: #010101; }
.btn-outline  { background: rgba(255,255,255,0.018); border: 1px solid var(--border); color: var(--text-secondary); }
.btn-danger   { background: linear-gradient(180deg, rgba(225,143,151,0.1), rgba(225,143,151,0.03));
                border: 1px solid rgba(225,143,151,0.22); color: #f2bcc3; }
```

### FAB (Floating Action Button)

```css
.fab {
  position: fixed; bottom: 24px; right: 24px;
  width: 56px; height: 56px; border-radius: 999px;
  background: linear-gradient(180deg, #fff, rgba(255,255,255,0.85));
  color: #010101;
  box-shadow: 0 12px 32px rgba(0,0,0,0.5);
  transition: transform 200ms;
}
.fab:hover { transform: scale(1.08); }
```

**Visibility:** FAB is rendered *only* for coaches (`{isCoach && <FAB />}`).

## 3.2 App Shell

```
┌─────────────────────────────────────────────────────────┐
│ [LOGO]  Dashboard  Athletes  Education  Feed    [avatar]│  ← top nav, 64px
├─────────────────────────────────────────────────────────┤
│                                                         │
│            MAIN CONTENT (padding: 24px)                 │
│     max-width: 1200px, centered, mobile: 12px          │
│                                                         │
│                                               [  +  ]   │  ← FAB (coach)
└─────────────────────────────────────────────────────────┘
```

Top nav: `rgba(255,255,255,0.02)` bg with 1px bottom border. Links are `--text-secondary`
with `--text` on hover. Active route has a subtle underline or weight increase.

## 3.3 Dashboard Layout — Coach

```
COACH DASHBOARD                              (eyebrow 11px upper)
Assess, Train, Perform                       (Clash Grotesk 32px)
Subtitle text (14px, muted)

┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│  11  │ │  3   │ │  0   │ │  0   │          (4-col stat grid,
│Total │ │ Grad │ │Commit│ │ Pro  │           DM Mono numbers)
│Athle.│ │Years │ │ ted  │ │Sign. │
└──────┘ └──────┘ └──────┘ └──────┘

Announcements & Spotlights  [3]
┌───────────────────────────────────────┐
│ [PROGRAM ANNOUNCEMENT] 3h ago         │
│ Summer Training Program...            │
│ Body text...                      ✎ × │   ← hover-reveal
│ by coach@playerdev.com                │
└───────────────────────────────────────┘

                                    [  +  ]  ← FAB (coach only)
```

## 3.4 Dashboard Layout — Player

```
┌───┬───┬───┬───┬───┬───┬───┐
│Mon│TUE│Wed│Thu│Fri│Sat│Sun│     ← weekly schedule strip
│ 13│ 14│ 15│ 16│ 17│ 18│ 19│
│ ●●│●●●│ ●●│   │ ●●│   │   │
└───┴───┴───┴───┴───┴───┴───┘

Announcements & Spotlights  [3]
(post cards — NO edit, NO delete, NO FAB)

Player Profile (embedded below — bio, metrics, reports)
```

## 3.5 Athletes List Table

```
Athletes                          [search]  [grad-year filter chips]
┌────────────────────────────────────────────────────────┐
│ NAME       AGE  GRAD   POS     HT    WT   PBR   PG     │
├────────────────────────────────────────────────────────┤
│ (MB) Mason Brown  18  2026   SS     5'11  175  —   —   │  clickable row
│ (JD) Jon Doe      17  2027   2B/SS  5'9   165  —   —   │
└────────────────────────────────────────────────────────┘
```

Grid: `2.2fr 0.6fr 0.7fr 1.2fr 0.7fr 0.7fr 0.7fr 0.6fr`
Avatar: 36px circle, sand-tone gradient
Clicking a row navigates to the player profile.

## 3.6 Education Hub

Landing page with **3 hub cards**:

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  🎓 Classes  │  │  ⚾ Drills   │  │ 🎬 MLB Video │
│  gold accent │  │ teal accent  │  │ red accent   │
└──────────────┘  └──────────────┘  └──────────────┘
```

Hub cards: 18–24px radius, 28px padding, `translateY(-2px)` + shadow on hover.

**Classes section:** Sport tabs (Hitting / Pitching / Defense / S&C / Vision) with colored
active states. Level filter pills (Beginner=green, Intermediate=gold, Advanced=orange,
Expert=red). Class cards show: emoji thumb + name + level badge + description + meta.

**Drills section:** Grouped by category with divider lines. Drill cards have a 3px color
bar (sport color) on the left edge. Hover-reveal edit/delete for coaches.

**MLB Video section:** Player cards with emoji avatar + position badge + video count.
Filterable by position / bats / throws.

## 3.7 Post Feed (Announcements & Spotlights)

Post card structure:

```
┌──────────────────────────────────────────────────┐
│ [TYPE BADGE]  3h ago                         ✎ × │  ← coach only
│ Post title (Clash Grotesk 18px)                  │
│ Body text (Satoshi 14px, --text-secondary)       │
│                                                  │
│ by coach@playerdev.com                           │
└──────────────────────────────────────────────────┘
```

### Post type → color mapping

| Type                   | Background color              | Text color |
|------------------------|-------------------------------|------------|
| `FACILITY_ANNOUNCEMENT`| `--accent-dim` (white 6%)     | `--accent-light` |
| `ATHLETE_HIGHLIGHT`    | `--green-dim`                 | `--green`  |
| `PROGRAM_ANNOUNCEMENT` | `rgba(91,163,217,0.13)`       | `#5BA3D9`  |
| `COLLEGE_COMMITMENT`   | `--gold-dim`                  | `--gold`   |
| `PRO_SIGNING`          | `--red-dim`                   | `--red`    |

## 3.8 Responsive Breakpoints

```
Desktop    : ≥ 1024px   — full layout, 24px gutters, 4-col stat grid
Tablet     : 768–1023   — 16px gutters, 2-col stat grid
Mobile     :  ≤ 767     — 12px gutters, 1-col stat grid, nav collapses

Table-specific:
  ≤ 900px  — hide PBR + PG columns
  ≤ 640px  — show only Name / Grad / Position columns
```

## 3.9 Role-Based Rendering Rules

**This is critical and should be preserved in any theme remix:**

- Players see ZERO edit, delete, or create affordances in their DOM (not even hidden).
- Coaches see `✎` + `×` buttons on every editable card, revealed on hover.
- Coaches see a 56px FAB bottom-right for creation flows.
- Auth gate pattern: `{isCoach && <EditDeleteActions />}`

---

# 4. CODE ARCHITECTURE

> This section tells a designer/AI *where* each visual lives in code, so any remix
> they propose can be mapped back to concrete files.

## 4.1 Tech Stack

| Layer        | Tech                                                   |
|--------------|--------------------------------------------------------|
| Monorepo     | pnpm + Turborepo workspaces                            |
| Web          | Next.js 14 App Router (React Server + Client components) |
| Mobile       | Expo SDK 55 + React Native + Expo Router (planned)     |
| Styling      | CSS Modules (`*.module.css`) + global tokens in `globals.css` |
| State        | Zustand (client) + React Query (server)                |
| API          | NestJS (TypeScript) with REST controllers              |
| Database     | PostgreSQL + Prisma ORM (SQLite locally for dev)       |
| Auth         | JWT — role on `req.user.sub` / `req.user.role`         |

**No Tailwind, no styled-components, no CSS-in-JS.** All styling is plain CSS Modules
referencing custom properties declared in a single `globals.css`.

## 4.2 Monorepo Layout

```
player-development-app/
├── apps/
│   ├── web/              ← Next.js (this is the primary surface today)
│   ├── mobile/           ← Expo React Native (planned)
│   └── api/              ← NestJS backend
├── packages/             ← shared types, chart configs, API client
└── DESIGN-SYSTEM-DOC.md  ← you are here
```

## 4.3 Web App Structure (`apps/web/src`)

```
apps/web/src/
├── app/                          ← Next.js App Router
│   ├── globals.css               ← ★ ALL DESIGN TOKENS live here
│   ├── layout.tsx                ← root layout, mounts <Sidebar />
│   ├── page.tsx                  ← dashboard (coach + player branching)
│   ├── page.module.css           ← dashboard styles + post feed + modals
│   ├── login/
│   ├── athletes/
│   │   ├── page.tsx              ← athletes list table
│   │   ├── page.module.css
│   │   └── [id]/                 ← athlete profile (dynamic route)
│   ├── education/
│   │   ├── page.tsx              ← Classes / Drills / MLB Video hub
│   │   └── page.module.css
│   ├── training/
│   ├── leaderboard/
│   ├── players/
│   ├── videos/
│   └── upload/
├── components/
│   ├── Sidebar.tsx + .module.css ← top/side nav
│   ├── MetricChart.tsx + .module.css
│   └── assessment/
└── lib/
    ├── api.ts                    ← typed fetch client (updatePost, updateDrill, etc.)
    ├── auth-context.tsx          ← isCoach / isPlayer helpers, JWT state
    ├── theme.ts                  ← color constants for charts
    ├── atbat-parser.ts
    └── mock-data.ts
```

## 4.4 Style Cascade — How Changes Propagate

```
apps/web/src/app/globals.css        ← change design tokens HERE
                │
                │   :root { --bg, --text, --accent, --radius-*, ... }
                ▼
   ┌────────────┴────────────┐
   │                         │
.card (global class)    page.module.css, athletes/page.module.css,
                        education/page.module.css, ...
                        (each file references var(--token))
```

**Rule of thumb for remixes:**
- To re-theme the app, 95% of work happens in `globals.css` `:root` tokens.
- Local `*.module.css` files should *never* hardcode colors — they should always
  reference `var(--*)` tokens. A few legacy spots still hardcode `rgba(...)`; those
  would need to be migrated to tokens during a remix.
- Adding a new semantic color means adding a `--mycolor` + `--mycolor-dim` pair.

## 4.5 API Structure (`apps/api/src/modules`)

```
apps/api/src/modules/
├── auth/          ← JwtAuthGuard, Roles decorator — import from here
├── players/
├── metrics/
├── posts/         ← controller has Get/Post/Put/Delete, @Roles('COACH') on mutations
├── education/     ← classes + drills
├── videos/
├── uploads/
├── training/
├── games/
├── reports/
├── leaderboards/
└── health/
```

**Controller convention (seen across posts, education, etc.):**

```ts
import { Roles } from '../auth/jwt.guard';   // ← project-local pattern

@Controller('posts')
export class PostsController {
  @Get()                                      async findAll() { ... }
  @Post()   @Roles('COACH')                   async create(@Request() req, @Body() body) { ... }
  @Put(':id')  @Roles('COACH')                async update(@Param('id') id, @Body() body) { ... }
  @Delete(':id') @Roles('COACH')              async delete(@Param('id') id) { ... }
}
```

Mutations always gate with `@Roles('COACH')`. The user identity comes off
`req.user.sub` (NOT `.id` — that's a common footgun).

## 4.6 Role-Based Rendering Pattern (Frontend)

```tsx
const { isCoach } = useAuth();

return (
  <div className={styles.card}>
    <h3>{item.title}</h3>
    <p>{item.body}</p>

    {/* Coach-only actions — completely absent from player DOM */}
    {isCoach && (
      <div className={styles.actions}>
        <button onClick={() => setEditing(item)}>&#9998;</button>
        <button onClick={() => handleDelete(item.id)}>×</button>
      </div>
    )}
  </div>
);

{/* FAB also coach-gated */}
{isCoach && <button className={styles.fab} onClick={openCreate}>+</button>}
```

## 4.7 Modal Pattern

All modals follow an identical shape: a portal-less inline overlay + content div,
rendered conditionally via a `const [editing, setEditing] = useState<T | null>(null)`.
Edit modals pre-fill fields via `useState(existingValue)` initializers on each input.

```tsx
{editingPost && (
  <EditPostModal
    post={editingPost}
    onClose={() => setEditingPost(null)}
    onSaved={handlePostUpdated}
  />
)}
```

## 4.8 What a Theme Remix Would Actually Touch

| If you want to change…                  | Edit this file                                   |
|-----------------------------------------|--------------------------------------------------|
| Base background / text colors           | `apps/web/src/app/globals.css` (`:root`)         |
| Accent / semantic colors                | `apps/web/src/app/globals.css` (`:root`)         |
| Typography (fonts)                      | `globals.css` `@import` + `body { font-family }` |
| Button styles                           | `globals.css` `.btn`, `.btn-primary`, etc.       |
| Card background / border / radius       | `globals.css` `.card` (+ local `--card-gradient`)|
| Post feed layout                        | `apps/web/src/app/page.tsx` + `page.module.css`  |
| Athletes table columns                  | `apps/web/src/app/athletes/page.module.css`      |
| Education hub look                      | `apps/web/src/app/education/page.module.css`     |
| Chart colors                            | `apps/web/src/lib/theme.ts`                      |

**Bottom line for the AI you're briefing:** a full theme remix is mostly a
replacement of the `:root { ... }` block in `globals.css` plus a typography swap.
Structural changes to layout/spacing live in each route's `page.module.css`.

---

# 5. PROMPT-READY REMIX BRIEF

> Copy/paste the block below into Claude or Perplexity to get alternative directions.

---

**Brief:** Below is the full design system for a baseball player development app called
"Premium Graphite" — a dark, near-black, monochrome theme with muted 13% opacity color
accents. I'd like **2–3 alternative visual directions** while keeping the same layout
structure, component patterns, and information hierarchy.

**Constraints (do NOT change):**
- Dashboard layout (coach 4-col stat grid + feed, player weekly strip + feed)
- Athletes list grid columns (`2.2fr 0.6fr 0.7fr 1.2fr 0.7fr 0.7fr 0.7fr 0.6fr`)
- Education hub with 3 category cards (Classes / Drills / MLB Video)
- Post type color semantics (facility / highlight / program / commitment / pro)
- Coach-only hover-reveal edit/delete pattern + FAB for creation
- Number-heavy stat display must use a monospace font for tabular alignment
- Post feed card structure with type badge + title + body + author footer

**What you can change:**
- Base palette (currently near-black `#010101`) — could be cream, navy, forest, slate, etc.
- Accent palette (currently white + muted green/gold/red/orange)
- Typography pairing (currently Satoshi + Clash Grotesk + DM Mono)
- Radii scale (currently 10/16/24/30) — could go more angular (4/8/12) or softer
- Shadow style (currently pure black drop shadows) — could use colored or no shadows
- Surface treatment (currently subtle white-overlay gradients) — could use textures, noise, solid fills
- Button primary style (currently white-on-black inverted) — could swap to a brand color
- Decorative elements (currently none) — could add subtle icons, dividers, illustrations

**For each alternative, please provide:**
1. **Name + vibe** (e.g. "Dugout Chalk: daylight, rested, tactile")
2. **Color tokens** — full replacement for the `:root` variables shown in section 1.2
3. **Typography recommendation** — font families + role table
4. **Three signature moves** — what makes this theme distinctive (e.g. "chalk-texture
   dividers", "amber glow on active state", "uppercase display numbers with ligatures")
5. **A one-paragraph sample** of how the Coach Dashboard would feel in this direction
6. **Ready-to-paste `:root { ... }` block** — so I can drop it into `apps/web/src/app/globals.css`

**Goals:**
- Each direction should feel meaningfully different (not just "change the hex codes")
- Maintain professional sport-tech credibility (this is for coaches evaluating athletes)
- Stay readable at small text sizes — accessibility matters
- Work in dark mode OR light mode (some could be light-first)

---

**END OF DESIGN SYSTEM DOCUMENT**
