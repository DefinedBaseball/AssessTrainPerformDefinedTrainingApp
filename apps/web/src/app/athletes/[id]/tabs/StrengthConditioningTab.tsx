'use client';

/**
 * StrengthConditioningTab — completely re-imagined per coach-spec.
 *
 * Three big dark-blue `.profilePanel` bubbles stack vertically:
 *
 *   1) STRENGTH      — Force & Athletic Testing (VALD CMJ + power
 *                      notes) and Grip Strength, each in their own
 *                      warm-grey Curveball-style sub-bubble.
 *
 *   2) SPEED         — 60 Yard Dash, 40 Yard Dash, Top Speed,
 *                      Acceleration — each in its own warm-grey
 *                      sub-bubble (matches the Pitching tab's
 *                      per-pitch ArsenalCard pattern).
 *
 *   3) MOBILITY      — Warm-Up Observation sub-block at the top,
 *                      then 12 warm-grey Curveball-style cards (one
 *                      per assessment from the PDF spec). Each card
 *                      carries title + hairline + Throwing/Glove
 *                      Pass/Fail + Asymmetry Y/N + notes + ❓ How
 *                      to Perform popover + 🚩 Red Flags popover +
 *                      Mechanical Notes.
 *
 * DISPLAY-ONLY: the profile no longer accepts direct text entry.
 * Every metric, toggle, and note renders as a read-only chip / text
 * row sourced from the active report's parsed `content` blob. Data
 * entry happens via the existing Report modal flow (which is where
 * every other tab also collects its structured form data). When the
 * report content schema for S&C arrives, the helpers below pluck
 * keys out of `report.content` directly — until then everything
 * shows the `—` placeholder.
 */

import { LiftingDashboard } from '@/components/lifting/LiftingDashboard';
import { rem } from '@/lib/rem';
import { useEffect, useMemo, useState } from 'react';
import {
  TabBarActions,
  TabBarSub,
  DownloadPdfButton,
  ReportSelector,
} from '@/components/assessment';
import aStyles from '@/components/assessment/assessment.module.css';
import { generateStrengthPdf } from '@/lib/pdf';
import { movementPlotBubbleStyle } from './SwingTab';
import {
  TabProps,
  type ReportSummary,
} from '../helpers';

const REPORT_TYPES = ['STRENGTH'];

/* ─────────────────────────────────────────────────────────────────────
   Content blob shape — the structured fields the S&C tab expects to
   find under `report.content` once the Report modal grows its S&C
   form. Until then every field is undefined and the UI shows the
   `—` placeholder.
   ─────────────────────────────────────────────────────────────── */
export interface SCContent {
  warmup?: {
    flags?: { mobility?: boolean; arm?: boolean; asymmetry?: boolean; athleticism?: boolean };
    notes?: string;
  };
  forceAthletic?: {
    cmjHeight?: string; peakForceLeft?: string; peakForceRight?: string;
    asymmetryIndex?: string; rotationalPower?: string;
    notes?: string;
  };
  gripStrength?: {
    throwing?: string; glove?: string; asymmetryIndex?: string; notes?: string;
  };
  speed?: {
    sixty?: string; forty?: string; top?: string; accel?: string;
    /** 10 Yard Dash (sec). The Speed section now surfaces 60 + 10 Yard
     *  Dash; forty/top/accel are kept for older-report back-compat but
     *  are no longer rendered. */
    ten?: string;
  };
  /** Vision (Physical report). `acuity` = ratio achieved (e.g. "20/20");
   *  `acuityWrong` = # missed on that line -> rendered "20/20 - 1". The
   *  four fields below are coach-entered 20-80 grades. */
  vision?: {
    acuity?: string; acuityWrong?: string;
    objectTracking?: string; timing?: string;
    anticipation?: string; peripheral?: string;
  };
  /** Motor Preferences -- five coach-entered binary motor-preference
   *  toggles. Report-only: saved with the report + shown in the report
   *  form, but NOT rendered on the athlete's profile S&C tab. */
  motorPreferences?: {
    eye?: string;             // 'R' | 'L'
    shoulder?: string;        // 'R' | 'L'
    strengthSpacing?: string; // 'Axial' | 'Large'
    groundUse?: string;       // 'Terrestrial' | 'Aerial'
    movementPath?: string;    // 'Horizontal' | 'Vertical'
  };
  /** Indexed 1-12 to match the MOBILITY_TESTS catalog. Each entry
   *  is a free-form key→string map — the per-test field schema lives
   *  in `MOBILITY_TESTS[N].fields`. Values are stored as strings
   *  (Pass/Fail toggles save `"pass"` | `"fail"`; Y/N toggles save
   *  `"yes"` | `"no"`; numeric + text inputs save their raw string
   *  value). The conventional `"mechNotes"` key holds the always-
   *  present Mechanical Notes textarea text per card. */
  mobility?: Record<number, Record<string, string | undefined>>;
}

/* Per-test field definition. Drives both the read-only profile
   rendering AND the editable report form. */
export type MobilityFieldType = 'pass-fail' | 'yes-no' | 'number' | 'text';
export interface MobilityField {
  key: string;
  label: string;
  type: MobilityFieldType;
  /** Optional unit suffix shown next to the label (e.g. `lb/kg`,
   *  `0-5`). Purely cosmetic — value is still stored as a string. */
  unit?: string;
  /** Optional placeholder for `text`-type fields. */
  placeholder?: string;
}
export interface MobilityTest {
  number: number;
  title: string;
  howTo: string;
  redFlags: string;
  fields: MobilityField[];
}

function parseSCContent(report: ReportSummary | null): SCContent {
  if (!report?.content) return {};
  try {
    const parsed = JSON.parse(report.content);
    return parsed?.strengthConditioning ?? {};
  } catch { return {}; }
}

/* ─────────────────────────────────────────────────────────────────────
   MOBILITY TEST CATALOG
   14 entries, each with:
     • number     — 1-based ordering shown as the bubble's leading badge
     • title      — eyebrow label on the bubble's first line
     • howTo      — long-form "How to perform" guidance (❓ tooltip)
     • redFlags   — long-form "Red flags" guidance (🚩 tooltip)

   Tests #5 (Prone ER) and #6 (Prone IR) measure RANGE OF MOTION
   (no `Strength` in the title, no `lb/kg` unit on the value fields);
   tests #7 (Prone ER Strength) and #8 (Prone IR Strength) measure
   STRENGTH against resistance with lb/kg units. ROM is screened
   first, strength is screened second — matches the typical
   shoulder-eval sequence in the PDF spec.
   ─────────────────────────────────────────────────────────────── */
export const MOBILITY_TESTS: MobilityTest[] = [
  {
    number: 1,
    title: 'Cross-Body Shoulder Stretch',
    howTo: 'Athlete pulls throwing arm across chest using opposite hand. Note how far elbow crosses midline. Repeat with glove arm. Compare side-to-side range and any compensations.',
    redFlags: "Throwing-arm elbow can't cross midline. Significant side-to-side asymmetry. Indicates posterior shoulder tightness — common in pitchers.",
    fields: [
      { key: 'throwArm',  label: 'Throwing Arm',        type: 'pass-fail' },
      { key: 'gloveArm',  label: 'Glove Arm',           type: 'pass-fail' },
      { key: 'asymmetry', label: 'Asymmetry Observed',  type: 'yes-no' },
    ],
  },
  {
    number: 2,
    title: 'Wall Angel / Overhead Reach',
    howTo: 'Athlete stands with back flat against wall, arms in goalpost position. Slides arms overhead while keeping lower back, shoulders, and wrists in contact with wall throughout the movement.',
    redFlags: 'Inability to reach full overhead without arching back = thoracic stiffness + shoulder flexion restriction. Both directly limit arm path and posture on the mound.',
    fields: [
      { key: 'fullOverhead', label: 'Full Overhead Reach Maintained', type: 'pass-fail' },
      { key: 'backArches',   label: 'Lower Back Arches Off Wall',     type: 'yes-no' },
      { key: 'wristsLeave',  label: 'Wrists Leave Wall',              type: 'yes-no' },
    ],
  },
  {
    number: 3,
    title: 'Scapular Dyskinesis — Bilateral Flexion',
    howTo: 'Athlete holds 3–5 lb dumbbells. Raises both arms forward and overhead, then lowers slowly. 5–10 reps. Watch scapular motion during the LOWERING phase especially.',
    redFlags: 'Medial border winging, inferior angle prominence, early/excessive shrugging, failure to upwardly rotate smoothly. Any of these = dyskinesis present.',
    fields: [
      { key: 'winging',     label: 'Winging Present (Throwing Side)',         type: 'yes-no' },
      { key: 'dysrhythmia', label: 'Dysrhythmia / Jerky Motion',              type: 'yes-no' },
      { key: 'asymmetry',   label: 'Asymmetry vs. Non-Throwing Side',         type: 'yes-no' },
    ],
  },
  {
    number: 4,
    title: 'Scapular Dyskinesis — Bilateral Abduction',
    howTo: 'Same as above but arms raise OUT TO THE SIDES (scaption plane is fine — slight forward angle). 5–10 reps with slow lowering. Watch the scaps.',
    redFlags: 'Abduction often exposes deficits that flexion misses. Same flag criteria apply.',
    fields: [
      { key: 'winging',     label: 'Winging Present (Throwing Side)',         type: 'yes-no' },
      { key: 'dysrhythmia', label: 'Dysrhythmia / Jerky Motion',              type: 'yes-no' },
      { key: 'asymmetry',   label: 'Asymmetry vs. Non-Throwing Side',         type: 'yes-no' },
    ],
  },
  {
    /* ── NEW ROM (no-strength) ER ── inserted ahead of the strength
       version so the eval flow is ROM → Strength. Same field keys
       as the strength version below but with NO `lb/kg` unit so the
       numeric inputs render unit-less (typically used for degrees
       of passive external rotation). */
    number: 5,
    title: 'Prone External Rotation (90/90)',
    howTo: 'Athlete prone with shoulder at 90° abduction, elbow at 90°, off edge of table. Forearm hangs down. Athlete rotates forearm UP toward ceiling — PASSIVE range only, no resistance applied. Measures available external-rotation ROM in the throwing position.',
    redFlags: 'Throwing arm ER should be ≥ 90–95% of non-throwing arm. Loss of throwing-arm ER vs. non-throwing arm flags posterior capsule tightness — common in pitchers and a precursor to internal impingement.',
    fields: [
      { key: 'throwingER',    label: 'Throwing Arm ER',     type: 'number' },
      { key: 'nonThrowingER', label: 'Non-Throwing Arm ER', type: 'number' },
      { key: 'ratio',         label: 'Side-to-Side Ratio',  type: 'number' },
    ],
  },
  {
    /* ── NEW ROM (no-strength) IR ── companion to #5; pairs with
       Test 8 (Prone IR Strength) for the strength leg of the
       same shoulder eval. No unit on the numeric inputs. */
    number: 6,
    title: 'Prone Internal Rotation (90/90)',
    howTo: 'Same setup as Test 5, but athlete rotates forearm DOWN toward the floor — PASSIVE range only, no resistance applied. Measures available internal-rotation ROM.',
    redFlags: 'GIRD (Glenohumeral Internal Rotation Deficit) > 20° vs. non-throwing arm is a significant flag for posterior shoulder tightness and elevated injury risk.',
    fields: [
      { key: 'throwingIR',    label: 'Throwing Arm IR',     type: 'number' },
      { key: 'nonThrowingIR', label: 'Non-Throwing Arm IR', type: 'number' },
      { key: 'ratio',         label: 'Side-to-Side Ratio',  type: 'number' },
    ],
  },
  {
    number: 7,
    title: 'Prone External Rotation Strength (90/90)',
    howTo: 'Athlete prone with shoulder at 90° abduction, elbow at 90°, off edge of table. Forearm hangs down. Athlete rotates forearm UP toward ceiling against resistance applied at wrist. Mimics throwing position.',
    redFlags: 'Throwing arm ER should be ≥ 90–95% of non-throwing arm. Throwing arm WEAKER than non-throwing in ER is a significant red flag.',
    fields: [
      { key: 'throwingER',    label: 'Throwing Arm ER',    type: 'number', unit: 'lb/kg' },
      { key: 'nonThrowingER', label: 'Non-Throwing Arm ER', type: 'number', unit: 'lb/kg' },
      { key: 'ratio',         label: 'Side-to-Side Ratio',  type: 'number' },
    ],
  },
  {
    number: 8,
    title: 'Prone Internal Rotation Strength (90/90)',
    howTo: 'Same setup as Test 7, but athlete rotates forearm DOWN toward the floor against resistance applied at the wrist.',
    redFlags: 'Throwing arm IR is typically 10–15% stronger than non-throwing due to training adaptation. Symmetry or weakness in throwing arm IR is unusual and warrants follow-up.',
    fields: [
      { key: 'throwingIR',    label: 'Throwing Arm IR',    type: 'number', unit: 'lb/kg' },
      { key: 'nonThrowingIR', label: 'Non-Throwing Arm IR', type: 'number', unit: 'lb/kg' },
      { key: 'ratio',         label: 'Side-to-Side Ratio',  type: 'number' },
    ],
  },
  {
    number: 9,
    title: 'Lower Trapezius — Y Position (MMT)',
    howTo: 'Athlete prone, arm overhead at ~120° abduction (Y shape), thumb up. Athlete lifts arm off table as high as possible. Apply downward resistance just above elbow. Watch for upper trap shrug = fail.',
    redFlags: 'Lower trap weakness is the single most common scapular finding in pitchers. Correlates with anteriorly tilted, protracted resting scapula posture.',
    fields: [
      { key: 'throwingStr',    label: 'Throwing Arm',         type: 'number', unit: '0-5' },
      { key: 'nonThrowingStr', label: 'Non-Throwing Arm',     type: 'number', unit: '0-5' },
      { key: 'substitution',   label: 'Substitution Observed', type: 'yes-no' },
    ],
  },
  {
    number: 10,
    title: 'Middle Trapezius — T Position (MMT)',
    howTo: 'Athlete prone, arm straight out to the side at 90° abduction (T shape), thumb up. Athlete lifts arm off table. Apply downward resistance just above elbow.',
    redFlags: 'Middle trap weakness contributes to scapular protraction and poor retraction during the throw.',
    fields: [
      { key: 'throwingStr',    label: 'Throwing Arm',         type: 'number', unit: '0-5' },
      { key: 'nonThrowingStr', label: 'Non-Throwing Arm',     type: 'number', unit: '0-5' },
      { key: 'substitution',   label: 'Substitution Observed', type: 'yes-no' },
    ],
  },
  {
    number: 11,
    title: 'Rhomboids / Mid-Trap — W Position (MMT)',
    howTo: 'Athlete prone, elbows bent ~90°, arms in goalpost (W shape). Athlete pinches shoulder blades together and lifts arms off table. Apply downward resistance at elbows.',
    redFlags: 'Often OVER-developed in pitchers (rhomboid dominance). Pitchers often pull into adduction / downward rotation via rhomboids when they should be upwardly rotating.',
    fields: [
      { key: 'throwingStr',    label: 'Throwing Arm',         type: 'number', unit: '0-5' },
      { key: 'nonThrowingStr', label: 'Non-Throwing Arm',     type: 'number', unit: '0-5' },
      { key: 'substitution',   label: 'Substitution Observed', type: 'yes-no' },
    ],
  },
  {
    number: 12,
    title: 'Hip 90/90 Screen',
    howTo: 'Athlete sits on ground with both legs at 90° (front leg internally rotated, back leg externally rotated). Can athlete sit upright without falling back or rotating the trunk? Repeat opposite side.',
    redFlags: 'Failure flags hip flexor or hip IR restriction — directly limits stride length and hip-shoulder separation on the mound.',
    fields: [
      { key: 'throwingHip', label: 'Throwing-Side Hip',  type: 'pass-fail' },
      { key: 'gloveHip',    label: 'Glove-Side Hip',     type: 'pass-fail' },
      { key: 'asymmetry',   label: 'Asymmetry Observed', type: 'yes-no' },
    ],
  },
  {
    number: 13,
    title: 'Seated Thoracic Rotation',
    howTo: 'Athlete sits on bench, arms crossed across chest. Rotates each direction as far as possible. Note visible asymmetry — one side noticeably stiffer than the other.',
    redFlags: 'T-spine stiffness shows up as posture / direction issues on the mound. Asymmetry often correlates with the dominant side being tighter.',
    fields: [
      { key: 'leftRot',   label: 'Left Rotation',      type: 'pass-fail' },
      { key: 'rightRot',  label: 'Right Rotation',     type: 'pass-fail' },
      { key: 'asymmetry', label: 'Asymmetry Observed', type: 'yes-no' },
    ],
  },
  {
    number: 14,
    title: 'Overhead Deep Squat',
    howTo: 'Athlete holds arms fully overhead and squats to full depth. Note where form breaks down first (ankle dorsiflexion, hip mobility, or thoracic extension).',
    redFlags: 'Any fail = flag for deeper evaluation. Catches mobility deficits across multiple joints in one screen.',
    fields: [
      { key: 'result',         label: 'Pass / Fail',     type: 'pass-fail' },
      { key: 'breakdownPoint', label: 'Breakdown Point', type: 'text', placeholder: 'ankle / hip / thoracic' },
      { key: 'compensations',  label: 'Compensations',   type: 'text', placeholder: 'heels lift / knees collapse / arms drop' },
    ],
  },
];

/* ─────────────────────────────────────────────────────────────────────
   READ-ONLY DISPLAY PRIMITIVES
   The profile S&C tab no longer accepts direct text entry. Every
   field renders as a static read-only chip / row. Data entry happens
   in the Report modal (which mutates `report.content` → re-renders
   the profile with fresh values).
   ─────────────────────────────────────────────────────────────── */

/* Static Pass/Fail badge — green for pass, red for fail, dim "—" for
   unset. Replaces the previous interactive PassFailToggle. */
function PassFailBadge({ value }: { value: 'pass' | 'fail' | undefined | null }) {
  if (value === 'pass') {
    return <Badge color="rgba(76,201,118,0.22)" border="rgba(76,201,118,0.65)" text="#a7e6b8">Pass</Badge>;
  }
  if (value === 'fail') {
    return <Badge color="rgba(231,98,98,0.22)" border="rgba(231,98,98,0.65)" text="#f0a8a8">Fail</Badge>;
  }
  return <DimDash />;
}

/* Static Yes/No badge — red for "yes" (problem present), blue for
   "no", dim "—" for unset. */
function YesNoBadge({ value }: { value: 'yes' | 'no' | undefined | null }) {
  if (value === 'yes') {
    return <Badge color="rgba(231,98,98,0.22)" border="rgba(231,98,98,0.65)" text="#f0a8a8">Yes</Badge>;
  }
  if (value === 'no') {
    return <Badge color="rgba(126,182,255,0.20)" border="rgba(126,182,255,0.55)" text="#cfe0ff">No</Badge>;
  }
  return <DimDash />;
}

function Badge({
  color, border, text, children,
}: {
  color: string; border: string; text: string; children: React.ReactNode;
}) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '4px 12px',
      borderRadius: 6,
      border: `1px solid ${border}`,
      background: color,
      color: text,
      fontSize: rem(11),
      fontWeight: 700,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      fontFamily: 'inherit',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

/** DisplayField — switches on the field type and renders the
 *  appropriate read-only widget (Pass/Fail badge, Yes/No badge,
 *  numeric value, or plain text). Used inside each MobilityCard's
 *  horizontal field strip. */
function DisplayField({
  field, value,
}: { field: MobilityField; value: string | undefined }) {
  const empty = !value || value.trim() === '';
  if (field.type === 'pass-fail') {
    return <PassFailBadge value={value as 'pass' | 'fail' | undefined} />;
  }
  if (field.type === 'yes-no') {
    return <YesNoBadge value={value as 'yes' | 'no' | undefined} />;
  }
  if (field.type === 'number') {
    return (
      <span style={{
        display: 'inline-block',
        padding: '4px 12px',
        borderRadius: 6,
        border: '1px solid var(--border)',
        background: 'rgba(255,255,255,0.04)',
        color: empty ? 'var(--text-muted)' : 'var(--text-bright)',
        fontSize: rem(13),
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '-0.01em',
        fontFamily: 'inherit',
        opacity: empty ? 0.6 : 1,
        whiteSpace: 'nowrap',
      }}>
        {empty ? '—' : value}
      </span>
    );
  }
  /* text */
  return (
    <span style={{
      display: 'inline-block',
      padding: '4px 10px',
      borderRadius: 6,
      border: '1px solid var(--border)',
      background: 'rgba(255,255,255,0.03)',
      color: empty ? 'var(--text-muted)' : 'var(--text-bright)',
      fontSize: rem(12),
      fontStyle: empty ? 'italic' : 'normal',
      fontFamily: 'inherit',
      opacity: empty ? 0.6 : 1,
    }}>
      {empty ? (field.placeholder ?? '—') : value}
    </span>
  );
}

function DimDash() {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '4px 12px',
      borderRadius: 6,
      border: '1px solid var(--border)',
      background: 'rgba(255,255,255,0.02)',
      color: 'var(--text-muted)',
      fontSize: rem(11),
      fontWeight: 700,
      letterSpacing: '0.06em',
      fontFamily: 'inherit',
      opacity: 0.6,
    }}>
      —
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   HoverPopover — same component as the original interactive version
   (used by the ❓ and 🚩 icons on each MobilityCard).

   Exported so the editable Report form (StrengthConditioningForm) can
   reuse the same component for its mobility-card icon pair — keeps
   the profile + form visually identical.
   ─────────────────────────────────────────────────────────────── */
export function HoverPopover({
  anchor, title, body, side, accentColor,
}: {
  anchor: React.ReactNode;
  title: string;
  body: string;
  side: 'top-right' | 'bottom-right';
  accentColor: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {anchor}
      {open && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            zIndex: 20,
            width: 260,
            right: 0,
            ...(side === 'top-right'
              ? { top: 'calc(100% + 6px)' }
              : { bottom: 'calc(100% + 6px)' }),
            background: 'rgba(10, 14, 20, 0.96)',
            border: `1px solid ${accentColor}`,
            borderRadius: 10,
            padding: 12,
            color: 'var(--text-bright)',
            fontSize: rem(12),
            lineHeight: 1.45,
            boxShadow: '0 10px 28px rgba(0, 0, 0, 0.45)',
            pointerEvents: 'none',
          }}
        >
          <div style={{
            fontSize: rem(10),
            fontWeight: 800,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: accentColor,
            marginBottom: 6,
          }}>
            {title}
          </div>
          {body}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   MobilityCard — DISPLAY-ONLY warm-grey bubble. Reads its values
   from the parsed report's `mobility[N]` entry; falls back to "—"
   placeholders when the field is unset.
   ─────────────────────────────────────────────────────────────── */
function MobilityCard({
  number, title, howTo, redFlags, fields, value, starred,
}: {
  number: number;
  title: string;
  howTo: string;
  redFlags: string;
  fields: MobilityField[];
  value?: Record<string, string | undefined>;
  /** Read-only star indicator. When true, a gold ★ chip renders at
   *  the top-right of the card (between the existing ❓ and 🚩
   *  icons would be too crowded, so it sits FIRST in the trio).
   *  When false, the chip is omitted entirely — keeping the card
   *  visually clean for non-starred tests. */
  starred?: boolean;
}) {
  return (
    <div style={{
      ...movementPlotBubbleStyle,
      /* Horizontal layout — short-and-wide. Padding-right reserves
         a clear corner for the absolutely-positioned 🚩 icon so it
         never overlaps the mechanical notes column to its left.
         Padding-left bumped 7 → 24 per coach-spec so Metric 1 sits
         further from the bubble's left edge with clear breathing
         room. M2 + M3 shift right in lockstep since the columnGap
         between metrics is preserved. */
      padding: '10px 44px 10px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      {/* ── Line 1: title row + inline accent hairline + ❓ icon */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{
          fontSize: rem(11),
          fontWeight: 800,
          color: 'rgba(126,182,255,0.85)',
          letterSpacing: '0.04em',
          minWidth: 22,
        }}>
          #{number}
        </span>
        <span style={{
          /* Mobility card title — matched to the Curveball
             (ArsenalCard) title style in the Pitching tab:
             Satoshi inherit, 1 rem (16 px), weight 600 normal,
             -0.025em letter-spacing, uppercase, white, line-height
             1.05. Was previously 14 px / weight 700 / -0.01em. */
          fontFamily: 'inherit',
          fontSize: '1rem', fontWeight: 600, fontStyle: 'normal',
          color: 'var(--text-bright)', lineHeight: 1.05,
          letterSpacing: '-0.025em',
          textTransform: 'uppercase',
        }}>
          {title}
        </span>
        <div
          aria-hidden="true"
          style={{
            flex: 1,
            height: 1,
            background: 'var(--border)',
            alignSelf: 'flex-end',
            marginBottom: 6,
          }}
        />
        {/* ❓ icon now lives in its own absolute-positioned container
            below (right: 12, top: 10) so it lines up EXACTLY on the
            same X axis as the 🚩 icon (right: 12, bottom: 10). Both
            use the same `right` offset against the card's outer
            edge, so horizontal alignment is pixel-perfect regardless
            of title length or hairline width. */}
      </div>

      {/* ── Line 2: full-width white divider line */}
      <div aria-hidden="true" style={{ height: 1, background: 'var(--border)' }} />

      {/* ── HORIZONTAL field strip ──
            Renders the 3 per-test fields defined in `MOBILITY_TESTS[N]
            .fields` (Pass/Fail / Yes-No / numeric / text) followed by
            the always-present Mechanical Notes column.

            EQUAL `1fr` tracks across all 3 metric columns + a wider
            notes column at the end — matches the editable Report
            form's `MobilityCardForm` exactly so the profile reads
            with the same column rhythm the coach typed into. Was
            `repeat(3, auto)` before, which made numeric-input cards
            (90 px) look noticeably tighter than toggle-button cards
            (~130 px); the new layout normalizes that across all 12
            tests so each card visually matches bubble #2 (Wall
            Angel). */}
      <div style={{
        display: 'grid',
        /* Metric columns widened 100 → 175 px per coach-spec so
           each label has room to wrap inside its own column to its
           `maxWidth: 175` budget. Previously the 100 px track
           constrained the label container, forcing long labels
           ("Full Overhead Reach Maintained", "Lower Back Arches
           Off Wall", "Winging Present (Throwing Side)") to wrap
           to 3+ lines instead of 2. Now every label fits in 2
           lines via natural word-boundary wrapping. Value widgets
           sit centered inside the wider column. */
        gridTemplateColumns: 'repeat(3, 175px) minmax(220px, 1.4fr)',
        /* Inter-metric gap pass 6 — bumped another 60 %
           (48 → 77 px ≈ 48 × 1.6) per coach-spec so Metric 1 / 2
           / 3 land with a generous amount of horizontal breathing
           room. With the fixed 100 px metric columns, every pixel
           of this columnGap shows up 1:1 as visible empty space
           between the value widgets. Notes column's `marginLeft`
           is still retired since 77 px from M3 → Notes is already
           strong separation. */
        columnGap: 77,
        rowGap: 4,
        alignItems: 'start',
      }}>
        {fields.map((f) => (
          <FieldCell key={f.key} label={f.unit ? `${f.label} (${f.unit})` : f.label}>
            <DisplayField field={f} value={value?.[f.key]} />
          </FieldCell>
        ))}
        <FieldCell
          label="Mechanical Notes"
          fill
        >
          <ReadOnlyText
            value={value?.mechNotes}
            placeholder="No mechanical notes."
            multiline
          />
        </FieldCell>
      </div>

      {/* ── (★) + ❓ + 🚩 icon set — absolute top-right corner.
            ★ chip renders ONLY when this card is starred (read-only
            view of the Report form's toggle); when present, it sits
            FIRST in the trio, then ❓, then 🚩. All anchors are
            vertically aligned on the same baseline with `gap: 6`
            between them. The container sits at `right: 12, top: 10`
            so the 🚩's right edge is 12 px from the card's outer
            edge — matches the Report form's icon layout. */}
      <div style={{
        position: 'absolute',
        right: 12,
        top: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        {starred && (
          <div
            title="Starred — coach pinned this test to the top"
            aria-label="Starred test"
            style={{
              width: 22, height: 22,
              borderRadius: '50%',
              border: '1px solid rgba(255,206,84,0.65)',
              background: 'rgba(255,206,84,0.16)',
              color: '#ffce54',
              fontSize: rem(13),
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ★
          </div>
        )}
        <HoverPopover
          side="top-right"
          title="How to Perform"
          body={howTo}
          accentColor="rgba(126,182,255,0.85)"
          anchor={
            <div style={{
              width: 22, height: 22,
              borderRadius: '50%',
              border: '1px solid rgba(126,182,255,0.55)',
              background: 'rgba(126,182,255,0.12)',
              color: '#cfe0ff',
              fontSize: rem(12),
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'help',
            }}>
              ?
            </div>
          }
        />
        <HoverPopover
          side="top-right"
          title="Red Flags"
          body={redFlags}
          accentColor="rgba(231,98,98,0.85)"
          anchor={
            <div style={{
              width: 22, height: 22,
              borderRadius: 6,
              border: '1px solid rgba(231,98,98,0.55)',
              background: 'rgba(231,98,98,0.14)',
              color: '#f0a8a8',
              fontSize: rem(12),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'help',
            }}>
              ⚑
            </div>
          }
        />
      </div>
    </div>
  );
}

/* Field cell — small label on top + value (badge or notes) below.
   Used in the horizontal mobility-card field strip. `fill` lets a
   notes column claim the remaining horizontal track via 1fr. */
function FieldCell({
  label, children, fill, style,
}: {
  label: string;
  children: React.ReactNode;
  fill?: boolean;
  /** Optional inline-style override — used by the Mechanical
   *  Notes cell to set its own `marginLeft` so it preserves the
   *  original wider gap from Metric 3 even after the global
   *  metric-to-metric gap shrunk. */
  style?: React.CSSProperties;
}) {
  /* `alignItems: center` lines the label up on the same vertical
     center axis as the input/toggle/badge below it — without this
     the flex column defaults to `align-items: stretch`, which
     stretches the label across the full column width and renders
     its text left-aligned (so the label and a narrower control
     like a 90 px numeric input look misaligned in the column).
     The Mechanical Notes cell opts BACK to `stretch` via the
     `fill` flag so its inner readout can still take the full
     column width. */
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      minWidth: 0,
      width: fill ? '100%' : undefined,
      alignItems: fill ? 'stretch' : 'center',
      textAlign: fill ? 'left' : 'center',
      ...style,
    }}>
      {/* Label SLOT — fixed `minHeight: 28` reserves exactly two
          lines of vertical space (font-size 10 × line-height 1.2 ×
          2 = 24 px + 4 px buffer). The label inside is TOP-aligned
          within the slot so 1-line labels start at the same Y as
          the first line of 2-line labels. NO truncation per
          coach-spec — full label always visible.

          The `fill` cell (Mechanical Notes column) opts OUT of the
          28 px reservation. That cell's label is always single-line
          ("Mechanical Notes") and the value below it is a textarea,
          not a value widget that needs to align with the other 3
          cells' buttons / inputs. Letting the label sit at its
          natural height pulls the textarea right up under the label
          — matches the spacing of the Movement Notes block in the
          Warm Up Observations bubble. */}
      <div style={{
        minHeight: fill ? undefined : 28,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: fill ? 'flex-start' : 'center',
        width: fill ? '100%' : undefined,
      }}>
        <span style={{
          ...fieldLabelStyle,
          display: 'inline-block',
          maxWidth: 175,
          lineHeight: 1.2,
          wordBreak: 'normal',
          whiteSpace: 'normal',
        }}>{label}</span>
      </div>
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Shared display chrome — small label + read-only value row.
   ─────────────────────────────────────────────────────────────── */

/** Read-only paragraph / value — empty values render an italic muted
 *  placeholder ("No mechanical notes." etc.) so the row still has
 *  visual weight without an input. */
function ReadOnlyText({
  value, placeholder, multiline = false,
}: {
  value?: string;
  placeholder?: string;
  multiline?: boolean;
}) {
  const empty = !value || value.trim() === '';
  return (
    <div style={{
      marginTop: 4,
      padding: '6px 10px',
      borderRadius: 6,
      /* Background + border matched to the report form's
         baseInputStyle (`rgba(255,255,255,0.04)` + `0.14` rim) so
         the read-only box in the profile reads as visually
         identical to the editable textarea in the report. */
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid var(--border-light)',
      color: empty ? 'var(--text-muted)' : 'var(--text-bright)',
      fontSize: rem(12),
      fontStyle: empty ? 'italic' : 'normal',
      lineHeight: 1.45,
      whiteSpace: multiline ? 'pre-wrap' : 'normal',
      /* `minHeight: 48` for multiline matches the report form's
         `<textarea rows={2}>` rendered height (font-size 12 +
         line-height ~1.2 × 2 rows + padding 12 + border 2 ≈
         42-48 px depending on browser). Previously this was 38,
         which made the profile's Mechanical Notes box visibly
         shorter than the equivalent textarea on the report. */
      minHeight: multiline ? 48 : 26,
      fontFamily: 'inherit',
    }}>
      {empty ? (placeholder ?? '—') : value}
    </div>
  );
}

const fieldLabelStyle: React.CSSProperties = {
  /* All secondary labels in the Physical tab (CMF Height, Throwing
     Hand, Throwing Arm, Lower Back Arches Off Wall, every mobility
     card field label, every Force/Athletic/Grip/Speed sub-bubble
     metric label, etc.) render at the EXACT typography of the
     "Max Bat Speed" header in the Hitting Swing Inputs sections
     (Blast Motion / Full Swing / HitTrax / Coach Grades) — i.e.
     the DEFAULT (non-compact) HittingMetricTable header:
     11.88 px / weight 600 / 0.05em letter-spacing / uppercase /
     line-height 1.1, Satoshi via inherit. Was previously
     10 px / weight 700 / 0.08em — slightly smaller AND visibly
     heavier. Bumping to 11.88 makes these labels read at the
     same physical size as Max Bat Speed in the Inputs section,
     which is the most prominent rendering of that label across
     the Hitting tab. */
  fontFamily: 'inherit',
  fontSize: rem(11.88),
  fontWeight: 600,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  lineHeight: 1.1,
  /* All field labels render in pure white per coach-spec — they're
     primary labels, not de-emphasized hints. Anything that should
     read as muted/grey (e.g. an unchecked toggle button) sets its
     own color directly in its own component so this shared label
     style stays consistently white across every field cell. */
  color: 'var(--text-bright)',
};

/* Mobility bubble — Mobility Highlights (NEW — failed/flagged
   items rolled up across the battery), Warm-Up Observations
   (COACH-ONLY in profile display per coach-spec — still
   appears in the Report modal / Coach App), and the 12
   read-only mobility cards. All data sourced from the
   parsed report content. */
function MobilitySection({ content, isCoach, headerEnd }: { content: SCContent; isCoach: boolean; headerEnd?: React.ReactNode }) {
  const warmup = content.warmup ?? {};
  const flags = warmup.flags ?? {};
  const mobility = content.mobility ?? {};

  const flagDefs: { key: keyof NonNullable<typeof flags>; label: string }[] = [
    { key: 'mobility',    label: 'Mobility restriction' },
    { key: 'arm',         label: 'Arm concern' },
    { key: 'asymmetry',   label: 'Asymmetry' },
    { key: 'athleticism', label: 'Strong athleticism' },
  ];
  const anyFlag = flagDefs.some(({ key }) => flags[key]);

  /* Roll up failed pass-fail fields + flagged yes-no fields
     across every mobility test in the battery so the new
     Mobility Highlights bubble can surface a "things we
     failed" list at a glance — players + coaches can both
     see this at the top of the Mobility view without having
     to scan all 12 cards individually. Yes-no fields are
     red-flag indicators (asymmetry / winging / dysrhythmia
     / substitution / back-arches / wrists-leave); a `yes`
     value indicates a problem and gets surfaced alongside
     pass-fail `fail` values. */
  const failures: Array<{
    testNumber: number;
    testTitle: string;
    fieldLabel: string;
    severity: 'fail' | 'flag';
  }> = [];
  for (const test of MOBILITY_TESTS) {
    const testData = mobility[test.number];
    if (!testData) continue;
    for (const field of test.fields) {
      const value = testData[field.key];
      if (!value) continue;
      if (field.type === 'pass-fail' && value === 'fail') {
        failures.push({
          testNumber: test.number,
          testTitle: test.title,
          fieldLabel: field.label,
          severity: 'fail',
        });
      } else if (field.type === 'yes-no' && value === 'yes') {
        failures.push({
          testNumber: test.number,
          testTitle: test.title,
          fieldLabel: field.label,
          severity: 'flag',
        });
      }
    }
  }

  return (
    <>
      {/* ── Big-blue bubble #0 (NEW): Mobility Highlights ──
         Per coach-spec, surfaces every failed / red-flagged
         mobility item in a single roll-up bubble at the TOP of
         the Mobility view. Pass-fail fields with `fail` and
         yes-no fields with `yes` (asymmetry / winging /
         dysrhythmia / substitution / etc. — all red-flag
         indicators) are listed here as red chips. Always
         visible to both player + coach roles so each athlete
         immediately sees what needs follow-up without having
         to scan all 12 battery cards below. */}
      <div className={aStyles.profilePanel} style={{ marginBottom: 18 }}>
        <SnapshotTitle first="Mobility" accent="Highlights" rightSlot={headerEnd} />

        {failures.length === 0 ? (
          <div style={{ fontSize: rem(12), color: 'var(--text-muted)', fontStyle: 'italic', paddingTop: 4 }}>
            No mobility flags or failures recorded.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {failures.map((f, i) => (
              <div
                key={`${f.testNumber}-${f.fieldLabel}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  background: 'rgba(239, 68, 68, 0.10)',
                  border: '1px solid rgba(239, 68, 68, 0.30)',
                  borderRadius: 8,
                }}
              >
                <span
                  style={{
                    fontSize: rem(10),
                    fontWeight: 800,
                    color: '#ef4444',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    flexShrink: 0,
                    minWidth: 28,
                    textAlign: 'center',
                  }}
                >
                  #{f.testNumber}
                </span>
                <span style={{
                  flex: 1, fontSize: rem(12), color: 'var(--text)',
                  lineHeight: 1.35,
                }}>
                  <strong style={{ fontWeight: 700 }}>{f.testTitle}</strong>
                  <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>·</span>
                  {f.fieldLabel}
                </span>
                <span
                  style={{
                    fontSize: rem(10),
                    fontWeight: 800,
                    color: '#ef4444',
                    letterSpacing: '0.10em',
                    textTransform: 'uppercase',
                    flexShrink: 0,
                  }}
                >
                  {f.severity === 'fail' ? 'Fail' : 'Flag'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Big-blue bubble #1: Warm Up Observations ──
         Coach-only in the profile display per coach-spec — the
         bubble is suppressed on the Player App so athletes see
         only the rolled-up Mobility Highlights + the per-test
         battery below. Coaches still see it here (and in the
         Report modal where it remains editable for both
         roles). */}
      {isCoach && (
      <div className={aStyles.profilePanel} style={{ marginBottom: 18 }}>
        <SnapshotTitle first="Warm Up" accent="Observations" />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {flagDefs.map(({ key, label }) => {
            const on = !!flags[key];
            return (
              <span
                key={key}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '4px 12px',
                  borderRadius: 6,
                  border: `1px solid ${on ? 'rgba(126,182,255,0.55)' : 'rgba(255,255,255,0.12)'}`,
                  background: on ? 'rgba(126,182,255,0.20)' : 'rgba(255,255,255,0.02)',
                  color: on ? '#cfe0ff' : 'var(--text-muted)',
                  fontSize: rem(11),
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  fontFamily: 'inherit',
                  opacity: on ? 1 : 0.55,
                }}
              >
                {label}
              </span>
            );
          })}
        </div>
        {!anyFlag && (
          <div style={{ fontSize: rem(11), color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 8 }}>
            No warm-up flags recorded.
          </div>
        )}
        <div style={fieldLabelStyle}>Movement Notes</div>
        <ReadOnlyText
          value={warmup.notes}
          placeholder="No movement notes recorded."
          multiline
        />
      </div>
      )}

      {/* ── Big-blue bubble #2: Pitcher Mobility Battery ──
         12-card per-test grid, one card per row. Title styled like
         Hitting Snapshot exactly (display font, italic, 20.7 px,
         weight 600, plus the title-row hairline + underline).

         Card order: STARRED tests (coach clicked the ★ icon in the
         Report form) float to the top of the stack — preserving
         relative order among themselves — followed by all unstarred
         tests in their original MOBILITY_TESTS catalog order. The
         starred flag lives at `mobility[N].__starred === 'true'`
         (set in the Report form), so this read-only view simply
         honors whatever ordering the coach pinned. */}
      <div className={aStyles.profilePanel} style={{ marginBottom: 18 }}>
        <SnapshotTitle first="Pitcher Mobility" accent="Battery" />

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>
          {[...MOBILITY_TESTS]
            .sort((a, b) => {
              const aStar = mobility[a.number]?.__starred === 'true' ? 1 : 0;
              const bStar = mobility[b.number]?.__starred === 'true' ? 1 : 0;
              if (aStar !== bStar) return bStar - aStar;
              return a.number - b.number;
            })
            .map((t) => (
              <MobilityCard
                key={t.number}
                number={t.number}
                title={t.title}
                howTo={t.howTo}
                redFlags={t.redFlags}
                fields={t.fields}
                value={mobility[t.number]}
                starred={mobility[t.number]?.__starred === 'true'}
              />
            ))}
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   SnapshotTitle — bubble title styled to match the "Hitting Snapshot"
   header in HittingTab exactly:
     • Display font, italic, 20.7 px, weight 600, letter-spacing
       -0.025em, line-height 1.05, uppercase via `aStyles.sectionTitle`
     • Two-span first/accent split (both render white at weight 600
       italic — the split exists for consistency with other Snapshot
       headers across the app, not for visual differentiation)
     • In-row hairline (flex-grow) at the title's mid-line + a
       borderBottom underline beneath the row — matches every other
       dark-blue bubble's header rhythm
   ─────────────────────────────────────────────────────────────── */
function SnapshotTitle({ first, accent, rightSlot }: { first: string; accent: string; rightSlot?: React.ReactNode }) {
  return (
    <div style={{
      position: 'relative',
      display: 'flex',
      alignItems: 'flex-end',
      gap: 12,
      paddingBottom: '0.7rem',
      marginBottom: '0.85rem',
      borderBottom: '1px solid var(--border)',
    }}>
      <div className={aStyles.sectionTitle}>
        <span className={aStyles.sectionTitleFirst}>{first}</span>
        {' '}
        <span className={aStyles.sectionTitleAccent}>{accent}</span>
      </div>
      <div
        aria-hidden="true"
        style={{
          flex: 1,
          height: 1,
          background: 'var(--border)',
          alignSelf: 'flex-end',
          marginBottom: 12,
        }}
      />
      {/* Report date picker (Mobility Highlights only) -- right end of the
          row, on the title's baseline, like the Hitting / Pitching Reports. */}
      {rightSlot && <div style={{ alignSelf: 'flex-end', marginBottom: 0 }}>{rightSlot}</div>}
    </div>
  );
}

/* Phone width (the Hitting / Pitching Reports' breakpoint): the report
   date chip shortens its date there, the same as on those reports. */
function useIsPhone(breakpoint = 768): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [breakpoint]);
  return phone;
}

/* ─────────────────────────────────────────────────────────────────────
   StrengthConditioningTab — main export
   ─────────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────────
   Sub-tab keys for the in-page tab bar (matches the Player Summary
   tab's "Current Grades" / "Trends" pattern exactly).
   ─────────────────────────────────────────────────────────────── */
type SCSubTab = 'lifting' | 'mobility';

export function StrengthConditioningTab({
  player, topMetrics, isCoach, onRefresh, reports,
  onNewReport, onEditReport,
}: TabProps) {
  const [selectedReport, setSelectedReport] = useState<ReportSummary | null>(null);
  /* In-page sub-tab -- opens on the Lifting Report (VALD + typed
     results). Mirrors the Player Summary tab's sub-tab toggle. */
  const [subTab, setSubTab] = useState<SCSubTab>('lifting');

  /* Keep the selected report in sync with the parent's fresh list
     after every save (same pattern every other tab uses). */
  useEffect(() => {
    setSelectedReport((prev) => {
      if (!prev) return prev;
      const fresh = reports.find((r) => r.id === prev.id);
      return fresh ?? null;
    });
  }, [reports]);

  /* Pick the active S&C report (selected, else most recent), parse
     its content blob, and hand the structured slice down to each
     section. Empty when no report exists — every section then shows
     its `—` placeholders. */
  const strengthReports = useMemo(
    () => reports
      .filter((r) => REPORT_TYPES.includes(r.reportType))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [reports],
  );
  const activeReport = selectedReport ?? strengthReports[0] ?? null;
  const content = useMemo(() => parseSCContent(activeReport), [activeReport]);
  const isPhone = useIsPhone();

  /* Report date chip for the report headers (compact = date-sized, like
     Hitting / Pitching): report list, + Report, edit / download / delete. */
  const reportPicker = (
    <ReportSelector
      compact
      reports={reports}
      reportTypes={REPORT_TYPES}
      label="Physical"
      shortDate={isPhone}
      isCoach={isCoach}
      selectedId={selectedReport?.id ?? null}
      onSelect={setSelectedReport}
      onDeleted={onRefresh}
      onNewReport={onNewReport}
      onEdit={onEditReport}
      onDownload={(r) => generateStrengthPdf(player, [r], topMetrics)}
    />
  );

  return (
    <>
      <TabBarActions>
        <DownloadPdfButton
          onDownload={async () => {
            if (!activeReport) return;
            await generateStrengthPdf(player, [activeReport], topMetrics);
          }}
          disabled={!activeReport}
        />
        {/* The Physical report picker moved OUT of this actions slot into
            the Mobility Highlights header as the date chip, the same spot
            and size as the Hitting / Pitching Reports' report-date dropdown.
            (Not on the Lifting Report -- its results come from VALD / typed
            results, not Physical reports.) See reportPicker below. */}
      </TabBarActions>

      {/* ══════════ PHYSICAL SUB-TABS ══════════
          Lifting Report / Mobility Screen -- docked INTO the Player Name
          bubble under the Hitting / Catching / Pitching / Physical tabs
          (TabBarSub portals into the tab bar's second row), so it reads
          as part of that bubble instead of a separate bar. Italic display
          labels + white-gradient underline on the active one, as before. */}
      <TabBarSub>
      <div style={{ display: 'flex', gap: 4, width: '100%' }}>
        {[
          { key: 'lifting'  as const, label: 'Lifting Report' },
          { key: 'mobility' as const, label: 'Mobility Screen' },
        ].map((t) => {
          const active = subTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setSubTab(t.key)}
              style={{
                flex: 1,
                position: 'relative',
                padding: '10px 16px',
                background: 'transparent',
                border: 'none',
                borderRadius: 10,
                color: active ? 'var(--text)' : 'var(--text-muted)',
                fontFamily: 'var(--font-display)',
                fontSize: rem(13.8),
                fontWeight: 600,
                fontStyle: 'italic',
                letterSpacing: '-0.025em',
                lineHeight: 1.05,
                textTransform: 'none',
                cursor: 'pointer',
                transition: 'color 0.15s ease',
              }}
            >
              {t.label}
              {/* Active underline — same gradient + glow recipe as
                  the Player Summary sub-tabs. */}
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: 12,
                  right: 12,
                  bottom: 2,
                  height: 2,
                  borderRadius: '2px 2px 0 0',
                  background: active
                    ? 'linear-gradient(90deg, transparent, #ffffff 50%, transparent)'
                    : 'transparent',
                  boxShadow: active ? '0 0 12px rgba(255,255,255,0.5)' : 'none',
                  transition: 'background 0.15s ease, box-shadow 0.15s ease',
                }}
              />
            </button>
          );
        })}
      </div>
      </TabBarSub>

      {/* ── Sub-tab content ──
          "Lifting Report"   → the VALD / typed Lifting Report
          "Mobility Screen"  → Mobility big-blue bubble (warm-up
                               observation + 12-card battery).
          (The old "Strength and Conditioning" sub-tab -- Strength,
          Speed and Vision bubbles -- was removed 2026-11-16.) */}
      {subTab === 'lifting' && <LiftingDashboard playerId={player.id} />}
      {subTab === 'mobility' && (
        <MobilitySection content={content} isCoach={isCoach} headerEnd={reportPicker} />
      )}
    </>
  );
}
