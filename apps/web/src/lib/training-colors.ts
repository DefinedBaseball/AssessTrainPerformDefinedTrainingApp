/**
 * Training/program tab + category color system.
 *
 * Lifted out of `apps/web/src/app/training/page.tsx` so the Player
 * Summary's Upcoming Drills panel can render its scheduled-drill cards
 * with the SAME color treatment the Training day-column cards use —
 * one shared source of truth keeps the two surfaces aligned when
 * categories or shades evolve.
 *
 * Each tab has a base hue (Hitting blue / Pitching orange / Catching
 * teal / Infield green / Outfield lime / S & C red). Categories within
 * a tab graduate from LIGHTEST → DARKEST top-to-bottom (Movement Prep
 * → Live / Post-Throw / Cool Down).
 */

import { DRILL_TAXONOMY } from './drill-taxonomy.generated';

export const TAB_LABELS: Record<string, string> = {
  hitting: 'Hitting',
  pitching: 'Pitching',
  catching: 'Catching',
  infield: 'Infield',
  outfield: 'Outfield',
  strength: 'S&C',
};

/* Single-day-view tab badge colors — unified app-wide palette. */
export const TAB_COLORS: Record<string, { bg: string; text: string }> = {
  hitting:  { bg: 'rgba(59,130,246,0.15)',  text: '#3B82F6' },
  pitching: { bg: 'rgba(245,158,11,0.15)',  text: '#F59E0B' },
  catching: { bg: 'rgba(20,184,166,0.15)',  text: '#14B8A6' },
  infield:  { bg: 'rgba(34,197,94,0.15)',   text: '#22C55E' },
  outfield: { bg: 'rgba(34,197,94,0.15)',   text: '#22C55E' },
  strength: { bg: 'rgba(239,68,68,0.15)',   text: '#EF4444' },
};

/* Per-tab, per-category colors — DERIVED from the generated taxonomy
   (drill-taxonomy.generated.ts) so a workbook re-import updates every
   drill-category surface at once. Unknown categories fall back to
   DEFAULT_CAT_COLOR via getTabCatStyle below. */
export const TAB_CAT_COLORS: Record<string, Record<string, { dot: string; bg: string; text: string }>> =
  Object.fromEntries(
    Object.entries(DRILL_TAXONOMY).map(([tab, cats]): [string, Record<string, { dot: string; bg: string; text: string }>] => [
      tab,
      Object.fromEntries(
        cats.map((c): [string, { dot: string; bg: string; text: string }] => [c.id, { dot: c.dot, bg: c.bg, text: c.text }]),
      ),
    ]),
  );

export const DEFAULT_CAT_COLOR = { dot: '#5A9BD5', bg: 'rgba(90,155,213,0.13)', text: '#5A9BD5' };

/**
 * Per-tab "anchor" shade used to color every category title across
 * that tab's drill cards in the Upcoming Drills panel (LIGHT theme).
 * Each value picks the COLUMN's "core activity" category color so
 * the title labels read as one unified darker shade per tab while
 * the divider beneath each title still steps through the per-
 * category gradient.
 *
 *   Hitting   → Machine    (deep navy blue)
 *   Pitching  → Bullpen    (full-saturation orange)
 *   Catching  → Machine    (teal anchor)
 *   Infield   → Machine    (green anchor)
 *   Outfield  → Machine    (lime anchor)
 *   Strength  → Exercises  (red anchor)
 */
export const TAB_ANCHOR_COLORS: Record<string, string> = {
  hitting:  '#1E5DA0',
  pitching: '#F59E0B',
  catching: '#14B8A6',
  infield:  '#38A850',
  outfield: '#88B838',
  strength: '#EF4444',
};

/**
 * Per-tab DARK-theme anchor shade — uses the column's "Drills"
 * category color (or the equivalent secondary-lightest tone for
 * tabs that don't have a "Drills" category, like Strength). Reads
 * lighter than the LIGHT-theme anchor so the title labels still
 * contrast well against the dark panel surface while keeping the
 * "unified shade per tab" feel.
 *
 *   Hitting   → Drills      (#5E9ED2  light blue)
 *   Pitching  → Drills      (#F8B85E  tangerine)
 *   Catching  → Drills      (#5FD4B5  mid teal)
 *   Infield   → Drills      (#6ED06E  mid green)
 *   Outfield  → Drills      (#B8D870  mid lime)
 *   Strength  → Exercises   (#EF4444  red — no "Drills" category)
 */
export const TAB_ANCHOR_COLORS_DARK: Record<string, string> = {
  hitting:  '#5E9ED2',
  pitching: '#F8B85E',
  catching: '#5FD4B5',
  infield:  '#6ED06E',
  outfield: '#B8D870',
  strength: '#EF4444',
};

/** Per-tab canonical category order — used so cards inside a tab
 *  always render Movement Prep first, Live / Post-Throw / Cool Down
 *  last, with the working categories in the middle in coach-spec
 *  order. */
export const LEGEND_CATEGORIES: Record<string, string[]> =
  Object.fromEntries(
    Object.entries(DRILL_TAXONOMY).map(([tab, cats]): [string, string[]] => [tab, cats.map((c) => c.id)]),
  );

/** Top-to-bottom tab order used by anywhere the Player Summary mixes
 *  multiple tabs into a single scrollable feed (Upcoming Drills). */
export const TAB_ORDER: readonly string[] = [
  'hitting', 'pitching', 'catching', 'infield', 'outfield', 'strength',
];

/** Resolve the visual styling for a (tab, category) pair. Falls back to
 *  `DEFAULT_CAT_COLOR` for unknown combinations so the renderer never
 *  crashes on a freshly-added or mistyped category. */
export function getTabCatStyle(tab: string, category: string) {
  const c = TAB_CAT_COLORS[tab]?.[category] || DEFAULT_CAT_COLOR;
  return {
    dot:       c.dot,
    bg:        c.bg,
    text:      c.text,
    dotStyle:  { background: c.dot },
    bgStyle:   { background: c.bg, borderLeft: `3px solid ${c.dot}` },
    textStyle: { color: c.text },
  };
}

/**
 * Map a `Video.category` string (HITTING / PITCHING / CATCHING / …)
 * to the matching tab-color palette so video-bundle bubbles tint
 * their background + border + header text by content type.
 *
 *   Hitting → blue, Pitching → orange, Catching → teal,
 *   Infield / Outfield / generic Fielding → green,
 *   Strength / Workout Demo → red.
 *
 * Categories not in the palette (GAME, anything new) get a neutral
 * white tint so the bubble still reads as grouped without claiming
 * a misleading category color.
 */
const VIDEO_CATEGORY_TO_TAB: Record<string, keyof typeof TAB_COLORS> = {
  HITTING:      'hitting',
  PITCHING:     'pitching',
  CATCHING:     'catching',
  INFIELD:      'infield',
  OUTFIELD:     'outfield',
  /* `FIELDING` is the legacy combined-defense category used by the
     /videos page filters; map it to the same green the position-
     specific Infield bubble uses so legacy clips keep the family
     color. */
  FIELDING:     'infield',
  STRENGTH:     'strength',
  /* `WORKOUT_DEMO` is what the videos-page filter exposes for
     S & C videos — same red palette as the position-specific
     STRENGTH category. */
  WORKOUT_DEMO: 'strength',
};

export interface VideoCategoryColors {
  /** Subtle tinted background for the bundle bubble. */
  bg: string;
  /** Saturated accent color — used as the solid border AND the
   *  bubble header text. */
  text: string;
  /** Same as `text` — semantic alias for callers that want to
   *  read "border" explicitly. */
  border: string;
}

export function getVideoCategoryColors(category: string | null | undefined): VideoCategoryColors {
  const key = category && VIDEO_CATEGORY_TO_TAB[category.toUpperCase()];
  if (!key) {
    /* Neutral fallback — keeps bubbles for GAME / unknown
       categories visually grouped without falsely tinting them as
       a known sport-specific category. */
    return {
      bg:     'rgba(255, 255, 255, 0.04)',
      text:   'rgba(255, 255, 255, 0.55)',
      border: 'rgba(255, 255, 255, 0.22)',
    };
  }
  /* Pull the LIGHTEST shade of each tab's palette (the "Movement
     Prep" tier in `TAB_CAT_COLORS`). Hitting → pastel blue,
     Pitching → peach, Catching → mint, Infield → mint-green,
     Outfield → lime, Strength → pink. The bolder `TAB_COLORS`
     values would tint the bubble too heavily for a content-grouping
     surface — Movement Prep is the calmest shade in the family and
     reads as a tint without overwhelming the inner card. */
  const mp = TAB_CAT_COLORS[key]?.['Movement Prep'];
  if (mp) {
    return {
      bg:     mp.bg,
      text:   mp.text,
      border: mp.dot,
    };
  }
  /* Defensive fallback to the bolder TAB_COLORS palette if a future
     tab forgets its Movement Prep entry — keeps the helper from
     returning undefined for any known key. */
  const t = TAB_COLORS[key];
  return {
    bg:     t.bg,
    text:   t.text,
    border: t.text,
  };
}
