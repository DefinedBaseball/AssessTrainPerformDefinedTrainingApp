'use client';

/* Player Summary → Stats: one "Season Stats" bubble holding a grid per
   position group the athlete plays (Hitting / Pitching / Defense /
   Catching), one row per school-year season.

   Edit (top right, where Trends shows its metric count) turns every cell in
   every grid into a text box at once; Save writes the lot. The athlete can
   edit their own stats, as can any coach above Viewer level -- the API
   enforces the same rule. Rate stats left blank fill in from the counting
   stats (shown muted); anything typed wins. */

import { useEffect, useMemo, useState } from 'react';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  STAT_GRIDS, gridsForPositions, parseSeasonStats, cleanSeasonStats, statValue,
  isCalculated, sanitizeStatInput, seasonForDate, seasonLabel,
  type SeasonStats, type StatGridKey,
} from '@/lib/season-stats';
import summaryStyles from '../tabs/PlayerSummaryTab.module.css';
import s from './SeasonStatsSection.module.css';

function clone(stats: SeasonStats): SeasonStats {
  return JSON.parse(JSON.stringify(stats));
}

/* Left / Right arrow moves to the previous / next stat box in the same
   season row, spreadsheet-style: the value stays where it was typed, and
   the next box's contents are selected so typing replaces them. Stops at
   the ends of the row. */
function moveAlongRow(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const row = e.currentTarget.closest('tr');
  if (!row) return;
  const boxes = Array.from(row.querySelectorAll<HTMLInputElement>('input'));
  const next = boxes[boxes.indexOf(e.currentTarget) + (e.key === 'ArrowRight' ? 1 : -1)];
  if (!next) return;
  e.preventDefault();
  next.focus();
  next.select();
}

export function SeasonStatsSection({
  player, onSaved,
}: {
  player: { id: string; positions?: string | null; seasonStats?: string | null };
  onSaved?: () => void;
}) {
  const { user, isCoach, isViewer } = useAuth();
  const canEdit = isCoach ? !isViewer : !!user?.playerId && user.playerId === player.id;

  const [saved, setSaved] = useState<SeasonStats>(() => parseSeasonStats(player.seasonStats));
  /* A refetch of the player (another tab saved, a background refresh)
     replaces what is shown -- but never mid-edit. */
  const [draft, setDraft] = useState<SeasonStats | null>(null);
  useEffect(() => {
    if (!draft) setSaved(parseSeasonStats(player.seasonStats));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.seasonStats]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const grids = useMemo(() => {
    const wanted = gridsForPositions(player.positions);
    return STAT_GRIDS.filter((g) => wanted.includes(g.key));
  }, [player.positions]);

  const editing = draft !== null;
  const shown = draft ?? saved;
  const current = seasonForDate();

  const startEdit = () => {
    const next = clone(saved);
    /* A grid with no seasons yet opens with this season's row ready. */
    for (const g of grids) {
      if (!next[g.key] || Object.keys(next[g.key]!).length === 0) next[g.key] = { [String(current)]: {} };
    }
    setError('');
    setDraft(next);
  };

  const setCell = (grid: StatGridKey, season: string, key: string, value: string) => {
    setDraft((d) => {
      if (!d) return d;
      const next = clone(d);
      const g = (next[grid] ??= {});
      const row = (g[season] ??= {});
      row[key] = sanitizeStatInput(value);
      return next;
    });
  };

  const addSeason = (grid: StatGridKey) => {
    setDraft((d) => {
      if (!d) return d;
      const next = clone(d);
      const g = (next[grid] ??= {});
      /* This season first, then each earlier one in turn. */
      let y = current;
      while (g[String(y)]) y -= 1;
      g[String(y)] = {};
      return next;
    });
  };

  const removeSeason = (grid: StatGridKey, season: string) => {
    setDraft((d) => {
      if (!d) return d;
      const next = clone(d);
      delete next[grid]?.[season];
      return next;
    });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError('');
    try {
      const clean = cleanSeasonStats(draft);
      const res = await api.setPlayerSeasonStats(player.id, clean);
      setSaved(parseSeasonStats(res.seasonStats));
      setDraft(null);
      onSaved?.();
    } catch (err: any) {
      setError(err?.message || 'Could not save stats.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={summaryStyles.panel}>
      <div className={summaryStyles.sectionTitle}>
        <div>
          <h2 className={summaryStyles.panelTitle}>Season Stats</h2>
        </div>
        {canEdit && (
          editing ? (
            <span className={s.actions}>
              <button type="button" className={s.chip} onClick={() => { setDraft(null); setError(''); }} disabled={saving}>
                Cancel
              </button>
              <button type="button" className={`${s.chip} ${s.chipPrimary}`} onClick={() => void save()} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </span>
          ) : (
            <button type="button" className={s.chip} onClick={startEdit} title="Edit season stats">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11.5 2.5a1.6 1.6 0 0 1 2.3 2.3L5.5 13.1 2.5 14l.9-3z" />
                <path d="M10.3 3.7l2 2" />
              </svg>
              Edit
            </button>
          )
        )}
      </div>

      {error && <div role="alert" className={s.error}>{error}</div>}

      <div className={s.grids}>
        {grids.map((g) => {
          const seasons = Object.keys(shown[g.key] ?? {}).sort((a, b) => Number(a) - Number(b));
          return (
            <div key={g.key} className={s.gridBlock}>
              <div className={s.gridLabel}>
                <span>{g.title}</span>
                <span className={s.hairline} aria-hidden="true" />
              </div>

              {seasons.length === 0 && !editing ? (
                <div className={s.empty}>
                  No {g.title.toLowerCase()} stats yet.{canEdit ? ' Use Edit to add a season.' : ''}
                </div>
              ) : (
                <div className={s.scroller}>
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th className={s.seasonCol} scope="col">Season</th>
                        {g.columns.map((col) => (
                          <th key={col.key} scope="col" title={col.title}>{col.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {seasons.map((season) => {
                        const row = shown[g.key]?.[season] ?? {};
                        return (
                          <tr key={season}>
                            <th scope="row" className={s.seasonCol}>
                              <span className={s.seasonCell}>
                                {seasonLabel(season)}
                                {editing && (
                                  <button
                                    type="button"
                                    className={s.remove}
                                    onClick={() => removeSeason(g.key, season)}
                                    title={`Remove the ${seasonLabel(season)} season`}
                                    aria-label={`Remove the ${seasonLabel(season)} ${g.title} season`}
                                  >×</button>
                                )}
                              </span>
                            </th>
                            {g.columns.map((col) => {
                              const v = statValue(g.key, col.key, row);
                              if (editing) {
                                return (
                                  <td key={col.key}>
                                    <input
                                      className={s.input}
                                      value={row[col.key] ?? ''}
                                      placeholder={v.calculated ? v.value : ''}
                                      inputMode={col.key === 'SB/ATT' ? 'text' : 'decimal'}
                                      aria-label={`${seasonLabel(season)} ${col.title}`}
                                      title={isCalculated(g.key, col.key)
                                        ? `${col.title} — fills in automatically if left blank`
                                        : col.title}
                                      onChange={(e) => setCell(g.key, season, col.key, e.target.value)}
                                      onKeyDown={moveAlongRow}
                                    />
                                  </td>
                                );
                              }
                              return (
                                <td
                                  key={col.key}
                                  className={v.calculated ? s.calc : v.value ? undefined : s.blank}
                                  title={v.calculated ? 'Calculated' : undefined}
                                >
                                  {v.value || '–'}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {editing && (
                <button type="button" className={s.addSeason} onClick={() => addSeason(g.key)}>
                  + Add Season
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className={s.footnote}>
        Seasons run on the school year, starting mid-August. Grey values are calculated from the stats entered.
      </div>
    </section>
  );
}
