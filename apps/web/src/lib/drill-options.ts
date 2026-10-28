'use client';

/* Per-drill drop-downs on a Modular set, per position (Hitting: Feed Type /
   Implement / Situation / Goal; Pitching: Reps / Tool / Intensity-Goal).

   The option LISTS are academy-wide and editable in Settings → Drills (one
   tab per drop-down; typing in the blank bottom row adds an option). They're
   stored on the server (/drill-options); until a list is edited it falls
   back to the defaults below, which the API keeps a copy of
   (apps/api/src/modules/drill-options) -- keep the two in step. */

import { useEffect, useState } from 'react';
import * as api from './api';

export interface DrillOptionField {
  key: string;
  label: string;
  /** One pick only (Reps); the rest are multi-select. */
  single?: boolean;
  /** Shown to athletes under the second column (Goal / Intensity). */
  goal?: boolean;
  /** Picked automatically when a drill is added to a set. */
  defaultPick?: string;
  /** How a pick reads to the athlete ("6" → "6 reps"). */
  suffix?: string;
  defaults: string[];
}

export const DRILL_OPTION_FIELDS: Record<string, DrillOptionField[]> = {
  hitting: [
    {
      key: 'feed',
      label: 'Feed Type',
      defaults: [
        'Tee', 'Side Toss', 'Soft Toss', 'Overhead Soft Toss', 'Batting Practice', 'Machine', 'IPitch',
        '1B Angle', '3B Angle', 'Low Angle', 'High Angle', 'Close', 'Far',
        '20 ft', '30 ft', '40 ft', '50 ft', 'Slow', 'Firm', 'Extra Firm',
        '50 mph', '60 mph', '70 mph', '80 mph', '90 mph', '100 mph',
      ],
    },
    {
      key: 'implement',
      label: 'Implement',
      defaults: [
        'Short Bat', '1 Hand Trainer', 'End Load Trainer', 'Handle Load Trainer', 'Power Trainer', 'Bazooka',
        'Underload Trainer', 'V-Paddle', 'V-Bat', 'Smash Trainer', 'Light Skinny Bat', 'Heavy Skinny Bat', 'Cricket Bat',
        'Fat Grip', 'Black Farm Band', 'Red Farm Band', 'Decel Vest', 'Farm Board Long', 'Farm Board Short',
        'Yoga Blocks', 'Bosu Ball', 'Wedge', 'Bucket', 'Havoc', 'Vector Bands', 'Farm Sled', 'Water Ball',
        'Water Bag (Heavy)', 'Water Bag (Light)', '2x Water Ball', '3oz Ball', '200g Ball', '250g Ball',
        '7oz Tater Ball', 'Tater Ball', 'Driveline Ball', 'Wiffle Ball', 'Tennis Ball', 'Soccer Ball',
        'Mini Wiffle Ball',
      ],
    },
    {
      key: 'situation',
      label: 'Situation',
      defaults: [
        'Fastball', 'Carry Fastball', '2-Seam', 'Sinker', 'Slider', 'Sweeper', 'Slurve', '12-6', 'Changeup',
        'Splitter', 'Mix', '0-0', '1-1', '2-0', '0-2', '3-1', '3-2', 'Infield In', 'Infield Back',
        'Get Him Over', 'Get Him In', 'Game on the Line',
      ],
    },
    {
      key: 'goal',
      label: 'Goal',
      goal: true,
      defaults: ['Line Drive', 'Ground Ball', 'Fly Ball', 'Pull', 'Middle', 'Oppo', 'Oppo Foul', 'Pull Foul'],
    },
  ],
  pitching: [
    { key: 'reps', label: 'Reps', single: true, defaultPick: '6', suffix: ' reps', defaults: ['2', '4', '6', '8', '10', '12'] },
    { key: 'tool', label: 'Tool', defaults: [] },
    {
      key: 'intensity',
      label: 'Intensity/Goal',
      goal: true,
      defaults: ['30%', '40%', '50%', '60%', '70%', '80%', '90%', '100%'],
    },
  ],
};

/** The drop-downs a position's Modular drills get (other positions keep
 *  Hitting's, as before). */
export function drillOptionFields(tab: string): DrillOptionField[] {
  return DRILL_OPTION_FIELDS[tab] || DRILL_OPTION_FIELDS.hitting;
}

/** Athlete table headings for a position's two drop-down columns. */
export function drillOptionColumns(tab: string): { env: string; goal: string } {
  return tab === 'pitching' ? { env: 'Reps & Tool', goal: 'Intensity / Goal' } : { env: 'Environment', goal: 'Goal' };
}

export type DrillOptionLists = Record<string, Record<string, string[]>>;

/* One fetch shared by every picker on the page; Settings fires the event
   after an edit so open pickers pick up the change. */
export const DRILL_OPTIONS_CHANGED = 'drill-options:changed';
let cache: DrillOptionLists | null = null;
let inflight: Promise<DrillOptionLists> | null = null;

function load(force = false): Promise<DrillOptionLists> {
  if (force) { cache = null; inflight = null; }
  if (cache) return Promise.resolve(cache);
  inflight ||= api.getDrillOptions()
    .then((lists) => (cache = lists))
    .catch(() => ({}))
    .finally(() => { inflight = null; });
  return inflight;
}

/** Saved lists replace the defaults; call after an edit to share it. */
export function setDrillOptionLists(lists: DrillOptionLists) {
  cache = lists;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(DRILL_OPTIONS_CHANGED));
}

/** Options for one drop-down: the academy's saved list, else the default. */
export function optionsFor(lists: DrillOptionLists | null, tab: string, field: DrillOptionField): string[] {
  return lists?.[tab]?.[field.key] ?? field.defaults;
}

/** The academy's drop-down lists (coaches; null until loaded). */
export function useDrillOptionLists(enabled = true): DrillOptionLists | null {
  const [lists, setLists] = useState<DrillOptionLists | null>(cache);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    load().then((l) => { if (live) setLists(l); });
    const onChange = () => setLists(cache);
    window.addEventListener(DRILL_OPTIONS_CHANGED, onChange);
    return () => { live = false; window.removeEventListener(DRILL_OPTIONS_CHANGED, onChange); };
  }, [enabled]);
  return lists;
}
