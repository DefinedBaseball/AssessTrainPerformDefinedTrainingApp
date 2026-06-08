'use client';

import type { ReactNode } from 'react';
import styles from './assessment.module.css';

type IconColor = 'teal' | 'gold' | 'red' | 'green';

interface SectionHeaderProps {
  /** Emoji string OR a custom ReactNode (e.g. inline SVG logo).
   *  Optional — passing `undefined` (or omitting the prop) renders the
   *  header with the title text only and no icon slot. */
  icon?: ReactNode;
  iconColor?: IconColor;
  title: string;
  subtitle?: string;
  /** When true, the icon is rendered AFTER the title text (immediately
   *  to the right of the title block) instead of before it. Used for
   *  branded headers (Coach Grades, Full Swing, Blast Motion, HitTrax)
   *  where the logo reads as a suffix badge, not a leading bullet. */
  iconAfter?: boolean;
  /** Optional right-edge content slot — sits at the far right of the
   *  header row, opposite the title, AFTER the title-midline hairline.
   *  Used by Infield / Outfield / Catching Snapshots to host the
   *  data-date-range chip the same way the Hitting Snapshot's inline
   *  header does. */
  rightSlot?: ReactNode;
  /** Compact variant — swaps the title down to "Font B" sizing
   *  (Brown display, upright, 1rem, weight 600, -0.025em, uppercase,
   *  bright white) used for branded sub-section headers (Coach
   *  Grades, Full Swing, Blast Motion, HitTrax) that sit ONE TIER
   *  below the top-level Snapshot titles. Snapshot titles keep the
   *  default 20.7 px italic display style. */
  compact?: boolean;
  /** When the `compact` variant is on, this controls whether the
   *  icon + title cluster is centered between two flex-1 hairlines
   *  (default `'center'`) or pinned to the left with only a trailing
   *  hairline (`'left'`). No-op when `compact` is false — base
   *  headers are always left-aligned. */
  align?: 'center' | 'left';
  /** Suppresses the row's bottom border (the `border-bottom` on
   *  `.sectionHeader`) so the header sits flush against whatever
   *  follows it. Used by the Full Swing / Coach Grades headers in
   *  the Hitting Inputs sections to drop the line between the title
   *  and the column-label row below. */
  noBorder?: boolean;
  /** Repositions the trailing accent hairline from the title's
   *  vertical mid-line (default) down to the title's baseline /
   *  bottom edge. Used by the Full Swing section so the right-edge
   *  rule reads as a line UNDER the title instead of a line passing
   *  through the title's middle. */
  hairlineUnderTitle?: boolean;
}

const ICON_CLASS: Record<IconColor, string> = {
  teal: styles.iconTeal,
  gold: styles.iconGold,
  red: styles.iconRed,
  green: styles.iconGreen,
};

export function SectionHeader({ icon, iconColor = 'teal', title, subtitle, iconAfter = false, rightSlot, compact = false, align = 'center', noBorder = false, hairlineUnderTitle = false }: SectionHeaderProps) {
  // Compact `align='left'` opts a specific compact header out of the
  // default centered-cluster layout so it reads left-aligned like the
  // base SectionHeader (only a trailing hairline, no leading one).
  const compactLeft = compact && align === 'left';
  // Split the title on the first space so the first word reads in the
  // "Mason" silver gradient and the rest reads in the italic-blue "Brown"
  // accent — mirrors the player hero name treatment.
  const trimmed = title.trim();
  const spaceIdx = trimmed.indexOf(' ');
  const firstWord = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const restWords = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);
  const iconNode = icon != null && icon !== false ? (
    <div className={`${styles.sectionIcon} ${ICON_CLASS[iconColor]}`}>{icon}</div>
  ) : null;
  return (
    <div
      className={`${styles.sectionHeader}${compact ? ' ' + styles.sectionHeaderCompact : ''}${compactLeft ? ' ' + styles.sectionHeaderCompactLeft : ''}`}
      style={noBorder
        /* When `hairlineUnderTitle` is also set, keep some padding
           below the title so the absolutely-positioned rule sits
           visibly under the title text. Halved from the default
           0.7 rem to 0.35 rem so the rule sits 50 % closer to the
           title than the canonical SectionHeader spacing. */
        ? (hairlineUnderTitle ? { borderBottom: 'none', paddingBottom: '0.35rem' } : { borderBottom: 'none', paddingBottom: 0 })
        : undefined}
    >
      {/* Leading accent hairline — only rendered when the `compact`
          variant is on AND `align='center'` (default), so the icon +
          title cluster is centered between two flex-1 hairlines (one
          on each side). `alignSelf: center` + no margin so the
          hairline runs through the cluster's vertical midline (the
          parent uses `align-items: center` in compact mode), giving
          the centered look a "—— [LOGO] TITLE ——" balanced rhythm.
          Suppressed when `compactLeft` so a specific compact header
          (e.g. Blast Motion) can opt back to left-aligned. */}
      {compact && !compactLeft && (
        <div
          aria-hidden="true"
          style={{
            flex: 1,
            height: 1,
            background: 'var(--border)',
            alignSelf: 'center',
          }}
        />
      )}
      {/* Leading icon slot — only rendered when an icon is provided
          AND iconAfter is off. Section headers that pass `icon`
          undefined (e.g. the four Snapshot bubbles + all Video
          sections) skip the icon slot entirely. */}
      {!iconAfter && iconNode}
      <div>
        <div className={styles.sectionTitle}>
          <span className={styles.sectionTitleFirst}>{firstWord}</span>
          {restWords && (
            <>
              {' '}
              <span className={styles.sectionTitleAccent}>{restWords}</span>
            </>
          )}
        </div>
        {subtitle && <div className={styles.sectionSub}>{subtitle}</div>}
      </div>
      {/* Trailing icon slot — used by branded section headers (Coach
          Grades, Full Swing, Blast Motion, HitTrax, Trackman) so the
          logo reads as a post-title badge instead of a leading
          bullet. Placed BEFORE the title-midline hairline so the
          icon stays right next to the title text (its `iconAfter`
          purpose) and the hairline runs out from there to the
          right edge. */}
      {iconAfter && iconNode}
      {/* Title-midline hairline — a 1px-tall accent line that runs
          from immediately after the title block (or after the
          iconAfter badge, when present) to the bubble's right edge.
          Vertically lifted 12px from the row's bottom via
          `marginBottom: 12` so it lands at the title text's
          mid-line for a 23px italic display title (≈ half the cap
          height). The full-width `border-bottom` on `.sectionHeader`
          itself still serves as the main accent line at the row's
          bottom. */}
      {hairlineUnderTitle ? (
        /* `hairlineUnderTitle` variant — the rule is absolutely
           positioned at the BOTTOM of the row, spanning the FULL
           row width (from left edge to right edge). It runs UNDER
           the title text and the logo so the whole header row gets
           one continuous accent line at its bottom. Used by the
           Full Swing section header. */
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 1,
            background: 'var(--border)',
          }}
        />
      ) : (
        <div
          aria-hidden="true"
          style={compact
            ? {
                /* Compact variant — center-align with the icon + title
                   cluster so the hairline runs through the vertical
                   midline of the centered row. */
                flex: 1,
                height: 1,
                background: 'var(--border)',
                alignSelf: 'center',
              }
            : {
                flex: 1,
                height: 1,
                background: 'var(--border)',
                alignSelf: 'flex-end',
                marginBottom: 12,
              }}
        />
      )}
      {/* Right-edge slot — sits at the far right of the header row,
          AFTER the title-midline hairline. The hairline keeps its
          `flex: 1` grow rule so it stops at the slot's left edge,
          producing a clean "title — line — slot" rhythm consistent
          with the Hitting Snapshot's inline header. */}
      {rightSlot}
    </div>
  );
}

export function Section({ children }: { children: React.ReactNode }) {
  return <div className={styles.section}>{children}</div>;
}
