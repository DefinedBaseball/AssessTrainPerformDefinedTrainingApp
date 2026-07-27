'use client';

/* ─────────────────────────────────────────────────────────────────────
   usePlayerProfileData — the single fetch behind every surface that
   renders profile content.

   Extracted from the profile page when the Player Summary moved onto the
   player's Dashboard: both now need the same bundle (player + metrics,
   top metrics, per-report progress series, videos, reports), and having
   two copies of this fetch would guarantee they drift apart.

   Everything is fetched in one Promise.all so the page paints once
   instead of popping in piecemeal. Non-critical calls swallow their own
   errors and fall back to empty — only `getPlayer` failing is treated as
   a real error, since without the player there's nothing to render.
   ───────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from 'react';
import * as api from '@/lib/api';
import type { Metric, Player, Video } from '@/lib/api';
import type { ReportSummary } from './helpers';

/* Metric keys the trend charts plot. Fetched with source 'REPORT' so each
   report contributes exactly one point and seeded / raw-CSV rows never
   reach a trend line. */
export const PROGRESS_METRICS = [
  // Hitting
  'max_exit_velo', 'max_bat_speed', 'avg_exit_velo', 'avg_bat_speed',
  'bat_speed', 'smash_factor', 'launch_angle', 'attack_angle', 'distance',
  'squared_up_pct', 'plane_angle',
  // Defense
  'infield_velo', 'outfield_velo', 'catcher_velo', 'pop_time', 'exchange_time',
  // Pitching
  'fb_max_velo', 'fb_avg_velo', 'spin_rate', 'h_break', 'v_break', 'sprint_60',
  // Speed (Physical / defense sprint trends — 60-yd + 10-yd dash)
  'sprint_10',
  // Strength
  'jump_height', 'broad_jump', 'squat_max', 'bench_max', 'deadlift_max',
  // Vision
  'vizual_edge_overall', 'vizual_edge_convergence', 'vizual_edge_divergence',
  'vizual_edge_tracking', 'vizual_edge_recognition',
];

export interface PlayerProfileData {
  player: (Player & { metrics: Metric[] }) | null;
  topMetrics: Record<string, { value: number; unit: string; recordedAt: string }>;
  progressData: Record<string, { value: number; recordedAt: string }[]>;
  videos: Video[];
  reports: ReportSummary[];
  colleges: api.College[];
  loading: boolean;
  error: string | null;
}

export function usePlayerProfileData(
  playerId: string | null | undefined,
  opts?: {
    /** Gate the fetch until auth has resolved. Defaults to true. */
    enabled?: boolean;
    /** Bump to force a refetch (the profile page's refresh mechanism). */
    refreshKey?: number;
    /** Colleges back the commitment badge's logo lookup — only the profile
     *  header needs them, so callers that don't render it can skip the
     *  request entirely. Defaults to true. */
    withColleges?: boolean;
  },
): PlayerProfileData {
  const enabled = opts?.enabled ?? true;
  const refreshKey = opts?.refreshKey ?? 0;
  const withColleges = opts?.withColleges ?? true;

  const [player, setPlayer] = useState<(Player & { metrics: Metric[] }) | null>(null);
  const [topMetrics, setTopMetrics] = useState<PlayerProfileData['topMetrics']>({});
  const [progressData, setProgressData] = useState<PlayerProfileData['progressData']>({});
  const [videos, setVideos] = useState<Video[]>([]);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [colleges, setColleges] = useState<api.College[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !playerId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const progressPromises = PROGRESS_METRICS.map((mt) =>
      api.getMetricProgress(playerId, mt, 'REPORT')
        .then((data) => ({ mt, data }))
        .catch(() => ({ mt, data: [] as { value: number; recordedAt: string }[] })),
    );

    Promise.all([
      api.getPlayer(playerId),
      api.getTopMetrics(playerId).catch(() => ({})),
      api.getPlayerVideos(playerId).catch(() => []),
      api.getPlayerReports(playerId).catch(() => []),
      Promise.all(progressPromises),
      withColleges
        ? api.getColleges().catch(() => [] as api.College[])
        : Promise.resolve([] as api.College[]),
    ]).then(([p, top, vids, reps, progressResults, colls]) => {
      if (cancelled) return;
      setPlayer(p);
      setTopMetrics(top);
      setVideos(vids);
      setReports(reps as ReportSummary[]);
      setColleges(colls);
      const pd: Record<string, { value: number; recordedAt: string }[]> = {};
      progressResults.forEach(({ mt, data }) => { if (data.length > 0) pd[mt] = data; });
      setProgressData(pd);
      setLoading(false);
    }).catch((err: Error) => {
      if (cancelled) return;
      setError(err.message || 'Failed to load player');
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [enabled, playerId, refreshKey, withColleges]);

  return { player, topMetrics, progressData, videos, reports, colleges, loading, error };
}
