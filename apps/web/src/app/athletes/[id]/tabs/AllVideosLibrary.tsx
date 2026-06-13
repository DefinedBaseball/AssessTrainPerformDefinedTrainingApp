'use client';

/**
 * AllVideosLibrary — full-page video library for one athlete.
 *
 * Surfaces every video uploaded under this player across every
 * category (Hitting / Pitching / Catching / Infield / Outfield /
 * S & C), filterable by:
 *
 *   • Position  — chip strip: All / Hitting / Pitching / Catching /
 *                 Infield / Outfield / S & C. Maps to the video's
 *                 stored `category` field.
 *   • Date      — chip strip: All / Last 30 days / Last 90 days /
 *                 This year. Custom date range omitted to keep the
 *                 control surface tight; widen later if needed.
 *
 * Bundles multi-angle Training clips via the shared `bundleVideos`
 * helper so the gallery matches every other surface across the
 * profile (one bubble per shoot session, count badge for bundles).
 * Renders through VideoBundleCard so the click-into-modal flow
 * (Coach Review recording, sync/unsync, drawing tools, compare) is
 * available straight from the library.
 *
 * Linked from every tab's Videos icon-button next to Download (via
 * `onOpenVideos` → routes to the Videos tab → All Videos sub-tab).
 */

import { rem } from '@/lib/rem';
import { useEffect, useMemo, useState } from 'react';
import { Section, SectionHeader, VideoBundleCard } from '@/components/assessment';
import { bundleVideos } from '@/lib/video-titles';
import type { TabProps } from '../helpers';

const POSITION_FILTERS: { key: string; label: string; matches: (cat: string) => boolean }[] = [
  { key: 'all',      label: 'All',      matches: () => true },
  { key: 'hitting',  label: 'Hitting',  matches: (c) => c === 'HITTING' },
  { key: 'pitching', label: 'Pitching', matches: (c) => c === 'PITCHING' },
  { key: 'catching', label: 'Catching', matches: (c) => c === 'CATCHING' },
  { key: 'infield',  label: 'Infield',  matches: (c) => c === 'INFIELD' || c === 'FIELDING' },
  { key: 'outfield', label: 'Outfield', matches: (c) => c === 'OUTFIELD' },
  { key: 'sandc',    label: 'S & C',    matches: (c) => c === 'WORKOUT_DEMO' || c === 'STRENGTH' },
];

type DateKey = '30d' | '90d' | 'year' | 'all' | 'custom';
const DATE_FILTERS: { key: DateKey; label: string }[] = [
  { key: '30d',    label: 'Last 30 Days' },
  { key: '90d',    label: 'Last 90 Days' },
  { key: 'year',   label: 'Last Year' },
  { key: 'all',    label: 'All Time' },
  { key: 'custom', label: 'Date Range' },
];

/* Build a predicate that gates each video's `createdAt` ISO string
   for the active date-filter chip. Rolling windows (`30d` / `90d` /
   `year`) compute their cutoff off the timestamp captured when the
   library mounted, so the boundary is consistent within a render
   session and not jittery as the clock ticks. */
function dateFilterPredicate(
  key: DateKey,
  now: Date,
  customFrom: string,
  customTo: string,
): (iso: string) => boolean {
  if (key === 'all') return () => true;

  if (key === 'custom') {
    /* Custom range — `from`/`to` are YYYY-MM-DD strings from the
       native date inputs. Empty strings collapse to "no bound on
       this side" so the coach can specify just one end of the
       range (e.g., everything after a certain date with the To
       field blank). */
    const fromMs = customFrom ? new Date(customFrom + 'T00:00:00').getTime() : -Infinity;
    /* End-of-day for the To bound so the picked day is fully
       included (otherwise the 23:59 clip from that day would be
       excluded). */
    const toMs = customTo ? new Date(customTo + 'T23:59:59.999').getTime() : Infinity;
    return (iso) => {
      const t = new Date(iso).getTime();
      return t >= fromMs && t <= toMs;
    };
  }

  const nowMs = now.getTime();
  const days = key === '30d' ? 30 : key === '90d' ? 90 : 365;
  const cutoff = nowMs - days * 24 * 60 * 60 * 1000;
  return (iso) => new Date(iso).getTime() >= cutoff;
}

export function AllVideosLibrary({
  player, videos, reports, onRefresh,
}: TabProps) {
  const [positionKey, setPositionKey] = useState<string>('all');
  /* Date filter defaults to All Time so coaches landing on this
     page see the full library by default; chip selection narrows it. */
  const [dateKey, setDateKey] = useState<DateKey>('all');
  /* Custom-range pickers — YYYY-MM-DD strings bound to native date
     inputs that appear only when the `Date Range` chip is active.
     Both empty strings = unbounded on that side. */
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  /* Snapshot `now` once per render of the date filter — close enough
     for human-scale filtering. */
  const [now] = useState(() => new Date());

  /* READY-only + newest-first — same gate the Player Summary panel
     uses so in-progress uploads don't render as broken tiles. */
  const readyVideos = useMemo(() => (
    videos
      .filter((v) => v.status === 'READY')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  ), [videos]);

  const positionMatches = useMemo(
    () => POSITION_FILTERS.find((p) => p.key === positionKey)?.matches ?? (() => true),
    [positionKey],
  );
  const dateMatches = useMemo(
    () => dateFilterPredicate(dateKey, now, customFrom, customTo),
    [dateKey, now, customFrom, customTo],
  );

  const filteredVideos = useMemo(() => (
    readyVideos.filter((v) => (
      positionMatches((v.category || '').toUpperCase()) &&
      dateMatches(v.createdAt)
    ))
  ), [readyVideos, positionMatches, dateMatches]);

  const bundled = useMemo(() => bundleVideos(filteredVideos), [filteredVideos]);

  return (
    <Section>
      <SectionHeader
        title="All Videos"
        subtitle={`${readyVideos.length} total · ${filteredVideos.length} shown`}
      />

      {/* Filter chip rows — Position on top, Date below. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        <FilterRow label="Position">
          {POSITION_FILTERS.map((opt) => (
            <Chip
              key={opt.key}
              active={positionKey === opt.key}
              onClick={() => setPositionKey(opt.key)}
            >
              {opt.label}
            </Chip>
          ))}
        </FilterRow>
        <FilterRow label="Date">
          {DATE_FILTERS.map((opt) => (
            <Chip
              key={opt.key}
              active={dateKey === opt.key}
              onClick={() => setDateKey(opt.key)}
            >
              {opt.label}
            </Chip>
          ))}
        </FilterRow>

        {/* Custom date-range pickers — only render when `Date Range`
            chip is active. Two native <input type="date"> elements
            bind to `customFrom` / `customTo`; either can be left
            blank to express an open-ended range on that side. */}
        {dateKey === 'custom' && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            marginLeft: 80, // align under the Date chip row
          }}>
            <DateField
              label="From"
              value={customFrom}
              onChange={setCustomFrom}
              max={customTo || undefined}
            />
            <DateField
              label="To"
              value={customTo}
              onChange={setCustomTo}
              min={customFrom || undefined}
            />
            {(customFrom || customTo) && (
              <button
                type="button"
                onClick={() => { setCustomFrom(''); setCustomTo(''); }}
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--border-strong)',
                  color: 'var(--text-muted)',
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: rem(10),
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {filteredVideos.length === 0 ? (
        <div style={{
          color: 'var(--text-muted)', fontSize: rem(13), fontStyle: 'italic',
          padding: '20px 0',
        }}>
          {readyVideos.length === 0
            ? 'No videos uploaded yet.'
            : 'No videos match the current filters.'}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gridAutoRows: 'max-content',
          gap: 12,
          /* No row cap on this page — coaches WANT the full library
             when they navigate here. Long lists scroll the page
             normally rather than scrolling within a container. */
        }}>
          {bundled.map((b) => {
            const cardVideos = b.videos.map((v) => ({
              id: v.id,
              title: v.title,
              category: v.category,
              createdAt: v.createdAt,
              originalUrl: v.hlsUrl || v.originalUrl,
            }));
            return (
              <VideoBundleCard
                key={b.key}
                videos={cardVideos}
                size="md"
                playerId={player.id}
                recordingCategory={b.videos[0].category}
                onUploaded={onRefresh}
                /* Forward the athlete's full report list so the
                   bundle modal's Record-and-save flow surfaces the
                   "Attach to Report" dropdown here too — same UX
                   the Hitting / Pitching / Defense per-tab Coach
                   Reviews bubbles already get. Without this prop
                   the dropdown auto-hides (per `AttachableReport[]`
                   contract on VideoBundleModalProps). */
                reports={reports}
              />
            );
          })}
        </div>
      )}
    </Section>
  );
}

/* ─── Filter chip row ──────────────────────────────────────────────── */
function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
    }}>
      <span style={{
        fontSize: rem(10),
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
        minWidth: 72,
      }}>
        {label}
      </span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {children}
      </div>
    </div>
  );
}

/* ─── Date input field — used by the custom Date Range picker ─── */
function DateField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
}) {
  return (
    <label style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontSize: rem(10),
      fontWeight: 700,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: 'var(--text-muted)',
    }}>
      {label}
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        style={{
          background: 'var(--border)',
          border: '1px solid var(--border-strong)',
          color: 'var(--text)',
          padding: '5px 8px',
          borderRadius: 6,
          fontSize: rem(12),
          fontFamily: 'inherit',
          outline: 'none',
          colorScheme: 'dark',
        }}
      />
    </label>
  );
}

/* ─── Filter chip button ──────────────────────────────────────────── */
function Chip({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 12px',
        borderRadius: 8,
        border: active
          ? '1px solid rgba(126,182,255,0.55)'
          : '1px solid rgba(255,255,255,0.18)',
        background: active
          ? 'rgba(126,182,255,0.20)'
          : 'rgba(255,255,255,0.04)',
        color: active ? '#cfe0ff' : 'var(--text)',
        fontSize: rem(11),
        fontWeight: 700,
        letterSpacing: '0.04em',
        cursor: 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}
