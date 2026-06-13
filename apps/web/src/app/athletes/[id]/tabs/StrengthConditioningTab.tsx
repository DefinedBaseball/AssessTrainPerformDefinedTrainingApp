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

import { rem } from '@/lib/rem';
import { useEffect, useMemo, useState } from 'react';
import {
  SectionHeader,
  TabBarActions,
  EditProfileButton,
  DownloadPdfButton,
  VideosIconButton,
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
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    }}>
      <span style={fieldLabelStyle}>{label}</span>
      {children}
    </div>
  );
}

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

/** Read-only KPI-style value display — used by the Strength and
 *  Speed grey bubbles in place of the previous text inputs.
 *
 *  Per coach-spec: the label (e.g. "CMJ Height") + its unit are
 *  CENTERED above the value, and the value itself renders as plain
 *  centered text — no inner background box / border around it. The
 *  metric reads as a clean column rather than a label + framed
 *  number pair.
 *
 *  `label` is OPTIONAL — Speed-tab cells omit it because their
 *  containing bubble's title (e.g. "60 Yard Dash") already names
 *  the metric, so the cell only needs to surface the unit + value
 *  pair underneath. */
function DisplayValue({ label, unit, value }: { label?: string; unit?: string; value?: string }) {
  const empty = !value || value.trim() === '';
  /* Two layout modes, branched on whether a `label` is supplied:
       • LABEL MODE (Strength cells: "CMJ Height (in/cm)", "Throwing
         Hand (lbs/kg)", etc.) — label on line 1, unit on its OWN
         line 2 BELOW the label, value on line 3. Stacking the unit
         under the label keeps the label string clean (no inline
         parens) and reserves a consistent vertical rhythm across
         all 5 / 3 metric columns regardless of unit length.
       • UNIT-ONLY MODE (Speed cells: just "sec", "mph", "m/s²" — no
         label, since the surrounding GreyMetricBubble's title
         "60 Yard Dash" / "Top Speed" / "Acceleration" already
         names the metric) — render the value + unit on the SAME
         line ("4.50 sec") so the unit sits NEXT TO the number
         instead of floating above it. */
  const labelMode = !!label;
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 4,
      padding: '2px 4px',
      textAlign: 'center',
    }}>
      {labelMode && (
        <>
          {/* Line 1: label only, in fieldLabelStyle (white, 11.88,
             weight 600, uppercase, 0.05em letter-spacing). */}
          <div style={{ ...fieldLabelStyle, textAlign: 'center' }}>
            {label}
          </div>
          {/* Line 2: unit on its own row beneath the label. Slightly
             lighter weight (400 vs. 600) and lowercase to read as a
             secondary annotation, not a second label. Reserve a row
             even when no unit is supplied so all label cells in the
             same metric grid stay vertically aligned. */}
          <div style={{
            fontFamily: 'inherit',
            fontSize: rem(10),
            fontWeight: 400,
            letterSpacing: '0.02em',
            color: 'rgba(255,255,255,0.78)',
            lineHeight: 1.1,
            minHeight: 11,
          }}>
            {unit ?? ''}
          </div>
        </>
      )}
      {/* Value row — naked text, no chip background. In LABEL MODE
         the value is just the value. In UNIT-ONLY MODE the unit is
         rendered INLINE after the value ("4.50 sec"). */}
      <div style={{
        color: empty ? 'var(--text-muted)' : 'var(--text-bright)',
        fontSize: rem(16),
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '-0.01em',
        fontFamily: 'inherit',
        opacity: empty ? 0.6 : 1,
        lineHeight: 1.2,
        display: 'inline-flex',
        alignItems: 'baseline',
        justifyContent: 'center',
        gap: 4,
      }}>
        <span>{empty ? '—' : value}</span>
        {!labelMode && unit && (
          <span style={{
            fontSize: rem(11),
            fontWeight: 500,
            color: 'rgba(255,255,255,0.78)',
            letterSpacing: '0.02em',
            textTransform: 'lowercase',
          }}>
            {unit}
          </span>
        )}
      </div>
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

/* ─────────────────────────────────────────────────────────────────────
   StrengthSection — Big dark-blue bubble #1 ("STRENGTH").
   Two grey sub-bubbles inside, both read-only.
   ─────────────────────────────────────────────────────────────── */
function StrengthSection({ content }: { content: SCContent }) {
  const force = content.forceAthletic ?? {};
  const grip = content.gripStrength ?? {};

  return (
    <div className={aStyles.profilePanel} style={{ marginBottom: 18 }}>
      {/* Subtitle ("Force testing · Grip strength") retired per
         coach-spec — the two sub-bubble titles (Force & Athletic
         Testing + Grip Strength) below already name what the
         section covers; the eyebrow subtitle was redundant. */}
      <SectionHeader title="Strength" />

      {/* Force & Athletic Testing on top, Grip Strength stacked
         BELOW it (both full-width). The earlier 2-column layout
         was retired per coach-spec so each grey bubble can spread
         its metrics across a single row instead of wrapping. */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        marginTop: 12,
      }}>
        {/* ── Force & Athletic Testing — VALD ──
            All 5 metrics (CMJ Height / Peak Force Left / Peak Force
            Right / Asymmetry Index / Rotational Power) land on ONE
            line via fixed `repeat(5, 1fr)`. Power / Imbalance Notes
            sit directly below the row.

            Per coach-spec the bubble surface sits 50 % closer to
            the outer Strength bubble color than the default Grey
            Metric Bubble — i.e. halfway between `#e6e6e6` (the
            page-bg grey the default surface inherits via
            `--bubble-chrome-bg` on `.pageRoot`) and `#f3f3f3` (the
            Strength bubble's brightest shine point) → `#ededed`. */}
        <GreyMetricBubble
          title="Force & Athletic Testing"
          subtitle="VALD · Informs downstream training"
          bg="#ededed"
        >
          <div style={fiveColGrid}>
            <DisplayValue label="CMJ Height" unit="in/cm" value={force.cmjHeight} />
            <DisplayValue label="Peak Force Left" unit="N" value={force.peakForceLeft} />
            <DisplayValue label="Peak Force Right" unit="N" value={force.peakForceRight} />
            <DisplayValue label="Asymmetry Index" unit="%" value={force.asymmetryIndex} />
            <DisplayValue label="Rotational Power" unit="opt" value={force.rotationalPower} />
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={fieldLabelStyle}>Power / Imbalance Notes</div>
            <ReadOnlyText
              value={force.notes}
              placeholder="No power / imbalance notes recorded."
              multiline
            />
          </div>
        </GreyMetricBubble>

        {/* ── Grip Strength — UNDER Force & Athletic Testing. All
            3 metrics on one line via `repeat(3, 1fr)`. */}
        <GreyMetricBubble
          title="Grip Strength"
          subtitle="Bilateral · handheld dynamometer"
          bg="#ededed"
        >
          <div style={threeColGrid}>
            <DisplayValue label="Throwing Hand" unit="lbs/kg" value={grip.throwing} />
            <DisplayValue label="Glove Hand" unit="lbs/kg" value={grip.glove} />
            <DisplayValue label="Asymmetry Index" unit="%" value={grip.asymmetryIndex} />
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={fieldLabelStyle}>Flag / Notes</div>
            <ReadOnlyText value={grip.notes} placeholder="No grip notes recorded." />
          </div>
        </GreyMetricBubble>
      </div>
    </div>
  );
}

/* Speed bubble — 4 individual grey bubbles, all read-only.
   Subtitles ("Pro sprint", "Combine sprint", etc.) were retired
   per coach-spec, and the redundant per-metric labels ("Time" /
   "Speed" / "Rate") were dropped too. Each cell now shows JUST
   the unit + value, since the surrounding bubble's title already
   names the metric. */
function SpeedSection({ content }: { content: SCContent }) {
  const speed = content.speed ?? {};
  return (
    <div className={aStyles.profilePanel} style={{ marginBottom: 18 }}>
      {/* Subtitle ("Sprint splits + max velocity") retired per
         coach-spec — the four sub-bubble titles below (60 / 40
         Yard Dash + Top Speed + Acceleration) already name what
         the section covers. */}
      <SectionHeader title="Speed" />
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 14,
        marginTop: 12,
      }}>
        <GreyMetricBubble title="60 Yard Dash" bg="#ededed">
          <DisplayValue unit="sec" value={speed.sixty} />
        </GreyMetricBubble>
        <GreyMetricBubble title="10 Yard Dash" bg="#ededed">
          <DisplayValue unit="sec" value={speed.ten} />
        </GreyMetricBubble>
      </div>
    </div>
  );
}

/* Vision bubble — Visual Acuity readout ("20/20 - 1") + four coach-
   entered 20-80 grades (Object Tracking / Timing / Anticipation /
   Peripheral Awareness). Sits directly under Speed in the
   Strength-and-Conditioning sub-tab. Read-only profile counterpart to
   the report form's VisionSection. */
function VisionSection({ content }: { content: SCContent }) {
  const vision = content.vision ?? {};
  const acuity = vision.acuity
    ? `${vision.acuity}${vision.acuityWrong ? ` - ${vision.acuityWrong}` : ''}`
    : undefined;
  return (
    <div className={aStyles.profilePanel} style={{ marginBottom: 18 }}>
      <SectionHeader title="Vision" />
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 14,
        marginTop: 12,
      }}>
        <GreyMetricBubble title="Visual Acuity" bg="#ededed">
          <DisplayValue value={acuity} />
        </GreyMetricBubble>
        <GreyMetricBubble title="Object Tracking" bg="#ededed">
          <DisplayValue unit="/80" value={vision.objectTracking} />
        </GreyMetricBubble>
        <GreyMetricBubble title="Timing" bg="#ededed">
          <DisplayValue unit="/80" value={vision.timing} />
        </GreyMetricBubble>
        <GreyMetricBubble title="Anticipation" bg="#ededed">
          <DisplayValue unit="/80" value={vision.anticipation} />
        </GreyMetricBubble>
        <GreyMetricBubble title="Peripheral Awareness" bg="#ededed">
          <DisplayValue unit="/80" value={vision.peripheral} />
        </GreyMetricBubble>
      </div>
    </div>
  );
}

/* Mobility bubble — Mobility Highlights (NEW — failed/flagged
   items rolled up across the battery), Warm-Up Observations
   (COACH-ONLY in profile display per coach-spec — still
   appears in the Report modal / Coach App), and the 12
   read-only mobility cards. All data sourced from the
   parsed report content. */
function MobilitySection({ content, isCoach }: { content: SCContent; isCoach: boolean }) {
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
        <SnapshotTitle first="Mobility" accent="Highlights" />

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
function SnapshotTitle({ first, accent }: { first: string; accent: string }) {
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
    </div>
  );
}

/* Sub-block header inside a big-blue bubble — separates the
   warm-up and mobility-battery halves of the Mobility Screen
   without using a full profilePanel for each. */
function SubBlock({
  title, subtitle, children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        marginBottom: 8,
      }}>
        <span style={{
          fontFamily: 'inherit',
          fontSize: rem(13), fontWeight: 700,
          color: 'var(--text-bright)', lineHeight: 1.05,
          letterSpacing: '-0.01em',
          textTransform: 'uppercase',
        }}>
          {title}
        </span>
        {subtitle && (
          <span style={{
            fontSize: rem(10),
            /* Subtitle reads white per coach-spec — every label /
               subtitle across the profile is now consistently white. */
            color: 'var(--text-bright)',
            letterSpacing: '0.04em',
          }}>
            {subtitle}
          </span>
        )}
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   GreyMetricBubble — warm-grey Curveball-style sub-bubble used inside
   the Strength + Speed big-blue panels.

   Accepts an optional `bg` override so individual callers (e.g. the
   Force & Athletic Testing bubble) can shift their surface closer to
   the outer-panel color without changing the shared
   `movementPlotBubbleStyle` recipe that every other Curveball-style
   bubble across the app relies on.
   ─────────────────────────────────────────────────────────────── */
function GreyMetricBubble({
  title, subtitle, children, bg,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  bg?: string;
}) {
  return (
    <div style={{
      ...movementPlotBubbleStyle,
      ...(bg ? { background: bg } : null),
      padding: '12px 14px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
      }}>
        <span style={{
          /* Grey bubble title (Force & Athletic Testing, Grip
             Strength, 60 Yard Dash, etc.) — matched to the
             Curveball (ArsenalCard) title style in the Pitching
             tab: Satoshi inherit, 1 rem (16 px), weight 600 normal,
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
        {subtitle && (
          <span style={{
            fontSize: rem(10),
            /* Subtitle reads white per coach-spec. */
            color: 'var(--text-bright)',
            letterSpacing: '0.04em',
          }}>
            {subtitle}
          </span>
        )}
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
      </div>
      <div
        aria-hidden="true"
        style={{ height: 1, background: 'var(--border)' }}
      />
      {children}
    </div>
  );
}

/* Force & Athletic Testing — fixed 5-column row so every metric
   (CMJ Height / Peak Force Left / Peak Force Right / Asymmetry Index
   / Rotational Power) sits on a single line. `minmax(0, 1fr)` lets
   each column shrink past its content's intrinsic width so long
   labels (e.g. "Peak Force Right") don't push the row off-grid. */
const fiveColGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
  gap: 10,
};

/* Grip Strength — fixed 3-column row matching the same single-line
   layout as the 5-col Force row above. */
const threeColGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 10,
};

/* ─────────────────────────────────────────────────────────────────────
   StrengthConditioningTab — main export
   ─────────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────────
   Sub-tab keys for the in-page tab bar (matches the Player Summary
   tab's "Current Grades" / "Trends" pattern exactly).
   ─────────────────────────────────────────────────────────────── */
type SCSubTab = 'sc' | 'mobility';

export function StrengthConditioningTab({
  player, topMetrics, isCoach, onRefresh, reports,
  onNewReport, onEditReport, onEditProfile, onOpenVideos,
}: TabProps) {
  const [selectedReport, setSelectedReport] = useState<ReportSummary | null>(null);
  /* In-page sub-tab — defaults to Strength & Conditioning. Mirrors
     the Player Summary tab's `Current Grades / Trends` toggle. */
  const [subTab, setSubTab] = useState<SCSubTab>('sc');

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

  return (
    <>
      <TabBarActions>
        <EditProfileButton onClick={onEditProfile} show={!isCoach} />
        <DownloadPdfButton
          onDownload={async () => {
            if (!activeReport) return;
            await generateStrengthPdf(player, [activeReport], topMetrics);
          }}
          disabled={!activeReport}
        />
        <VideosIconButton onClick={onOpenVideos} />
        <ReportSelector
          reports={reports}
          reportTypes={REPORT_TYPES}
          label="Physical"
          isCoach={isCoach}
          selectedId={selectedReport?.id ?? null}
          onSelect={setSelectedReport}
          onDeleted={onRefresh}
          onNewReport={onNewReport}
          onEdit={onEditReport}
          onDownload={(r) => generateStrengthPdf(player, [r], topMetrics)}
        />
      </TabBarActions>

      {/* ══════════ S&C SUB-TABS ══════════
          Top-of-page tab bar between "Strength and Conditioning"
          (Strength + Speed bubbles) and "Mobility/Stability" (the
          12-test mobility battery). Chrome lifted verbatim from the
          Player Summary tab's Current Grades / Trends bar so the
          two pages read with identical sub-nav voicing — dark navy
          + radial highlight + soft white-rim border, italic display
          font on the labels, white-gradient-with-glow underline on
          the active tab. */}
      {/* Sub-tab bar background / border / shadow flow through the
          `--subtab-bar-*` CSS variables defined in globals.css so the
          chrome auto-flips between dark (current radial+rgba look)
          and light (`--panel-bg-light` to match the Strength bubble
          below) without needing a separate CSS module. */}
      <div style={{
        position: 'relative',
        background: 'var(--subtab-bar-bg)',
        border: '1px solid var(--subtab-bar-border)',
        borderRadius: 14,
        boxShadow: 'var(--subtab-bar-shadow)',
        padding: '4px',
        marginBottom: 18,
        display: 'flex',
        gap: 4,
      }}>
        {[
          { key: 'sc'       as const, label: 'Strength and Conditioning' },
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

      {/* ── Sub-tab content ──
          "Strength and Conditioning" → Strength + Speed big-blue bubbles
          "Mobility/Stability"        → Mobility big-blue bubble (warm-up
                                        observation + 12-card battery) */}
      {subTab === 'sc' && (
        <>
          <StrengthSection content={content} />
          <SpeedSection content={content} />
          <VisionSection content={content} />
        </>
      )}
      {subTab === 'mobility' && (
        <MobilitySection content={content} isCoach={isCoach} />
      )}
    </>
  );
}
