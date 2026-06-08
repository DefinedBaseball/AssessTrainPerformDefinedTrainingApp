'use client';

/**
 * StrengthConditioningForm — editable counterpart to the read-only
 * `StrengthConditioningTab` profile page. Mirrors that page's layout
 * 1:1 (same big-blue parent panels, same warm-grey "Curveball-style"
 * sub-bubbles, same sub-tab bar between "Strength and Conditioning"
 * and "Mobility/Stability", same 12-card mobility battery) — only
 * difference is every display value is now a text input, every
 * Pass/Fail badge is a clickable toggle, every Yes/No badge is a
 * clickable toggle, and every notes paragraph is a textarea.
 *
 * Data flows through one shared `SCContent` shape (exported from
 * `StrengthConditioningTab`). The Report modal owns the state and
 * serializes the resulting blob under `content.strengthConditioning`
 * on save; the profile tab parses the same key out on render so the
 * two surfaces share schema directly.
 */

import { useState } from 'react';
import aStyles from '@/components/assessment/assessment.module.css';
import { movementPlotBubbleStyle } from './tabs/SwingTab';
import {
  MOBILITY_TESTS,
  HoverPopover,
  type SCContent,
  type MobilityField,
} from './tabs/StrengthConditioningTab';

type SCSubTab = 'sc' | 'mobility';

/* ─────────────────────────────────────────────────────────────────────
   Empty-state factory — every field undefined so the form opens blank
   when the coach creates a NEW S&C report.
   ─────────────────────────────────────────────────────────────── */
export function emptyScForm(): SCContent {
  return {
    warmup: { flags: {}, notes: '' },
    forceAthletic: {},
    gripStrength: {},
    speed: {},
    mobility: {},
  };
}

interface Props {
  data: SCContent;
  setData: (next: SCContent) => void;
}

export function StrengthConditioningForm({ data, setData }: Props) {
  const [subTab, setSubTab] = useState<SCSubTab>('sc');

  return (
    <>
      {/* ── Sub-tab bar — identical chrome to the profile tab and
            Player Summary's Current Grades / Trends bar. */}
      <SubTabBar subTab={subTab} setSubTab={setSubTab} />

      {subTab === 'sc' && (
        <>
          <StrengthSection data={data} setData={setData} />
          <SpeedSection data={data} setData={setData} />
        </>
      )}
      {subTab === 'mobility' && (
        <MobilitySection data={data} setData={setData} />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Sub-tab bar — same dark navy chrome + italic display label + glowing
   underline as the profile page.
   ─────────────────────────────────────────────────────────────── */
function SubTabBar({
  subTab, setSubTab,
}: { subTab: SCSubTab; setSubTab: (k: SCSubTab) => void }) {
  return (
    <div style={{
      position: 'relative',
      /* Chrome flows through `--subtab-bar-*` CSS variables (globals.css)
         so the bar auto-flips to `--panel-bg-light` (#e6e6e6) in light
         mode, matching the Strength bubble below. */
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
              fontSize: 13.8,
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
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 12, right: 12, bottom: 2,
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
  );
}

/* ─────────────────────────────────────────────────────────────────────
   STRENGTH SECTION — Force & Athletic Testing (one row of 5 inputs +
   power notes) and Grip Strength (one row of 3 inputs + flag notes).
   ─────────────────────────────────────────────────────────────── */
function StrengthSection({ data, setData }: Props) {
  const force = data.forceAthletic ?? {};
  const grip = data.gripStrength ?? {};

  const updateForce = (patch: Partial<NonNullable<SCContent['forceAthletic']>>) =>
    setData({ ...data, forceAthletic: { ...force, ...patch } });
  const updateGrip = (patch: Partial<NonNullable<SCContent['gripStrength']>>) =>
    setData({ ...data, gripStrength: { ...grip, ...patch } });

  return (
    <div className={aStyles.profilePanel} style={{ marginBottom: 18, flexShrink: 0 }}>
      {/* Subtitle ("Force testing · Grip strength") retired per
         coach-spec — the two sub-bubble titles below already name
         what the section covers. */}
      <SectionTitle title="Strength" />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
        <GreyMetricBubble title="Force & Athletic Testing" subtitle="VALD · Informs downstream training">
          <div style={fiveColGrid}>
            <InputCell label="CMJ Height" unit="in/cm"
              value={force.cmjHeight ?? ''} onChange={(v) => updateForce({ cmjHeight: v })} />
            <InputCell label="Peak Force Left" unit="N"
              value={force.peakForceLeft ?? ''} onChange={(v) => updateForce({ peakForceLeft: v })} />
            <InputCell label="Peak Force Right" unit="N"
              value={force.peakForceRight ?? ''} onChange={(v) => updateForce({ peakForceRight: v })} />
            <InputCell label="Asymmetry Index" unit="%"
              value={force.asymmetryIndex ?? ''} onChange={(v) => updateForce({ asymmetryIndex: v })} />
            <InputCell label="Rotational Power" unit="opt"
              value={force.rotationalPower ?? ''} onChange={(v) => updateForce({ rotationalPower: v })} />
          </div>
          <NotesField
            label="Power / Imbalance Notes"
            value={force.notes ?? ''}
            onChange={(v) => updateForce({ notes: v })}
            placeholder="Notable asymmetry? Power limitation? Physical flags to carry into training plan?"
          />
        </GreyMetricBubble>

        <GreyMetricBubble title="Grip Strength" subtitle="Bilateral · handheld dynamometer">
          <div style={threeColGrid}>
            <InputCell label="Throwing Hand" unit="lbs/kg"
              value={grip.throwing ?? ''} onChange={(v) => updateGrip({ throwing: v })} />
            <InputCell label="Glove Hand" unit="lbs/kg"
              value={grip.glove ?? ''} onChange={(v) => updateGrip({ glove: v })} />
            <InputCell label="Asymmetry Index" unit="%"
              value={grip.asymmetryIndex ?? ''} onChange={(v) => updateGrip({ asymmetryIndex: v })} />
          </div>
          <NotesField
            label="Flag / Notes"
            value={grip.notes ?? ''}
            onChange={(v) => updateGrip({ notes: v })}
            placeholder="Flag asymmetry >10%. Spin-rate baseline / arm-health context…"
            singleLine
          />
        </GreyMetricBubble>
      </div>
    </div>
  );
}

/* SPEED SECTION — 4 individual grey bubbles, each editable. */
function SpeedSection({ data, setData }: Props) {
  const speed = data.speed ?? {};
  const update = (patch: Partial<NonNullable<SCContent['speed']>>) =>
    setData({ ...data, speed: { ...speed, ...patch } });

  return (
    <div className={aStyles.profilePanel} style={{ marginBottom: 18, flexShrink: 0 }}>
      {/* Subtitle ("Sprint splits + max velocity") retired per
         coach-spec — the four sub-bubble titles below already name
         what the section covers. */}
      <SectionTitle title="Speed" />
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 14,
        marginTop: 12,
      }}>
        <GreyMetricBubble title="60 Yard Dash">
          <InputCell unit="sec" value={speed.sixty ?? ''} onChange={(v) => update({ sixty: v })} />
        </GreyMetricBubble>
        <GreyMetricBubble title="40 Yard Dash">
          <InputCell unit="sec" value={speed.forty ?? ''} onChange={(v) => update({ forty: v })} />
        </GreyMetricBubble>
        <GreyMetricBubble title="Top Speed">
          <InputCell unit="mph" value={speed.top ?? ''} onChange={(v) => update({ top: v })} />
        </GreyMetricBubble>
        <GreyMetricBubble title="Acceleration">
          <InputCell unit="m/s²" value={speed.accel ?? ''} onChange={(v) => update({ accel: v })} />
        </GreyMetricBubble>
      </div>
    </div>
  );
}

/* MOBILITY SECTION — Warm-up Observation sub-block + 12 editable
   mobility cards stacked one-per-row. */
function MobilitySection({ data, setData }: Props) {
  const warmup = data.warmup ?? {};
  const flags = warmup.flags ?? {};
  const mobility = data.mobility ?? {};

  const updateWarmup = (patch: Partial<NonNullable<SCContent['warmup']>>) =>
    setData({ ...data, warmup: { ...warmup, ...patch } });
  const updateFlag = (key: keyof NonNullable<NonNullable<SCContent['warmup']>['flags']>, on: boolean) =>
    setData({ ...data, warmup: { ...warmup, flags: { ...flags, [key]: on } } });
  const updateMobility = (n: number, patch: Record<string, string | undefined>) =>
    setData({ ...data, mobility: { ...mobility, [n]: { ...(mobility[n] ?? {}), ...patch } } });

  const flagDefs: { key: 'mobility' | 'arm' | 'asymmetry' | 'athleticism'; label: string }[] = [
    { key: 'mobility',    label: 'Mobility restriction' },
    { key: 'arm',         label: 'Arm concern' },
    { key: 'asymmetry',   label: 'Asymmetry' },
    { key: 'athleticism', label: 'Strong athleticism' },
  ];

  return (
    <>
      {/* ── Big-blue bubble #1: Warm Up Observations ──
         Was previously a sub-block inside a single "Mobility Screen"
         parent bubble; now its own top-level profilePanel per
         coach-spec. Title styled like Hitting Snapshot via
         `aStyles.sectionTitle` + the two-span first/accent split. */}
      <div className={aStyles.profilePanel} style={{ marginBottom: 18, flexShrink: 0 }}>
        <SnapshotTitle first="Warm Up" accent="Observations" />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {flagDefs.map(({ key, label }) => (
            <FlagChip
              key={key}
              active={!!flags[key]}
              onClick={() => updateFlag(key, !flags[key])}
            >
              {label}
            </FlagChip>
          ))}
        </div>
        <NotesField
          label="Movement Notes"
          value={warmup.notes ?? ''}
          onChange={(v) => updateWarmup({ notes: v })}
          placeholder="Energy level, body type, movement quality, arm action first impression, flags to carry forward…"
        />
      </div>

      {/* ── Big-blue bubble #2: Pitcher Mobility Battery ──
         12-card per-test grid, one card per row. Title styled like
         Hitting Snapshot exactly (display font, italic, 20.7 px,
         weight 600, plus the title-row hairline + underline).

         Card order: STARRED tests (coach clicked the ★ icon) float
         to the top of the stack — preserving relative order among
         themselves — followed by all unstarred tests in their
         original MOBILITY_TESTS catalog order. This lets the coach
         pin the most-relevant tests to the top of the report (e.g.
         to highlight a pitcher's restriction patterns) without
         losing the canonical PDF ordering for the remaining cards.
         Sort uses a `STABLE` two-pass technique: starred-first
         (boolean compare) → original-number ascending. */}
      <div className={aStyles.profilePanel} style={{ marginBottom: 18, flexShrink: 0 }}>
        <SnapshotTitle first="Pitcher Mobility" accent="Battery" />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[...MOBILITY_TESTS]
            .sort((a, b) => {
              const aStar = mobility[a.number]?.__starred === 'true' ? 1 : 0;
              const bStar = mobility[b.number]?.__starred === 'true' ? 1 : 0;
              if (aStar !== bStar) return bStar - aStar;
              return a.number - b.number;
            })
            .map((t) => (
              <MobilityCardForm
                key={t.number}
                number={t.number}
                title={t.title}
                howTo={t.howTo}
                redFlags={t.redFlags}
                fields={t.fields}
                value={mobility[t.number] ?? {}}
                starred={mobility[t.number]?.__starred === 'true'}
                onToggleStar={() => updateMobility(t.number, {
                  __starred: mobility[t.number]?.__starred === 'true' ? undefined : 'true',
                })}
                onChange={(patch) => updateMobility(t.number, patch)}
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

/* ─────────────────────────────────────────────────────────────────────
   MobilityCardForm — editable counterpart to MobilityCard. Same
   short-and-wide horizontal layout used on the profile page, but with
   clickable Pass/Fail + Yes/No toggles and editable notes textareas.

   The ❓ "How to Perform" and 🚩 "Red Flags" tooltips are rendered
   here too (mirroring the profile card 1:1) so the coach can hover
   either icon while entering data to recall test mechanics + things
   to watch for. Both icons live in a single absolute-positioned
   flex container at the top-right corner — ❓ first, 🚩 to its
   right — matched to the profile card exactly.
   ─────────────────────────────────────────────────────────────── */
function MobilityCardForm({
  number, title, howTo, redFlags, fields, value,
  starred, onToggleStar, onChange,
}: {
  number: number;
  title: string;
  howTo: string;
  redFlags: string;
  fields: MobilityField[];
  value: Record<string, string | undefined>;
  /** Coach has pinned this card to the top of the mobility stack.
   *  When true, the ★ icon renders gold-filled; when false, it
   *  renders as a dim outline. Toggling fires `onToggleStar`. */
  starred: boolean;
  /** Toggles the starred state for this card. The parent persists
   *  the boolean as `__starred: 'true' | undefined` inside the
   *  per-test mobility record so it round-trips through the same
   *  SCContent shape used by the read-only profile. */
  onToggleStar: () => void;
  onChange: (patch: Record<string, string | undefined>) => void;
}) {
  return (
    <div style={{
      ...movementPlotBubbleStyle,
      /* Padding-right widened 14 → 44 px to mirror the profile card,
         reserving a clear gutter for the absolutely-positioned ❓ +
         🚩 icon pair sitting at `right: 12, top: 10` on the card's
         top-right corner. Without this clearance the title-row
         hairline would extend under the icons. Left padding (24 px)
         + top/bottom (10 px) unchanged. */
      padding: '10px 44px 10px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      {/* Title row + inline accent hairline */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{
          fontSize: 11, fontWeight: 800,
          color: 'rgba(126,182,255,0.85)',
          letterSpacing: '0.04em',
          minWidth: 22,
        }}>#{number}</span>
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
        }}>{title}</span>
        <div
          aria-hidden="true"
          style={{
            flex: 1, height: 1, background: 'var(--border)',
            alignSelf: 'flex-end', marginBottom: 6,
          }}
        />
      </div>

      {/* Full-width divider */}
      <div aria-hidden="true" style={{ height: 1, background: 'var(--border)' }} />

      {/* Horizontal field strip — renders the 3 per-test fields
         dynamically from `fields`, followed by the always-present
         Mechanical Notes column.

         Column template uses EQUAL `1fr` tracks for all 3 metric
         columns (and a slightly wider notes column at the end) so
         every one of the 12 mobility cards lays out with identical
         spacing — matches the natural rhythm of bubble #2 (Wall
         Angel) where the 3 Y/N · P/F toggles sit evenly spaced.
         The previous `repeat(3, auto)` sized each column to its
         content, which meant numeric-input cards (90 px columns)
         were noticeably tighter than toggle-button cards (~130 px
         columns). `minmax(0, 1fr)` lets columns shrink past their
         children's intrinsic width so long field labels can't
         push the row off-grid. */}
      <div style={{
        display: 'grid',
        /* Metric columns widened 100 → 175 px per coach-spec so the
           label inside each column actually has room to wrap to its
           own `maxWidth: 175` budget. Previously the 100 px grid
           track constrained the label container, forcing labels
           like "Full Overhead Reach Maintained" and "Lower Back
           Arches Off Wall" to wrap to 3+ narrow lines (fitting
           100 px instead of 175 px). Now each column = label
           wrap-target, so every label fits in 2 lines naturally.
           Value widgets (90-160 px) sit centered inside the wider
           column with some breathing padding on each side. */
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
            <EditField
              field={f}
              value={value?.[f.key]}
              onChange={(v) => onChange({ [f.key]: v })}
            />
          </FieldCell>
        ))}
        <FieldCell
          label="Mechanical Notes"
          fill
        >
          <TextInline
            value={value?.mechNotes ?? ''}
            onChange={(v) => onChange({ mechNotes: v })}
            placeholder="Compensations, follow-ups…"
            multiline
          />
        </FieldCell>
      </div>

      {/* ── ★ + ❓ + 🚩 icon trio — absolute top-right corner.
            Grouped in a single flex container so ★ sits on the
            LEFT, ❓ in the middle, and 🚩 on the RIGHT, all
            vertically aligned on the same baseline. `gap: 6`
            gives a small breath of space between anchors; the
            container itself sits at `right: 12, top: 10` so the
            🚩's right edge is 12 px from the card's outer edge.

            ★ is a clickable toggle (not a popover) — pressing it
            stars / unstars this card. Starred cards float to the
            top of the mobility stack via the parent's sort. */}
      <div style={{
        position: 'absolute',
        right: 12,
        top: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <button
          type="button"
          onClick={onToggleStar}
          title={starred ? 'Unstar this card' : 'Star this card (moves to top)'}
          aria-label={starred ? 'Unstar this card' : 'Star this card'}
          aria-pressed={starred}
          style={{
            /* When starred, render gold-filled (matches the
               coach-spec "highlight this test" emphasis); when
               unstarred, render as a dim white outline that
               disappears into the bubble until hovered. */
            width: 22, height: 22,
            borderRadius: '50%',
            border: `1px solid ${starred
              ? 'rgba(255,206,84,0.65)'
              : 'rgba(255,255,255,0.28)'}`,
            background: starred
              ? 'rgba(255,206,84,0.16)'
              : 'rgba(255,255,255,0.04)',
            color: starred ? '#ffce54' : 'rgba(255,255,255,0.55)',
            fontSize: 13,
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            padding: 0,
            transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease',
          }}
        >
          ★
        </button>
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
              fontSize: 12,
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
              fontSize: 12,
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

/** EditField — switches on the field type and renders the
 *  appropriate editor (Pass/Fail toggle, Yes/No toggle, numeric
 *  input, or text input). Mirrors `DisplayField` over in the
 *  profile tab so the two surfaces stay in lockstep. */
function EditField({
  field, value, onChange,
}: {
  field: MobilityField;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  if (field.type === 'pass-fail') {
    return (
      <PassFailEditor
        value={value as 'pass' | 'fail' | undefined}
        onChange={(v) => onChange(v)}
      />
    );
  }
  if (field.type === 'yes-no') {
    return (
      <YesNoEditor
        value={value as 'yes' | 'no' | undefined}
        onChange={(v) => onChange(v)}
      />
    );
  }
  if (field.type === 'number') {
    return (
      <input
        type="text"
        inputMode="decimal"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        placeholder="—"
        style={{
          width: 90,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid var(--border-light)',
          color: 'var(--text-bright)',
          padding: '4px 8px',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          fontFamily: 'inherit',
          textAlign: 'center',
          outline: 'none',
        }}
      />
    );
  }
  /* text */
  return (
    <input
      type="text"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      placeholder={field.placeholder ?? '—'}
      style={{
        width: '100%',
        minWidth: 160,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid var(--border-light)',
        color: 'var(--text-bright)',
        padding: '4px 10px',
        borderRadius: 6,
        fontSize: 12,
        fontFamily: 'inherit',
        outline: 'none',
      }}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────
   FORM PRIMITIVES
   ─────────────────────────────────────────────────────────────── */
function PassFailEditor({
  value, onChange,
}: {
  value: 'pass' | 'fail' | undefined;
  onChange: (v: 'pass' | 'fail' | undefined) => void;
}) {
  return (
    <div style={{ display: 'inline-flex', gap: 6 }}>
      <ToggleButton
        active={value === 'pass'}
        activeColor="rgba(76,201,118,0.22)"
        activeBorder="rgba(76,201,118,0.65)"
        activeText="#a7e6b8"
        onClick={() => onChange(value === 'pass' ? undefined : 'pass')}
      >
        Pass
      </ToggleButton>
      <ToggleButton
        active={value === 'fail'}
        activeColor="rgba(231,98,98,0.22)"
        activeBorder="rgba(231,98,98,0.65)"
        activeText="#f0a8a8"
        onClick={() => onChange(value === 'fail' ? undefined : 'fail')}
      >
        Fail
      </ToggleButton>
    </div>
  );
}

function YesNoEditor({
  value, onChange,
}: {
  value: 'yes' | 'no' | undefined;
  onChange: (v: 'yes' | 'no' | undefined) => void;
}) {
  return (
    <div style={{ display: 'inline-flex', gap: 6 }}>
      <ToggleButton
        active={value === 'yes'}
        activeColor="rgba(231,98,98,0.22)"
        activeBorder="rgba(231,98,98,0.65)"
        activeText="#f0a8a8"
        onClick={() => onChange(value === 'yes' ? undefined : 'yes')}
      >
        Yes
      </ToggleButton>
      <ToggleButton
        active={value === 'no'}
        activeColor="rgba(126,182,255,0.20)"
        activeBorder="rgba(126,182,255,0.55)"
        activeText="#cfe0ff"
        onClick={() => onChange(value === 'no' ? undefined : 'no')}
      >
        No
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active, activeColor, activeBorder, activeText, onClick, children,
}: {
  active: boolean;
  activeColor: string;
  activeBorder: string;
  activeText: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 12px',
        borderRadius: 6,
        border: `1px solid ${active ? activeBorder : 'rgba(255,255,255,0.14)'}`,
        background: active ? activeColor : 'rgba(255,255,255,0.04)',
        color: active ? activeText : 'var(--text-muted)',
        fontSize: 11, fontWeight: 700,
        letterSpacing: '0.06em', textTransform: 'uppercase',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'background 0.12s ease, color 0.12s ease, border-color 0.12s ease',
      }}
    >
      {children}
    </button>
  );
}

function FlagChip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <ToggleButton
      active={active}
      activeColor="rgba(126,182,255,0.20)"
      activeBorder="rgba(126,182,255,0.55)"
      activeText="#cfe0ff"
      onClick={onClick}
    >
      {children}
    </ToggleButton>
  );
}

/* Centered numeric/text input cell — used inside the 5-col / 3-col
   metric grids in Strength + Speed. Mirrors the profile's
   `DisplayValue` layout (label/unit centered above the value), only
   the value is now an <input>. */
function InputCell({
  label, unit, value, onChange,
}: {
  label?: string;
  unit?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  /* Two layout modes, mirroring the profile's `DisplayValue`:
       • LABEL MODE (Strength cells: "CMJ Height (in/cm)", etc.) —
         label on line 1, unit on its OWN line 2 BELOW the label,
         input on line 3.
       • UNIT-ONLY MODE (Speed cells: just "sec", "mph", "m/s²" — no
         label) — render the input + unit on the SAME line, so the
         unit sits NEXT TO the number once a value is typed. */
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
          {/* Line 1: label only. */}
          <div style={{ ...fieldLabelStyle, textAlign: 'center' }}>
            {label}
          </div>
          {/* Line 2: unit on its own row beneath the label — same
             treatment as the profile's `DisplayValue` so the form
             previews the saved profile rendering 1:1. */}
          <div style={{
            fontFamily: 'inherit',
            fontSize: 10,
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
      {/* UNIT-ONLY MODE wraps the input + inline unit in a flex row
         so they read as a single "value sec" pair. LABEL MODE only
         needs the input. */}
      {!labelMode && unit ? (
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          width: '100%',
        }}>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="—"
            style={{
              flex: 1,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid var(--border-light)',
              color: 'var(--text-bright)',
              padding: '4px 8px',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              fontFamily: 'inherit',
              textAlign: 'center',
              outline: 'none',
              minWidth: 0,
            }}
          />
          <span style={{
            fontSize: 11,
            fontWeight: 500,
            color: 'rgba(255,255,255,0.78)',
            letterSpacing: '0.02em',
            textTransform: 'lowercase',
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
          }}>
            {unit}
          </span>
        </div>
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="—"
          style={{
            width: '100%',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid var(--border-light)',
            color: 'var(--text-bright)',
            padding: '4px 8px',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            fontFamily: 'inherit',
            textAlign: 'center',
            outline: 'none',
          }}
        />
      )}
    </div>
  );
}

/* Notes field — label + textarea (or single-line input). Used by the
   Power/Imbalance, Flag/Notes, and Warm-up Movement Notes blocks. */
function NotesField({
  label, value, onChange, placeholder, singleLine,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  singleLine?: boolean;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={fieldLabelStyle}>{label}</div>
      {singleLine ? (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={baseInputStyle}
        />
      ) : (
        <textarea
          rows={2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ ...baseInputStyle, resize: 'vertical', fontFamily: 'inherit' }}
        />
      )}
    </div>
  );
}

/* Inline text input used inside the mobility cards' horizontal
   field strip — same chrome but no separate label since the
   surrounding FieldCell already supplies one. */
function TextInline({
  value, onChange, placeholder, multiline,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  if (multiline) {
    return (
      <textarea
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          ...baseInputStyle,
          marginTop: 0,
          resize: 'vertical',
          fontFamily: 'inherit',
        }}
      />
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ ...baseInputStyle, marginTop: 0 }}
    />
  );
}

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
     `fill` flag so its inner textarea can still take the full
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
        }}>
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   SHARED CHROME — same shapes as the profile tab.
   ─────────────────────────────────────────────────────────────── */
function GreyMetricBubble({
  title, subtitle, children,
}: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{
      ...movementPlotBubbleStyle,
      padding: '12px 14px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
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
        }}>{title}</span>
        {subtitle && (
          <span style={{
            fontSize: 10,
            /* Subtitle reads white per coach-spec — used to be
               `var(--text-muted)` but every label / subtitle in
               the form should now be white. */
            color: 'var(--text-bright)',
            letterSpacing: '0.04em',
          }}>{subtitle}</span>
        )}
        <div
          aria-hidden="true"
          style={{
            flex: 1, height: 1, background: 'var(--border)',
            alignSelf: 'flex-end', marginBottom: 6,
          }}
        />
      </div>
      <div aria-hidden="true" style={{ height: 1, background: 'var(--border)' }} />
      {children}
    </div>
  );
}

function SubBlock({
  title, subtitle, children,
}: { title: string; subtitle?: string; children: React.ReactNode }) {
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
          fontSize: 13, fontWeight: 700,
          color: 'var(--text-bright)', lineHeight: 1.05,
          letterSpacing: '-0.01em',
          textTransform: 'uppercase',
        }}>{title}</span>
        {subtitle && (
          <span style={{
            fontSize: 10,
            /* Subtitle reads white per coach-spec — every label /
               subtitle across the form is now consistently white. */
            color: 'var(--text-bright)',
            letterSpacing: '0.04em',
          }}>{subtitle}</span>
        )}
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>
      {children}
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
      <span style={{
        fontFamily: 'var(--font-display)',
        fontSize: 22, fontWeight: 600,
        fontStyle: 'italic', color: 'var(--text)',
        letterSpacing: '-0.025em',
      }}>{title}</span>
      {subtitle && (
        <span style={{
          fontSize: 11,
          /* Subtitle reads white per coach-spec. */
          color: 'var(--text-bright)',
          letterSpacing: '0.04em',
        }}>{subtitle}</span>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   SHARED STYLES
   ─────────────────────────────────────────────────────────────── */
const fieldLabelStyle: React.CSSProperties = {
  /* All secondary labels in the Physical Report form (CMF Height,
     Throwing Hand, Throwing Arm, Lower Back Arches Off Wall, every
     mobility card field label, every Force/Athletic/Grip/Speed
     sub-bubble metric label, etc.) render at the EXACT typography
     of the "Max Bat Speed" header in the Hitting Swing Inputs
     sections (Blast Motion / Full Swing / HitTrax / Coach Grades)
     — i.e. the DEFAULT (non-compact) HittingMetricTable header:
     11.88 px / weight 600 / 0.05em letter-spacing / uppercase /
     line-height 1.1, Satoshi via inherit. Was previously
     10 px / weight 700 / 0.08em — slightly smaller AND visibly
     heavier. Bumping to 11.88 keeps the form + profile
     typographically identical (the profile's `fieldLabelStyle`
     was updated to the same values in the same commit). */
  fontFamily: 'inherit',
  fontSize: 11.88,
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

const baseInputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--border-light)',
  color: 'var(--text-bright)',
  padding: '6px 10px',
  borderRadius: 6,
  fontSize: 12,
  fontFamily: 'inherit',
  outline: 'none',
  marginTop: 4,
};

const fiveColGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
  gap: 10,
};

const threeColGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 10,
};
