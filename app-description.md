# Defined Baseball Academy — Player Development App

A baseball-specific player development platform for coaches and athletes.
Coaches assess hitters / pitchers / defenders / strength / vision, ingest
sensor data from major vendors (Blast Motion, Full Swing, HitTrax, TrackMan,
VALD, Vizual Edge), grade players on the 20–80 scouting scale, and produce
black-tie PDF reports that mirror the in-app player profile.

---

## 1 · Tech stack

- **Web** — Next.js 14 (App Router), React, CSS Modules
- **API** — NestJS + Prisma
- **DB** — SQLite (dev), Postgres-compatible schema (prod)
- **PDF** — `@react-pdf/renderer`
- **CSV parsing** — `papaparse` + per-vendor parser registry
- **XLSX parsing** — `xlsx` (At-Bat assessment workbook)
- **Auth** — role-based: `coach` and `athlete`

Schema is defined in `prisma/schema.prisma` — pass that file alongside
this description to recreate the data layer.

---

## 2 · Domain entities

Top-level (see `schema.prisma` for full field lists):

- **User** — coach or athlete login (email + password hash + role).
- **Player** — name, position, gradYear, height, weight, bats/throws,
  highSchool, clubTeam, collegeCommit, photoUrl, archive flag.
- **Report** — assessment record per player. `reportType` ∈ {`HITTING`,
  `PITCHING`, `DEFENSE` (catching/infield/outfield), `STRENGTH`,
  `VISION`, `PITCH_RECOGNITION`, `AT_BAT_RESULTS` (legacy), …}. Stores
  `notes`, `videoIds`, and a JSON `content` blob with section-specific
  data (manual scores, csvUploads, atBatAssessment, manualBattedBall,
  manualSwingMetrics, etc.).
- **Metric** — per-row sensor reading. `metricType` (e.g. `max_exit_velo`,
  `attack_angle`, `spray_x`, `ball_type_code`), `source` (e.g.
  `HITTRAX`, `FULL_SWING`, `BLAST_MOTION`, `TRACKMAN`), `value`,
  `unit`, `recordedAt`, `uploadId` (FK to CsvUpload), `playerId`.
- **CsvUpload** — one row per file uploaded. Tracks vendor source,
  filename, totalRows, successRows, status, errorDetails, uploadedById.
- **Drill** — coaching drill with name, category, video, instructions.
- **ProgramSchedule** — daily program board (Hitting / Pitching /
  Catching / Infield / Outfield / S&C) with athletes assigned and
  drills selected.
- **TrackmanPitch** — per-pitch row from TrackMan CSV (rich pitch
  metadata kept as JSON in `Metric.rawData`).

---

## 3 · Core feature surfaces

### 3.1 Athlete profile (`/athletes/[id]`)

A tabbed page with the following tabs (visible per-position):

- **Player Summary** — top-level vitals + best-of-each-category metric
  cards.
- **Hitting** (anyone non-pitcher-only) — Hitting Snapshot + sub-tabs
  (Swing / Swing Decision).
- **Pitching** (P) — pitch arsenal table from TrackMan.
- **Defense** (C / INF / OF) — position-specific assessments.
- **Strength** — jump height, broad jump, sprint, lifts.
- **Vision** — Vizual Edge metrics.
- **Pitch Recognition** — at-bat IQ + pitch-class accuracy.
- **Profile** (coach-only edit) — modify player vitals.

Each tab supports:

- **Selecting a HISTORICAL report** (drop-down `ReportSelector`) — the
  whole tab re-scopes to that report's CSV uploads + manual entries.
- **Add Report / Edit Report** modal that opens a unified form.
- **Download PDF** button (top action bar) that mirrors the active
  report's data into a printable PDF.

### 3.2 Hitting Snapshot (the marquee feature)

The Hitting tab renders a "Hitting Snapshot" panel at the top:

- **Spray Chart** (left) — SVG field with home plate at bottom-center,
  ±45° foul rails, distance arcs at 120/200/280/360 ft. Dots represent
  batted balls.
  - When HitTrax CSV is uploaded → dots use HitTrax `Spray Chart X` /
    `Spray Chart Z` Cartesian coords (preferred) or `Horiz. Angle` +
    `Dist` polar (fallback). Colored by **Type**: GB red / LD blue /
    FB green.
  - When only Full Swing CSV → dots use `spray_angle` + `distance`
    polar. Colored by EV ramp.
- **Hitting Grades** (right) — three composite grade rows:
  - **Swing** — chips for Mx BS, Av BS, Attack, Tilt, TtC, Plane,
    Conn, Rot. Each chip shows the raw value, color-coded by 20–80
    grade band.
  - **Quality of Contact** — chips for Avg EV, Max EV, Sq-Up, Miss,
    Barrel, LA, Dist. Avg EV / Max EV / LA / Dist are pooled means /
    maxes across HitTrax + Full Swing per-batted-ball values.
  - **Coach Diagnosis** — chips for Fwd Mv, Posture, Stable, Direct,
    Stretch, Core, Slot, Timing. Coach-entered manual 20–80 scores.
- **Diagnosis Notes** — full-width rich-text editor below the grade
  bubbles. Coach can apply Bold / Italic / Underline. Persists as HTML
  in `report.notes`.

Below the snapshot, four **per-source sections** auto-show only when the
active report contains data for them:

- **Coach Grades** — 8 manual scores (Forward Move, Posture, Stability,
  Direction, Stretch, Core, Slot, Timing) on the 20–80 scale, with a
  multi-select of descriptive option tags per category.
- **Full Swing** — Avg EV, Max EV, Sq-Up %, Miss %, Barrel %, LA, Dist.
  All four shared metrics use FULL_SWING-source aggregates only.
- **HitTrax** — Avg EV, Max EV, LA, Dist from HitTrax-source aggregates.
- **Blast Motion** — Mx BS, Av BS, Attack, Tilt, TtC, Plane, Conn, Rot.

Per-section visibility is **truth-based** — a section renders only when
its source actually produced metrics tied to the active report's upload
IDs. Stale slot references with no metric records do NOT light up a
section.

### 3.3 Report modal (create / edit)

Single modal handles every report type. UI sections (per type):

- **CSV upload slots** — one card per vendor relevant to the report
  type. Each card supports drag-drop file upload, file removal, and a
  **"Manual Entry"** toggle (Blast / Full Swing only). Manual mode
  reveals numeric inputs for that vendor's metrics; values save into
  `content.manualBattedBall` / `content.manualSwingMetrics`. A
  `manualEntryModes` flag persists which toggles were ON at save time.
- **Coach grades / multi-select option tags** (Hitting + Pitching).
- **Notes** — rich-text editor (B / I / U toolbar, contenteditable
  surface; HTML stored in `report.notes`).
- **Videos** — drag-drop upload, two sections for Hitting (Swing +
  Swing Decision).

### 3.4 CSV upload pipeline (`apps/api/src/modules/uploads`)

1. Frontend POSTs file + selected vendor source.
2. NestJS service runs `papaparse` (skipping vendor metadata header
   rows automatically), passes rows to a vendor parser.
3. Parser registry auto-detects vendor when source isn't specified —
   each parser exposes a `detectConfidence(headers)` method.
4. Parser emits `ParsedMetric[]` (one per per-row sensor reading).
5. Service does fuzzy player-name matching (or uses `playerId` from the
   request) and bulk-inserts `Metric` rows tagged with the upload's ID.
6. Returns `{ totalRows, metricsCreated, playersMatched, … }` so the
   modal can show the success toast.

Parsers (one per vendor):

- **Blast Motion** — Bat Speed (mph) → `max_bat_speed`, Avg Bat Speed,
  Attack Angle, Time to Contact, On Plane Efficiency, Rotational
  Acceleration, Connection at Impact (→ `connection_at_contact`),
  Plane Angle.
- **Full Swing** — Bat Speed (per-swing), Squared Up % (decimal → %
  transform), Smash Factor, Spray Angle, Distance, Max Exit Velo,
  Launch Angle.
- **HitTrax** — Velo / LA / Dist per row; Spray Chart X / Z as Cartesian
  spray coords; Horiz. Angle as polar fallback; Type column → numeric
  `ball_type_code` (1=GB / 2=LD / 3=FB). Velo=0 rows skipped (takes /
  whiffs).
- **TrackMan** — pitch-level rows with full `rawData` JSON for arsenal
  tables.
- **VALD** — force plate / dynamometer.
- **Vizual Edge** — six-component vision battery.

### 3.5 At-Bat XLSX parser (frontend)

Separate from the CSV pipeline. Coach uploads an At-Bat workbook in the
Hitting report's "At-Bat Assessment" slot. Frontend parses on the spot
and stores the parsed JSON in `report.content.atBatAssessment`. The
Hitting tab reads it for the Swing Decision row's metrics (FB Barrel %,
OS Whiff %, Overall Chase %, etc.).

### 3.6 PDF reports

Generated in-browser via `@react-pdf/renderer`. The Hitting PDF has
exactly three pages:

1. **Cover** — black background, white text. Logo, divider, "DEFINED
   BASEBALL ACADEMY" eyebrow, report title, divider, player name,
   position subtitle, value-only personal info rows (B/T, Height,
   Weight, Grad Year), High School, Club Team, optional College Commit
   badge, footer date.
2. **Snapshot + Notes** — black player info bar (Position / B/T /
   Height / Weight / Class), Spray Chart card + Hitting Grades card
   side-by-side, then full-width DIAGNOSIS NOTES.
3. **Data sections** — Coach Grades, Full Swing, HitTrax, Blast Motion
   (each renders only when the active report has matching data). KPI
   cards color-code value text by the same 20–80 grade-band rule the
   on-screen chips use.

Other report types (Pitching, Defense, Strength, Vision, Summary) follow
the same cover-then-body pattern using shared `PdfPlayerInfoBar`,
`PdfSectionHeader`, `PdfKpiCard`, `PdfScoreBar`, `PdfNotesBox`,
`PdfTable` components from `apps/web/src/lib/pdf/components.tsx`.

### 3.7 20–80 grading + color bands

Single source of truth in `apps/web/src/app/athletes/[id]/helpers.ts`:

- `GRADE_RANGES[metricType]: [min, max]` — linear interpolation from
  raw value to 20–80 grade for most metrics.
- `toScoutingGrade(value, metricType)` — uses GRADE_RANGES, with
  **strict-band overrides** for sweet-spot metrics:
  - **Distance**: `<200` red, `200-300` yellow, `>300` green.
  - **Plane Angle (Tilt)**: Blast records as negative. `0 to -10` red,
    `-10 to -20` yellow, `-20 to -40` green, `<-40` red.
  - **Attack Angle**: `<0` red, `0-15` green, `15-20` yellow, `>20` red.
  - **On Plane Efficiency / Connection / Rotation**: flat 20–80 raw
    band (`<40` red, `40-60` yellow, `>60` green).
- `scoreColor(grade)` — `<40` red `#EF4444`, `40-59` yellow `#EAB308`,
  `≥60` green `#22C55E`. PDF theme uses identical hex values.
- `getBadgeLevel(metricType, value)` — returns `'high' | 'mid' | 'low'`
  using `THRESHOLDS` for two-threshold metrics, with the same
  strict-band overrides for sweet-spot metrics.

### 3.8 Program Schedule (`/program`)

Daily display board for the academy's open-cage / open-mound sessions:

- Schedule type select: Hitting / Pitching / Catching / Infield /
  Outfield / S&C.
- Athlete multi-select picker (2–8). Eligibility filtered by position
  matching the schedule type.
- Date picker with "Jump to next session" shortcut.
- One column per athlete, each column shows the day's drills grouped
  by category. Native browser fullscreen mode for in-cage display.

---

## 4 · Notable UX rules

- **Per-active-report scoping** — every Hitting tab section reads only
  from data attached to the *active* HITTING report's upload IDs. No
  carry-forward from older reports.
- **Per-source isolation** — Full Swing section never displays
  HitTrax-source data and vice versa, even though both vendors emit
  `max_exit_velo` / `launch_angle` / `distance`.
- **Manual-mode gating** — manual values only count when the report's
  `manualEntryModes` flag is on. Toggling Manual Entry off in the
  modal clears the saved values.
- **Strict band colors** for sweet-spot metrics (Distance, Tilt,
  Attack, Plane Score / Connection / Rotation) — chip color flips at
  the exact coach-graded cutoffs, not via linear interpolation.
- **PDF parity** — every numeric color in the PDF matches its in-app
  counterpart. Both use identical hex codes.
- **Black/white/grey theme** — body pages of the PDF use white
  background, black accents (player info bar, section header underline,
  table headers). Cover page is solid black. No teal / blue / gold
  accents anywhere.

---

## 5 · File layout (key starting points)

```
prisma/
  schema.prisma                    ← data model (most important)
apps/api/src/modules/
  uploads/                         ← CSV pipeline + vendor parsers
  metrics/                         ← /players/:id/metrics endpoints
  players/, reports/, drills/, …
apps/web/src/
  app/
    athletes/[id]/
      page.tsx                     ← tabs orchestration
      helpers.ts                   ← grading + threshold logic
      ReportModal.tsx              ← unified create/edit modal
      tabs/
        HittingTab.tsx             ← Hitting Snapshot composition
        SwingTab.tsx               ← per-section cards + chips
        SwingDecisionTab.tsx
        DefenseTab.tsx
        StrengthTab.tsx
        VisionTab.tsx
        PitchRecognitionTab.tsx
        PitchingTab.tsx
        PlayerSummaryTab.tsx
      components/
        SprayChartView.tsx         ← interactive spray chart
    program/page.tsx               ← daily program board
  lib/
    pdf/
      generators.tsx               ← entry points (generateHittingPdf, …)
      HittingReport.tsx            ← Hitting PDF body
      CoverPage.tsx                ← black cover page
      components.tsx               ← shared PDF building blocks
      theme.ts                     ← PDF colors + StyleSheet tokens
  components/assessment/           ← shared UI (ReportSelector, KpiCard, …)
```

---

## 6 · What to ship to Base 44

Bundle for Base 44 to scaffold from:

1. **`prisma/schema.prisma`** — data model.
2. **This document** — feature description.
3. **A handful of representative source files** (so the visual / logic
   language is clear):
   - `apps/web/src/app/athletes/[id]/tabs/SwingTab.tsx`
   - `apps/web/src/app/athletes/[id]/tabs/HittingTab.tsx`
   - `apps/web/src/app/athletes/[id]/components/SprayChartView.tsx`
   - `apps/web/src/lib/pdf/HittingReport.tsx`
   - `apps/web/src/lib/pdf/CoverPage.tsx`
   - `apps/web/src/app/athletes/[id]/helpers.ts`
   - `apps/api/src/modules/uploads/parsers/hittrax-parser.ts` (one
     example CSV parser)

Base 44 should be able to scaffold the data layer + propose a UI from
that combination.
