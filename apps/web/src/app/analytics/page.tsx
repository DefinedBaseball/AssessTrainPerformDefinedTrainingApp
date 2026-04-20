'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type {
  AnalyticsColumn, ChartConfig, ChartConfigInput,
  ChartDataSource, ChartEvaluation, Player,
} from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import styles from './page.module.css';

const SECTIONS = [
  { value: 'HITTING', label: 'Hitting' },
  { value: 'PITCHING', label: 'Pitching' },
  { value: 'DEFENSE', label: 'Defense' },
  { value: 'CATCHING', label: 'Catching' },
  { value: 'STRENGTH', label: 'Strength' },
  { value: 'OVERVIEW', label: 'Overview' },
];

const CHART_TYPES = [
  { value: 'BAR', label: 'Bar Chart' },
  { value: 'LINE', label: 'Line Chart' },
  { value: 'SCATTER', label: 'Scatter Plot' },
  { value: 'BUBBLE', label: 'Bubble Chart' },
  { value: 'STAT_BUBBLE', label: 'Stat Bubble (latest)' },
  { value: 'PERCENT_INCREASE', label: 'Percent Increase' },
  { value: 'MOVEMENT_PLOT', label: 'Movement Plot (X vs Y)' },
  { value: 'ROLLING_AVG', label: 'Rolling Average (SMA / EMA)' },
  { value: 'TRENDLINE', label: 'Trendline (linear regression)' },
  { value: 'TARGET_BAND', label: 'Target Band (line + goal zone)' },
  { value: 'PERSONAL_BEST', label: 'Personal Best Progression' },
  { value: 'STRIKE_ZONE_HEAT', label: 'Strike Zone Heat Map' },
];

// Chart types that need at least two data columns (X and Y)
const TWO_AXIS_TYPES = new Set(['MOVEMENT_PLOT', 'SCATTER', 'BUBBLE']);

const ALWAYS_ON = [
  'Full Swing Data', 'Spray Chart', 'Blast Data', 'Pitcher Velocity Bubbles',
  'Movement Plot', 'Strike Zone Plot', 'Catcher Zone',
];

type TabKey = 'analytics' | 'builder' | 'metrics' | 'saved';
type AnalyticsSubTab = 'running' | 'compare';
type MetricBuilderMode = 'basic' | 'advanced';

export default function AnalyticsPage() {
  const router = useRouter();
  const { user, isLoading, isCoach } = useAuth();
  const [tab, setTab] = useState<TabKey>('builder');
  const [analyticsSubTab, setAnalyticsSubTab] = useState<AnalyticsSubTab>('running');

  useEffect(() => {
    if (isLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!isCoach) { router.replace('/'); return; }
  }, [isLoading, user, isCoach, router]);

  if (isLoading || !user || !isCoach) return null;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Coach Workbench"
        title="Data"
        titleAccent="Analytics"
        subtitle="Build custom charts and bubbles from any imported data, preview them against a live player, then pin them to the relevant profile tab."
        readout="Chart Builder"
      />

      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${tab === 'analytics' ? styles.tabActive : ''}`}
          onClick={() => setTab('analytics')}
        >
          Analytics
        </button>
        <button
          className={`${styles.tab} ${tab === 'builder' ? styles.tabActive : ''}`}
          onClick={() => setTab('builder')}
        >
          Chart Builder
        </button>
        <button
          className={`${styles.tab} ${tab === 'metrics' ? styles.tabActive : ''}`}
          onClick={() => setTab('metrics')}
        >
          Metric Builder
        </button>
        <button
          className={`${styles.tab} ${tab === 'saved' ? styles.tabActive : ''}`}
          onClick={() => setTab('saved')}
        >
          Saved Charts
        </button>
      </div>

      {tab === 'analytics' && (
        <div>
          <div className={styles.subTabs}>
            <button
              className={`${styles.subTab} ${analyticsSubTab === 'running' ? styles.subTabActive : ''}`}
              onClick={() => setAnalyticsSubTab('running')}
            >
              Running Average
            </button>
            <button
              className={`${styles.subTab} ${analyticsSubTab === 'compare' ? styles.subTabActive : ''}`}
              onClick={() => setAnalyticsSubTab('compare')}
            >
              Compare
            </button>
          </div>
          {analyticsSubTab === 'running' && <RunningAvgPane />}
          {analyticsSubTab === 'compare' && <ComparePane />}
        </div>
      )}
      {tab === 'builder' && <BuilderPane userId={user.id} />}
      {tab === 'metrics' && <MetricBuilderPane />}
      {tab === 'saved' && <SavedPane />}
    </div>
  );
}

/* ─── Builder pane ────────────────────────────────────────── */

function BuilderPane({ userId }: { userId: string }) {
  const [columns, setColumns] = useState<AnalyticsColumn[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [previewPlayerId, setPreviewPlayerId] = useState<string>('');

  // Form fields
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [section, setSection] = useState('HITTING');
  const [chartType, setChartType] = useState('LINE');
  const [scope, setScope] = useState<'PRIVATE' | 'GLOBAL'>('PRIVATE');
  const [dateMode, setDateMode] = useState<'ALL_TIME' | 'RANGE' | 'LAST_N_DAYS'>('ALL_TIME');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [lastNDays, setLastNDays] = useState('30');
  const [selected, setSelected] = useState<ChartDataSource[]>([]);
  // Profile scope (which athletes see this chart)
  const [playerScope, setPlayerScope] = useState<'ALL' | 'INDIVIDUAL'>('ALL');
  const [scopePlayerIds, setScopePlayerIds] = useState<string[]>([]);
  // Data source mode
  const [dataMode, setDataMode] = useState<'DATE_RANGE' | 'REPORTS'>('DATE_RANGE');
  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([]);
  const [playerReports, setPlayerReports] = useState<Array<{ id: string; title: string | null; reportType: string; createdAt: string }>>([]);
  // Advanced chart-type specific state
  const [rollingWindow, setRollingWindow] = useState('5');
  const [rollingMode, setRollingMode] = useState<'SMA' | 'EMA'>('SMA');
  const [targetMin, setTargetMin] = useState('');
  const [targetMax, setTargetMax] = useState('');
  const [pbDirection, setPbDirection] = useState<'MAX' | 'MIN'>('MAX');
  const [zoneGrid, setZoneGrid] = useState<'3x3' | '5x5'>('3x3');
  const [zoneMetric, setZoneMetric] = useState<'COUNT' | 'AVG' | 'WHIFF'>('COUNT');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  // Preview state
  const [preview, setPreview] = useState<ChartEvaluation | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [cols, plyrs] = await Promise.all([api.getAnalyticsColumns(), api.getPlayers()]);
        setColumns(cols);
        setPlayers(plyrs);
        if (plyrs.length > 0 && !previewPlayerId) setPreviewPlayerId(plyrs[0].id);
      } catch (e: any) {
        setError(e.message || 'Failed to load analytics data');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load reports for the preview player whenever dataMode = REPORTS
  useEffect(() => {
    if (dataMode !== 'REPORTS' || !previewPlayerId) {
      setPlayerReports([]);
      return;
    }
    let cancelled = false;
    api.getPlayerReports(previewPlayerId).then((rows: any[]) => {
      if (cancelled) return;
      setPlayerReports(
        (rows || []).map((r) => ({
          id: r.id,
          title: r.title ?? null,
          reportType: r.reportType,
          createdAt: r.createdAt,
        })),
      );
    }).catch(() => { if (!cancelled) setPlayerReports([]); });
    return () => { cancelled = true; };
  }, [dataMode, previewPlayerId]);

  const grouped = useMemo(() => {
    const g: Record<string, AnalyticsColumn[]> = {};
    columns.forEach((c) => {
      if (!g[c.source]) g[c.source] = [];
      g[c.source].push(c);
    });
    return g;
  }, [columns]);

  const payload = useMemo<ChartConfigInput>(() => ({
    title: title.trim() || 'Untitled chart',
    section,
    chartType,
    scope,
    dataSources: selected,
    dateMode,
    dateFrom: dataMode === 'DATE_RANGE' && dateMode === 'RANGE' ? (dateFrom || null) : null,
    dateTo: dataMode === 'DATE_RANGE' && dateMode === 'RANGE' ? (dateTo || null) : null,
    lastNDays: dataMode === 'DATE_RANGE' && dateMode === 'LAST_N_DAYS' ? (parseInt(lastNDays, 10) || 30) : null,
    playerScope,
    playerIds: playerScope === 'INDIVIDUAL' ? scopePlayerIds : null,
    dataMode,
    reportIds: dataMode === 'REPORTS' ? selectedReportIds : null,
    rollingWindow: chartType === 'ROLLING_AVG' ? parseInt(rollingWindow, 10) || 5 : null,
    rollingMode: chartType === 'ROLLING_AVG' ? rollingMode : null,
    targetMin: chartType === 'TARGET_BAND' && targetMin !== '' ? Number(targetMin) : null,
    targetMax: chartType === 'TARGET_BAND' && targetMax !== '' ? Number(targetMax) : null,
    pbDirection: chartType === 'PERSONAL_BEST' ? pbDirection : null,
    zoneGrid: chartType === 'STRIKE_ZONE_HEAT' ? zoneGrid : null,
    zoneMetric: chartType === 'STRIKE_ZONE_HEAT' ? zoneMetric : null,
  }), [
    title, section, chartType, scope, selected, dateMode, dateFrom, dateTo, lastNDays,
    playerScope, scopePlayerIds, dataMode, selectedReportIds,
    rollingWindow, rollingMode, targetMin, targetMax, pbDirection, zoneGrid, zoneMetric,
  ]);

  // Debounced live preview — refetch whenever config or player changes
  useEffect(() => {
    if (!previewPlayerId || selected.length === 0) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    const t = setTimeout(async () => {
      try {
        const result = await api.previewChartConfig(previewPlayerId, payload);
        if (!cancelled) setPreview(result);
      } catch {
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [payload, previewPlayerId, selected.length]);

  const toggleColumn = (col: AnalyticsColumn) => {
    const key = `${col.source}::${col.metricType}`;
    const exists = selected.find((s) => `${s.source}::${s.metricType}` === key);
    if (exists) {
      setSelected(selected.filter((s) => `${s.source}::${s.metricType}` !== key));
    } else {
      setSelected([...selected, { source: col.source, metricType: col.metricType, label: col.metricType }]);
    }
  };

  const isSelected = (col: AnalyticsColumn) =>
    selected.some((s) => s.source === col.source && s.metricType === col.metricType);

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setSection('HITTING');
    setChartType('LINE');
    setScope('PRIVATE');
    setDateMode('ALL_TIME');
    setDateFrom('');
    setDateTo('');
    setLastNDays('30');
    setSelected([]);
    setPlayerScope('ALL');
    setScopePlayerIds([]);
    setDataMode('DATE_RANGE');
    setSelectedReportIds([]);
    setRollingWindow('5');
    setRollingMode('SMA');
    setTargetMin('');
    setTargetMax('');
    setPbDirection('MAX');
    setZoneGrid('3x3');
    setZoneMetric('COUNT');
    setError('');
  };

  const loadConfig = (cfg: ChartConfig) => {
    setEditingId(cfg.id);
    setTitle(cfg.title);
    setSection(cfg.section);
    setChartType(cfg.chartType);
    setScope(cfg.scope);
    setDateMode(cfg.dateMode);
    setDateFrom(cfg.dateFrom || '');
    setDateTo(cfg.dateTo || '');
    setLastNDays(cfg.lastNDays?.toString() || '30');
    try { setSelected(JSON.parse(cfg.dataSources)); } catch { setSelected([]); }
    const ps = cfg.playerScope === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'ALL';
    setPlayerScope(ps);
    try { setScopePlayerIds(cfg.playerIds ? JSON.parse(cfg.playerIds) : []); } catch { setScopePlayerIds([]); }
    setDataMode((cfg.dataMode as 'DATE_RANGE' | 'REPORTS') || 'DATE_RANGE');
    try { setSelectedReportIds(cfg.reportIds ? JSON.parse(cfg.reportIds) : []); } catch { setSelectedReportIds([]); }
    setRollingWindow(cfg.rollingWindow?.toString() || '5');
    setRollingMode((cfg.rollingMode as 'SMA' | 'EMA') || 'SMA');
    setTargetMin(cfg.targetMin != null ? String(cfg.targetMin) : '');
    setTargetMax(cfg.targetMax != null ? String(cfg.targetMax) : '');
    setPbDirection((cfg.pbDirection as 'MAX' | 'MIN') || 'MAX');
    setZoneGrid((cfg.zoneGrid as '3x3' | '5x5') || '3x3');
    setZoneMetric((cfg.zoneMetric as 'COUNT' | 'AVG' | 'WHIFF') || 'COUNT');
    setError('');
  };

  const save = async () => {
    if (!title.trim()) { setError('Title is required'); return; }
    if (selected.length === 0) { setError('Pick at least one data column'); return; }
    setSaving(true);
    setError('');
    try {
      const body: ChartConfigInput = { ...payload, title: title.trim() };
      if (editingId) {
        await api.updateChartConfig(editingId, body);
        setFeedback('Updated.');
      } else {
        await api.createChartConfig(body);
        setFeedback('Saved. Visit the relevant profile tab to see it in place.');
      }
      setTimeout(() => setFeedback(''), 3000);
      resetForm();
    } catch (e: any) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.builderGrid}>
      {/* ── Left: Form ── */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h3 className={styles.cardTitle}>{editingId ? 'Edit Chart' : 'New Chart'}</h3>
            <p className={styles.cardDesc}>
              {editingId ? 'Update this saved chart.' : 'Design a chart and preview it live on the right.'}
            </p>
          </div>
          {editingId && (
            <button className={styles.btnSecondary} onClick={resetForm}>Start Fresh</button>
          )}
        </div>

        <div className={styles.builderForm}>
          <div className={styles.builderField}>
            <label>Title</label>
            <input className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Exit Velo Trend" />
          </div>

          <div className={styles.builderField}>
            <label>Profile Section</label>
            <select className={styles.select} value={section} onChange={(e) => setSection(e.target.value)}>
              {SECTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          <div className={styles.builderField}>
            <label>Chart Type</label>
            <select className={styles.select} value={chartType} onChange={(e) => setChartType(e.target.value)}>
              {CHART_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div className={styles.builderField}>
            <label>Visibility</label>
            <select className={styles.select} value={scope} onChange={(e) => setScope(e.target.value as any)}>
              <option value="PRIVATE">Private (just me)</option>
              <option value="GLOBAL">Global (all coaches)</option>
            </select>
          </div>

          {/* ── Appears on (profile scope) ── */}
          <div className={styles.builderField}>
            <label>Appears on</label>
            <select
              className={styles.select}
              value={playerScope}
              onChange={(e) => setPlayerScope(e.target.value as 'ALL' | 'INDIVIDUAL')}
            >
              <option value="ALL">All athletes</option>
              <option value="INDIVIDUAL">Individual athletes…</option>
            </select>
          </div>

          {playerScope === 'INDIVIDUAL' && (
            <div className={`${styles.builderField} ${styles.columnPicker}`}>
              <label>Select athletes ({scopePlayerIds.length} selected)</label>
              {scopePlayerIds.length > 0 && (
                <div className={styles.selectedPills}>
                  {scopePlayerIds.map((id) => {
                    const p = players.find((pl) => pl.id === id);
                    const name = p ? `${p.firstName} ${p.lastName}` : id;
                    return (
                      <span key={id} className={styles.selectedPill}>
                        {name}
                        <button onClick={() => setScopePlayerIds(scopePlayerIds.filter((x) => x !== id))}>×</button>
                      </span>
                    );
                  })}
                </div>
              )}
              <DropdownPanel
                label={
                  scopePlayerIds.length === 0
                    ? 'Choose athletes…'
                    : `${scopePlayerIds.length} athlete${scopePlayerIds.length === 1 ? '' : 's'} selected`
                }
                placeholder={scopePlayerIds.length === 0}
              >
                <div className={styles.columnList} style={{ maxHeight: 260, border: 'none', padding: 0, background: 'transparent' }}>
                  {players.length === 0 ? (
                    <div className={styles.empty}>No athletes available.</div>
                  ) : (
                    players.map((p) => {
                      const checked = scopePlayerIds.includes(p.id);
                      return (
                        <label key={p.id} className={styles.columnItem}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setScopePlayerIds(
                                checked
                                  ? scopePlayerIds.filter((x) => x !== p.id)
                                  : [...scopePlayerIds, p.id],
                              );
                            }}
                          />
                          <span>{p.firstName} {p.lastName}</span>
                          {p.positions && <span className={styles.columnUnit}>({p.positions})</span>}
                        </label>
                      );
                    })
                  )}
                </div>
              </DropdownPanel>
            </div>
          )}

          {/* ── Data source mode ── */}
          <div className={styles.builderField}>
            <label>Data source</label>
            <select
              className={styles.select}
              value={dataMode}
              onChange={(e) => setDataMode(e.target.value as 'DATE_RANGE' | 'REPORTS')}
            >
              <option value="DATE_RANGE">Date range</option>
              <option value="REPORTS">Reports…</option>
            </select>
          </div>

          {dataMode === 'DATE_RANGE' && (
            <>
              <div className={styles.builderField}>
                <label>Preset</label>
                <select className={styles.select} value={dateMode} onChange={(e) => setDateMode(e.target.value as any)}>
                  <option value="ALL_TIME">All time</option>
                  <option value="LAST_N_DAYS">Last N days</option>
                  <option value="RANGE">Specific range (calendar)</option>
                </select>
              </div>

              {dateMode === 'LAST_N_DAYS' && (
                <div className={styles.builderField}>
                  <label>Number of days</label>
                  <input className={styles.input} type="number" min="1" value={lastNDays} onChange={(e) => setLastNDays(e.target.value)} />
                </div>
              )}

              {dateMode === 'RANGE' && (
                <div className={styles.builderField}>
                  <label>Date range</label>
                  <DateRangePopover
                    from={dateFrom}
                    to={dateTo}
                    onChange={(f, t) => { setDateFrom(f); setDateTo(t); }}
                  />
                </div>
              )}
            </>
          )}

          {dataMode === 'REPORTS' && (
            <div className={`${styles.builderField} ${styles.columnPicker}`}>
              <label>
                Reports for preview athlete ({selectedReportIds.length} selected)
              </label>
              <div className={styles.cardDesc} style={{ marginBottom: 6 }}>
                Reports are listed for the athlete you&apos;re previewing against. When this chart is
                rendered on another athlete&apos;s profile, only their reports whose IDs are in this
                list will be included.
              </div>
              {selectedReportIds.length > 0 && (
                <div className={styles.selectedPills}>
                  {selectedReportIds.map((id) => {
                    const r = playerReports.find((rr) => rr.id === id);
                    const label = r ? (r.title || `${r.reportType} · ${new Date(r.createdAt).toLocaleDateString()}`) : id.slice(0, 8);
                    return (
                      <span key={id} className={styles.selectedPill}>
                        {label}
                        <button onClick={() => setSelectedReportIds(selectedReportIds.filter((x) => x !== id))}>×</button>
                      </span>
                    );
                  })}
                </div>
              )}
              <div className={styles.columnList}>
                {playerReports.length === 0 ? (
                  <div className={styles.empty}>
                    {previewPlayerId
                      ? 'This athlete has no reports yet.'
                      : 'Pick a preview athlete to load their reports.'}
                  </div>
                ) : (
                  playerReports.map((r) => {
                    const checked = selectedReportIds.includes(r.id);
                    return (
                      <label key={r.id} className={styles.columnItem}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setSelectedReportIds(
                              checked
                                ? selectedReportIds.filter((x) => x !== r.id)
                                : [...selectedReportIds, r.id],
                            );
                          }}
                        />
                        <span>{r.title || r.reportType}</span>
                        <span className={styles.columnUnit}>
                          ({r.reportType} · {new Date(r.createdAt).toLocaleDateString()})
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* ── Chart-type specific options ── */}
          {chartType === 'ROLLING_AVG' && (
            <>
              <div className={styles.builderField}>
                <label>Window (points)</label>
                <input
                  className={styles.input}
                  type="number"
                  min="2"
                  value={rollingWindow}
                  onChange={(e) => setRollingWindow(e.target.value)}
                />
              </div>
              <div className={styles.builderField}>
                <label>Mode</label>
                <select
                  className={styles.select}
                  value={rollingMode}
                  onChange={(e) => setRollingMode(e.target.value as 'SMA' | 'EMA')}
                >
                  <option value="SMA">Simple Moving Avg (SMA)</option>
                  <option value="EMA">Exponential Moving Avg (EMA)</option>
                </select>
              </div>
            </>
          )}

          {chartType === 'TARGET_BAND' && (
            <>
              <div className={styles.builderField}>
                <label>Target minimum</label>
                <input
                  className={styles.input}
                  type="number"
                  step="any"
                  value={targetMin}
                  placeholder="e.g. 88"
                  onChange={(e) => setTargetMin(e.target.value)}
                />
              </div>
              <div className={styles.builderField}>
                <label>Target maximum</label>
                <input
                  className={styles.input}
                  type="number"
                  step="any"
                  value={targetMax}
                  placeholder="e.g. 95"
                  onChange={(e) => setTargetMax(e.target.value)}
                />
              </div>
            </>
          )}

          {chartType === 'PERSONAL_BEST' && (
            <div className={styles.builderField}>
              <label>PB direction</label>
              <select
                className={styles.select}
                value={pbDirection}
                onChange={(e) => setPbDirection(e.target.value as 'MAX' | 'MIN')}
              >
                <option value="MAX">Higher is better (exit velo, FB velo…)</option>
                <option value="MIN">Lower is better (pop time, 60-yd…)</option>
              </select>
            </div>
          )}

          {chartType === 'STRIKE_ZONE_HEAT' && (
            <>
              <div className={styles.builderField}>
                <label>Grid</label>
                <select
                  className={styles.select}
                  value={zoneGrid}
                  onChange={(e) => setZoneGrid(e.target.value as '3x3' | '5x5')}
                >
                  <option value="3x3">3 × 3 (classic zones)</option>
                  <option value="5x5">5 × 5 (fine grained)</option>
                </select>
              </div>
              <div className={styles.builderField}>
                <label>Cell metric</label>
                <select
                  className={styles.select}
                  value={zoneMetric}
                  onChange={(e) => setZoneMetric(e.target.value as 'COUNT' | 'AVG' | 'WHIFF')}
                >
                  <option value="COUNT">Count of pitches</option>
                  <option value="AVG">Average value in zone</option>
                  <option value="WHIFF">Whiff / miss rate</option>
                </select>
              </div>
            </>
          )}

          {chartType === 'MOVEMENT_PLOT' && (
            <div className={styles.builderField} style={{ gridColumn: '1 / -1' }}>
              <label>Plot axes</label>
              <div className={styles.cardDesc} style={{ marginTop: 4 }}>
                Pick exactly two columns below. <strong>First column = X axis</strong> (e.g. horizontal
                break) and <strong>second column = Y axis</strong> (e.g. induced vertical break). One
                point per recording date.
              </div>
            </div>
          )}

          {TWO_AXIS_TYPES.has(chartType) && selected.length > 0 && selected.length < 2 && (
            <div
              className={`${styles.feedback} ${styles.feedbackErr}`}
              style={{ gridColumn: '1 / -1' }}
            >
              This chart type needs two columns (X and Y).
            </div>
          )}

          <div className={`${styles.builderField} ${styles.columnPicker}`}>
            <label>Data Columns ({selected.length} selected)</label>
            {selected.length > 0 && (
              <div className={styles.selectedPills}>
                {selected.map((s) => (
                  <span key={`${s.source}::${s.metricType}`} className={styles.selectedPill}>
                    {s.source} · {s.metricType}
                    <button
                      onClick={() =>
                        setSelected(selected.filter((x) => !(x.source === s.source && x.metricType === s.metricType)))
                      }
                    >×</button>
                  </span>
                ))}
              </div>
            )}
            <DropdownPanel
              label={
                selected.length === 0
                  ? 'Choose data columns…'
                  : `${selected.length} column${selected.length === 1 ? '' : 's'} selected`
              }
              placeholder={selected.length === 0}
            >
              <div className={styles.columnList} style={{ maxHeight: 320, border: 'none', padding: 0, background: 'transparent' }}>
                {Object.keys(grouped).length === 0 ? (
                  <div className={styles.empty}>
                    No columns yet. Upload CSVs from the Upload page to populate data sources.
                  </div>
                ) : (
                  Object.entries(grouped).map(([src, cols]) => (
                    <div key={src} className={styles.columnGroup}>
                      <div className={styles.columnGroupLabel}>{src}</div>
                      {cols.map((c) => (
                        <label key={c.metricType} className={styles.columnItem}>
                          <input type="checkbox" checked={isSelected(c)} onChange={() => toggleColumn(c)} />
                          <span>{c.metricType}</span>
                          <span className={styles.columnUnit}>({c.unit})</span>
                        </label>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </DropdownPanel>
          </div>

          {error && <div className={`${styles.feedback} ${styles.feedbackErr}`} style={{ gridColumn: '1 / -1' }}>{error}</div>}
          {feedback && !error && <div className={`${styles.feedback} ${styles.feedbackOk}`} style={{ gridColumn: '1 / -1' }}>{feedback}</div>}

          <div className={styles.formActions}>
            {editingId && <button className={styles.btnSecondary} onClick={resetForm} disabled={saving}>Cancel</button>}
            <button className={styles.btn} onClick={save} disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Update' : 'Save Chart'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Right: Preview ── */}
      <div className={styles.previewCol}>
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h3 className={styles.cardTitle}>Live Preview</h3>
              <p className={styles.cardDesc}>
                Choose an athlete to see how this chart would look on their profile.
              </p>
            </div>
          </div>

          <div className={styles.previewPlayer}>
            <label>Preview against athlete</label>
            <select
              className={styles.select}
              value={previewPlayerId}
              onChange={(e) => setPreviewPlayerId(e.target.value)}
            >
              {players.length === 0 && <option value="">No athletes available</option>}
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.firstName} {p.lastName}{p.positions ? ` · ${p.positions}` : ''}
                </option>
              ))}
            </select>
          </div>

          <PreviewCard
            title={title.trim() || 'Untitled chart'}
            chartType={chartType}
            evaluation={preview}
            loading={previewLoading}
            selectedCount={selected.length}
            options={{
              rollingWindow: parseInt(rollingWindow, 10) || 5,
              rollingMode,
              targetMin: targetMin !== '' ? Number(targetMin) : null,
              targetMax: targetMax !== '' ? Number(targetMax) : null,
              pbDirection,
              zoneGrid,
              zoneMetric,
            }}
          />

          <LoadExistingConfigList
            userId={userId}
            activeSection={section}
            onLoad={loadConfig}
            editingId={editingId}
          />
        </div>

        <div className={styles.alwaysOn}>
          <p className={styles.alwaysOnTitle}>Always-on charts</p>
          <p className={styles.alwaysOnList}>
            These render automatically on the relevant tabs, regardless of custom configs:{' '}
            {ALWAYS_ON.join(' · ')}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── Preview card ──────────────────────────────────────── */

interface ChartOptions {
  rollingWindow: number;
  rollingMode: 'SMA' | 'EMA';
  targetMin: number | null;
  targetMax: number | null;
  pbDirection: 'MAX' | 'MIN';
  zoneGrid: '3x3' | '5x5';
  zoneMetric: 'COUNT' | 'AVG' | 'WHIFF';
}

function PreviewCard({
  title, chartType, evaluation, loading, selectedCount, options,
}: {
  title: string;
  chartType: string;
  evaluation: ChartEvaluation | null;
  loading: boolean;
  selectedCount: number;
  options: ChartOptions;
}) {
  const series = evaluation?.series || [];
  const hasData = series.some((s) => s.points.length > 0);
  const needsTwoAxis = TWO_AXIS_TYPES.has(chartType);
  const enoughColumns = needsTwoAxis ? series.length >= 2 : series.length >= 1;

  return (
    <div className={styles.previewCard}>
      <div className={styles.previewHeader}>
        <div className={styles.previewTitle}>{title}</div>
        <span className={styles.previewTypeTag}>{chartType}</span>
      </div>
      {loading ? (
        <div className={styles.previewEmpty}>Loading preview…</div>
      ) : selectedCount === 0 ? (
        <div className={styles.previewEmpty}>Pick at least one data column to preview.</div>
      ) : needsTwoAxis && !enoughColumns ? (
        <div className={styles.previewEmpty}>
          {chartType === 'MOVEMENT_PLOT' ? 'Movement Plot' : chartType}
          {' needs two data columns (X and Y).'}
        </div>
      ) : !hasData ? (
        <div className={styles.previewEmpty}>
          No data points for this athlete in the selected range.<br />
          Try a different athlete or widen the date range.
        </div>
      ) : chartType === 'STAT_BUBBLE' ? (
        <StatBubbleView series={series} />
      ) : chartType === 'PERCENT_INCREASE' ? (
        <PercentIncreaseView series={series} />
      ) : chartType === 'BAR' ? (
        <BarView series={series} />
      ) : chartType === 'MOVEMENT_PLOT' ? (
        <MovementPlotView series={series} />
      ) : chartType === 'ROLLING_AVG' ? (
        <RollingAvgView series={series} window={options.rollingWindow} mode={options.rollingMode} />
      ) : chartType === 'TRENDLINE' ? (
        <TrendlineView series={series} />
      ) : chartType === 'TARGET_BAND' ? (
        <TargetBandView series={series} targetMin={options.targetMin} targetMax={options.targetMax} />
      ) : chartType === 'PERSONAL_BEST' ? (
        <PersonalBestView series={series} direction={options.pbDirection} />
      ) : chartType === 'STRIKE_ZONE_HEAT' ? (
        <StrikeZoneHeatView series={series} grid={options.zoneGrid} metric={options.zoneMetric} />
      ) : (
        <LineView series={series} />
      )}
    </div>
  );
}

/* ─── Existing configs list inside builder ──────────────── */

function LoadExistingConfigList({
  activeSection, onLoad, editingId,
}: {
  userId: string;
  activeSection: string;
  onLoad: (cfg: ChartConfig) => void;
  editingId: string | null;
}) {
  const [configs, setConfigs] = useState<ChartConfig[]>([]);

  useEffect(() => {
    api.getChartConfigs(activeSection).then(setConfigs).catch(() => setConfigs([]));
  }, [activeSection, editingId]);

  if (configs.length === 0) return null;

  return (
    <div className={styles.existingWrap}>
      <div className={styles.existingHeader}>
        Existing in <strong>{activeSection}</strong>
      </div>
      <div className={styles.existingList}>
        {configs.map((c) => (
          <button
            key={c.id}
            className={`${styles.existingItem} ${editingId === c.id ? styles.existingItemActive : ''}`}
            onClick={() => onLoad(c)}
          >
            <span className={styles.existingTitle}>{c.title}</span>
            <span className={styles.existingMeta}>{c.chartType} · {c.scope}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Running Avg pane (placeholder) ─────────────────────── */

function RunningAvgPane() {
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <h3 className={styles.cardTitle}>Running Average</h3>
          <p className={styles.cardDesc}>
            Display running-average line graphs for the metrics we track most closely — exit velocity,
            bat speed, sprint times, and more. Pick an athlete, a metric, and a window; the chart
            smooths out day-to-day noise so long-term trends stand out.
          </p>
        </div>
      </div>
      <div className={styles.empty} style={{ padding: 48, textAlign: 'center' }}>
        Configuration UI coming soon — metric list will be defined once we finalize which columns
        feed this view.
      </div>
    </div>
  );
}

/* ─── Compare pane (placeholder) ─────────────────────────── */

function ComparePane() {
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <h3 className={styles.cardTitle}>Compare</h3>
          <p className={styles.cardDesc}>
            Side-by-side comparisons between athletes, date ranges, and metrics. Use this view to
            spot themes — who's ahead of schedule, which drills correlate with improvement, and how
            cohorts stack up against each other.
          </p>
        </div>
      </div>
      <div className={styles.empty} style={{ padding: 48, textAlign: 'center' }}>
        Configuration UI coming soon — we'll let you pin 2+ athletes, 2+ windows, or 2+ metrics and
        render them on a shared axis.
      </div>
    </div>
  );
}

/* ─── Metric Builder pane ────────────────────────────────── */

type MetricAgg =
  | 'MEAN'
  | 'MEDIAN'
  | 'SUM'
  | 'MIN'
  | 'MAX'
  | 'COUNT'
  | 'STDEV'
  | 'LATEST'
  | 'FIRST';

const METRIC_AGGS: { value: MetricAgg; label: string }[] = [
  { value: 'MEAN',   label: 'Mean (average)' },
  { value: 'MEDIAN', label: 'Median' },
  { value: 'SUM',    label: 'Sum' },
  { value: 'MIN',    label: 'Min' },
  { value: 'MAX',    label: 'Max' },
  { value: 'COUNT',  label: 'Count' },
  { value: 'STDEV',  label: 'Standard deviation' },
  { value: 'LATEST', label: 'Most recent value' },
  { value: 'FIRST',  label: 'Earliest value' },
];

type MetricVariable = {
  name: string;          // e.g. "BB"
  source: string | null; // analytics column source
  metricType: string;    // analytics column metricType
  aggregation: MetricAgg;
};

type SecondaryConfig = {
  label: string;           // rendered under the small number, e.g. "vs last 30d"
  source: string | null;
  metricType: string;
  aggregation: MetricAgg;
  unit: string;
  precision: number;
};

type ColorOp = '>' | '<' | '=' | '>=' | '<=';

type ColorRule = {
  op: ColorOp;
  threshold: string;       // kept as string so partial input works; parsed at eval
  color: string;           // CSS color (hex or named)
};

const COLOR_SWATCHES: { value: string; label: string }[] = [
  { value: '#22C55E', label: 'Green' },
  { value: '#3B82F6', label: 'Blue' },
  { value: '#EAB308', label: 'Yellow' },
  { value: '#F97316', label: 'Orange' },
  { value: '#EF4444', label: 'Red' },
  { value: '#A78BFA', label: 'Purple' },
  { value: '#9CA3AF', label: 'Gray' },
];

type SavedMetric = {
  id: string;
  title: string;
  mode: MetricBuilderMode;
  scope: 'PRIVATE' | 'GLOBAL';
  // Basic
  basicSource: string | null;
  basicMetricType: string;
  basicAggregation: MetricAgg;
  // Advanced
  variables: MetricVariable[];
  formula: string;
  // Shared
  dateMode: 'ALL_TIME' | 'LAST_N_DAYS' | 'RANGE';
  dateFrom: string;
  dateTo: string;
  lastNDays: string;
  unit: string;
  precision: number;
  playerScope: 'ALL' | 'INDIVIDUAL';
  scopePlayerIds: string[];
  // Optional secondary display + conditional coloring
  secondaryEnabled: boolean;
  secondary: SecondaryConfig;
  colorRules: ColorRule[];
};

function MetricBuilderPane() {
  const [columns, setColumns] = useState<AnalyticsColumn[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [previewPlayerId, setPreviewPlayerId] = useState<string>('');

  // Form state
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<MetricBuilderMode>('basic');
  const [scope, setScope] = useState<'PRIVATE' | 'GLOBAL'>('PRIVATE');

  // Basic mode
  const [basicSource, setBasicSource] = useState<string | null>(null);
  const [basicMetricType, setBasicMetricType] = useState('');
  const [basicAggregation, setBasicAggregation] = useState<MetricAgg>('MEAN');

  // Advanced mode
  const [variables, setVariables] = useState<MetricVariable[]>([
    { name: 'x', source: null, metricType: '', aggregation: 'MEAN' },
  ]);
  const [formula, setFormula] = useState('');

  // Shared window / formatting
  const [dateMode, setDateMode] = useState<'ALL_TIME' | 'LAST_N_DAYS' | 'RANGE'>('ALL_TIME');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [lastNDays, setLastNDays] = useState('30');
  const [unit, setUnit] = useState('');
  const [precision, setPrecision] = useState(2);

  // Profile scope
  const [playerScope, setPlayerScope] = useState<'ALL' | 'INDIVIDUAL'>('ALL');
  const [scopePlayerIds, setScopePlayerIds] = useState<string[]>([]);

  // Secondary-display (small number beneath the primary)
  const [secondaryEnabled, setSecondaryEnabled] = useState(false);
  const [secondary, setSecondary] = useState<SecondaryConfig>({
    label: '',
    source: null,
    metricType: '',
    aggregation: 'MEAN',
    unit: '',
    precision: 1,
  });

  // Conditional color rules (first match wins; no match → neutral)
  const [colorRules, setColorRules] = useState<ColorRule[]>([]);

  // Save list (local-state until the metrics API is wired)
  const [saved, setSaved] = useState<SavedMetric[]>([]);
  const [feedback, setFeedback] = useState('');

  // Preview
  const [previewValue, setPreviewValue] = useState<number | null>(null);
  const [previewNote, setPreviewNote] = useState<string>('Pick an athlete and build your metric to see a live value.');

  useEffect(() => {
    (async () => {
      try {
        const [cols, plyrs] = await Promise.all([api.getAnalyticsColumns(), api.getPlayers()]);
        setColumns(cols);
        setPlayers(plyrs);
        if (plyrs.length > 0 && !previewPlayerId) setPreviewPlayerId(plyrs[0].id);
      } catch {
        /* swallow — UI still usable without live columns */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groupedColumns = useMemo(() => {
    const g: Record<string, AnalyticsColumn[]> = {};
    columns.forEach((c) => {
      if (!g[c.source]) g[c.source] = [];
      g[c.source].push(c);
    });
    return g;
  }, [columns]);

  // Stubbed preview — the live-eval backend for metrics isn't wired yet,
  // so we surface a readable placeholder. When the endpoint lands, swap
  // this out for an api.previewMetric call just like Chart Builder does.
  useEffect(() => {
    if (!previewPlayerId) {
      setPreviewValue(null);
      setPreviewNote('Pick an athlete to evaluate against.');
      return;
    }
    if (mode === 'basic') {
      if (!basicSource || !basicMetricType) {
        setPreviewValue(null);
        setPreviewNote('Choose a column and aggregation to preview.');
        return;
      }
    } else {
      const haveVars = variables.every((v) => v.name && v.source && v.metricType);
      if (variables.length === 0 || !haveVars || !formula.trim()) {
        setPreviewValue(null);
        setPreviewNote('Define your variables and formula to preview.');
        return;
      }
    }
    setPreviewValue(null);
    setPreviewNote('Live evaluation pending — metric-eval API is not yet wired. Config will save correctly.');
  }, [
    previewPlayerId, mode, basicSource, basicMetricType, basicAggregation,
    variables, formula, dateMode, dateFrom, dateTo, lastNDays,
  ]);

  const addVariable = () => {
    const nextName = String.fromCharCode(
      'a'.charCodeAt(0) + Math.min(variables.length, 25),
    );
    setVariables([...variables, { name: nextName, source: null, metricType: '', aggregation: 'MEAN' }]);
  };

  const updateVariable = (idx: number, patch: Partial<MetricVariable>) => {
    setVariables(variables.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  };

  const removeVariable = (idx: number) => {
    setVariables(variables.filter((_, i) => i !== idx));
  };

  const addColorRule = () => {
    setColorRules([...colorRules, { op: '>', threshold: '', color: '#22C55E' }]);
  };

  const updateColorRule = (idx: number, patch: Partial<ColorRule>) => {
    setColorRules(colorRules.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const removeColorRule = (idx: number) => {
    setColorRules(colorRules.filter((_, i) => i !== idx));
  };

  // Evaluate the color rules in order; first match wins. Null value or
  // empty rule list → undefined (falls back to the stylesheet default).
  const resolvedPreviewColor = useMemo<string | undefined>(() => {
    if (previewValue == null) return undefined;
    for (const r of colorRules) {
      if (r.threshold.trim() === '') continue;
      const thr = Number(r.threshold);
      if (Number.isNaN(thr)) continue;
      const v = previewValue;
      const hit =
        (r.op === '>'  && v >  thr) ||
        (r.op === '<'  && v <  thr) ||
        (r.op === '='  && v === thr) ||
        (r.op === '>=' && v >= thr) ||
        (r.op === '<=' && v <= thr);
      if (hit) return r.color;
    }
    return undefined;
  }, [previewValue, colorRules]);

  const applyWobaTemplate = () => {
    setMode('advanced');
    setTitle('Internal wOBA');
    setVariables([
      { name: 'BB',  source: null, metricType: '', aggregation: 'COUNT' },
      { name: 'HBP', source: null, metricType: '', aggregation: 'COUNT' },
      { name: 'B1',  source: null, metricType: '', aggregation: 'COUNT' },
      { name: 'B2',  source: null, metricType: '', aggregation: 'COUNT' },
      { name: 'B3',  source: null, metricType: '', aggregation: 'COUNT' },
      { name: 'HR',  source: null, metricType: '', aggregation: 'COUNT' },
      { name: 'AB',  source: null, metricType: '', aggregation: 'COUNT' },
      { name: 'SF',  source: null, metricType: '', aggregation: 'COUNT' },
      { name: 'IBB', source: null, metricType: '', aggregation: 'COUNT' },
    ]);
    setFormula(
      '(0.69*BB + 0.72*HBP + 0.89*B1 + 1.27*B2 + 1.62*B3 + 2.10*HR) / (AB + BB - IBB + SF + HBP)',
    );
    setPrecision(3);
    setUnit('');
  };

  const resetForm = () => {
    setTitle('');
    setMode('basic');
    setScope('PRIVATE');
    setBasicSource(null);
    setBasicMetricType('');
    setBasicAggregation('MEAN');
    setVariables([{ name: 'x', source: null, metricType: '', aggregation: 'MEAN' }]);
    setFormula('');
    setDateMode('ALL_TIME');
    setDateFrom('');
    setDateTo('');
    setLastNDays('30');
    setUnit('');
    setPrecision(2);
    setPlayerScope('ALL');
    setScopePlayerIds([]);
    setSecondaryEnabled(false);
    setSecondary({
      label: '',
      source: null,
      metricType: '',
      aggregation: 'MEAN',
      unit: '',
      precision: 1,
    });
    setColorRules([]);
    setFeedback('');
  };

  const handleSave = () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setFeedback('Name your metric before saving.');
      return;
    }
    if (mode === 'basic' && (!basicSource || !basicMetricType)) {
      setFeedback('Pick a column for the basic metric.');
      return;
    }
    if (mode === 'advanced' && (!formula.trim() || variables.length === 0)) {
      setFeedback('Advanced metrics need at least one variable and a formula.');
      return;
    }
    const entry: SavedMetric = {
      id: `local-${Date.now()}`,
      title: trimmed,
      mode,
      scope,
      basicSource,
      basicMetricType,
      basicAggregation,
      variables,
      formula,
      dateMode,
      dateFrom,
      dateTo,
      lastNDays,
      unit,
      precision,
      playerScope,
      scopePlayerIds,
      secondaryEnabled,
      secondary,
      colorRules,
    };
    setSaved([entry, ...saved]);
    setFeedback(`Saved "${trimmed}". Backend persistence pipeline will pick this up when the metrics API lands.`);
  };

  const deleteSaved = (id: string) => {
    setSaved(saved.filter((m) => m.id !== id));
  };

  const loadSaved = (m: SavedMetric) => {
    setTitle(m.title);
    setMode(m.mode);
    setScope(m.scope);
    setBasicSource(m.basicSource);
    setBasicMetricType(m.basicMetricType);
    setBasicAggregation(m.basicAggregation);
    setVariables(m.variables.length > 0 ? m.variables : [{ name: 'x', source: null, metricType: '', aggregation: 'MEAN' }]);
    setFormula(m.formula);
    setDateMode(m.dateMode);
    setDateFrom(m.dateFrom);
    setDateTo(m.dateTo);
    setLastNDays(m.lastNDays);
    setUnit(m.unit);
    setPrecision(m.precision);
    setPlayerScope(m.playerScope);
    setScopePlayerIds(m.scopePlayerIds);
    setSecondaryEnabled(m.secondaryEnabled);
    setSecondary(m.secondary);
    setColorRules(m.colorRules);
    setFeedback(`Loaded "${m.title}" into the editor.`);
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <h3 className={styles.cardTitle}>Metric Builder</h3>
          <p className={styles.cardDesc}>
            Build single-number stats that pin to any athlete's profile — rolling averages,
            percentiles, custom weighted formulas. Switch to Advanced to define variables
            and combine them into expressions like our internal wOBA.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.btnSecondary} onClick={applyWobaTemplate}>
            Load wOBA template
          </button>
          <button type="button" className={styles.btnSecondary} onClick={resetForm}>
            Reset
          </button>
        </div>
      </div>

      <div className={styles.builderGrid}>
        {/* ── Form column ── */}
        <div className={styles.builderForm}>
          <div className={styles.builderField}>
            <label>Metric name</label>
            <input
              className={styles.input}
              placeholder="Exit-velocity mean (30d), Internal wOBA, etc."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className={styles.builderField}>
            <label>Scope</label>
            <select
              className={styles.select}
              value={scope}
              onChange={(e) => setScope(e.target.value as 'PRIVATE' | 'GLOBAL')}
            >
              <option value="PRIVATE">Private (only me)</option>
              <option value="GLOBAL">Global (all coaches)</option>
            </select>
          </div>

          {/* Mode toggle */}
          <div className={styles.builderField}>
            <label>Mode</label>
            <div className={styles.modeToggle}>
              <button
                type="button"
                className={`${styles.modeChip} ${mode === 'basic' ? styles.modeChipActive : ''}`}
                onClick={() => setMode('basic')}
              >
                Basic
              </button>
              <button
                type="button"
                className={`${styles.modeChip} ${mode === 'advanced' ? styles.modeChipActive : ''}`}
                onClick={() => setMode('advanced')}
              >
                Advanced
              </button>
            </div>
          </div>

          {mode === 'basic' ? (
            <>
              <div className={styles.builderField}>
                <label>Column</label>
                <select
                  className={styles.select}
                  value={basicSource && basicMetricType ? `${basicSource}::${basicMetricType}` : ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) { setBasicSource(null); setBasicMetricType(''); return; }
                    const [src, mt] = v.split('::');
                    setBasicSource(src);
                    setBasicMetricType(mt);
                  }}
                >
                  <option value="">Choose a column…</option>
                  {Object.entries(groupedColumns).map(([source, cols]) => (
                    <optgroup key={source} label={source}>
                      {cols.map((c) => (
                        <option key={`${c.source}::${c.metricType}`} value={`${c.source}::${c.metricType}`}>
                          {c.metricType}{c.unit ? ` (${c.unit})` : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className={styles.builderField}>
                <label>Aggregation</label>
                <select
                  className={styles.select}
                  value={basicAggregation}
                  onChange={(e) => setBasicAggregation(e.target.value as MetricAgg)}
                >
                  {METRIC_AGGS.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div className={styles.builderField}>
                <label>Variables</label>
                <div className={styles.varList}>
                  {variables.map((v, i) => (
                    <div key={i} className={styles.varRow}>
                      <input
                        className={styles.input}
                        style={{ maxWidth: 80 }}
                        placeholder="name"
                        value={v.name}
                        onChange={(e) => updateVariable(i, { name: e.target.value })}
                      />
                      <select
                        className={styles.select}
                        value={v.source && v.metricType ? `${v.source}::${v.metricType}` : ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (!val) { updateVariable(i, { source: null, metricType: '' }); return; }
                          const [src, mt] = val.split('::');
                          updateVariable(i, { source: src, metricType: mt });
                        }}
                      >
                        <option value="">Column…</option>
                        {Object.entries(groupedColumns).map(([source, cols]) => (
                          <optgroup key={source} label={source}>
                            {cols.map((c) => (
                              <option key={`${c.source}::${c.metricType}`} value={`${c.source}::${c.metricType}`}>
                                {c.metricType}{c.unit ? ` (${c.unit})` : ''}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <select
                        className={styles.select}
                        value={v.aggregation}
                        onChange={(e) => updateVariable(i, { aggregation: e.target.value as MetricAgg })}
                      >
                        {METRIC_AGGS.map((a) => (
                          <option key={a.value} value={a.value}>{a.label}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className={styles.btnSecondary}
                        onClick={() => removeVariable(i)}
                        disabled={variables.length <= 1}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button type="button" className={styles.btnSecondary} onClick={addVariable}>
                    + Add variable
                  </button>
                </div>
              </div>
              <div className={styles.builderField}>
                <label>Formula</label>
                <textarea
                  className={styles.input}
                  style={{ minHeight: 80, fontFamily: 'DM Mono, monospace', fontSize: 13 }}
                  placeholder="e.g. (0.69*BB + 0.89*B1 + 1.27*B2 + 1.62*B3 + 2.10*HR) / (AB + BB - IBB + SF + HBP)"
                  value={formula}
                  onChange={(e) => setFormula(e.target.value)}
                />
                <div className={styles.hint}>
                  Reference each variable by its name. Supported operators:
                  <code> + − × ÷ ( ) </code>. Common helpers: <code>avg(a, b)</code>, <code>min(a, b)</code>,
                  <code>max(a, b)</code>, <code>clamp(x, lo, hi)</code>, <code>round(x, n)</code>.
                </div>
              </div>
            </>
          )}

          {/* ── Date window ── */}
          <div className={styles.builderField}>
            <label>Date window</label>
            <select
              className={styles.select}
              value={dateMode}
              onChange={(e) => setDateMode(e.target.value as any)}
            >
              <option value="ALL_TIME">All time</option>
              <option value="LAST_N_DAYS">Last N days</option>
              <option value="RANGE">Specific range</option>
            </select>
          </div>
          {dateMode === 'LAST_N_DAYS' && (
            <div className={styles.builderField}>
              <label>N days</label>
              <input
                className={styles.input}
                type="number"
                min={1}
                value={lastNDays}
                onChange={(e) => setLastNDays(e.target.value)}
              />
            </div>
          )}
          {dateMode === 'RANGE' && (
            <>
              <div className={styles.builderField}>
                <label>From</label>
                <input
                  className={styles.input}
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div className={styles.builderField}>
                <label>To</label>
                <input
                  className={styles.input}
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </>
          )}

          {/* ── Display ── */}
          <div className={styles.builderField}>
            <label>Unit label (optional)</label>
            <input
              className={styles.input}
              placeholder="mph, °, %, ..."
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            />
          </div>
          <div className={styles.builderField}>
            <label>Decimal places</label>
            <input
              className={styles.input}
              type="number"
              min={0}
              max={6}
              value={precision}
              onChange={(e) => setPrecision(Math.max(0, Math.min(6, Number(e.target.value) || 0)))}
            />
          </div>

          {/* ── Secondary-display toggle + collapsible config ── */}
          <div className={styles.builderField}>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={secondaryEnabled}
                onChange={(e) => setSecondaryEnabled(e.target.checked)}
              />
              <span>Add a secondary number (smaller, below the main value)</span>
            </label>
          </div>

          {secondaryEnabled && (
            <div className={styles.subPanel}>
              <div className={styles.subPanelTitle}>Secondary display</div>

              <div className={styles.builderField}>
                <label>Secondary label (optional)</label>
                <input
                  className={styles.input}
                  placeholder="vs last 30 days, sample size, session count…"
                  value={secondary.label}
                  onChange={(e) => setSecondary({ ...secondary, label: e.target.value })}
                />
              </div>

              <div className={styles.builderField}>
                <label>Secondary column</label>
                <select
                  className={styles.select}
                  value={secondary.source && secondary.metricType ? `${secondary.source}::${secondary.metricType}` : ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) { setSecondary({ ...secondary, source: null, metricType: '' }); return; }
                    const [src, mt] = v.split('::');
                    setSecondary({ ...secondary, source: src, metricType: mt });
                  }}
                >
                  <option value="">Choose a column…</option>
                  {Object.entries(groupedColumns).map(([source, cols]) => (
                    <optgroup key={source} label={source}>
                      {cols.map((c) => (
                        <option key={`${c.source}::${c.metricType}`} value={`${c.source}::${c.metricType}`}>
                          {c.metricType}{c.unit ? ` (${c.unit})` : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div className={styles.builderField}>
                <label>Secondary aggregation</label>
                <select
                  className={styles.select}
                  value={secondary.aggregation}
                  onChange={(e) => setSecondary({ ...secondary, aggregation: e.target.value as MetricAgg })}
                >
                  {METRIC_AGGS.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
              </div>

              <div className={styles.builderField}>
                <label>Secondary unit (optional)</label>
                <input
                  className={styles.input}
                  placeholder="mph, %, n, ..."
                  value={secondary.unit}
                  onChange={(e) => setSecondary({ ...secondary, unit: e.target.value })}
                />
              </div>

              <div className={styles.builderField}>
                <label>Secondary decimals</label>
                <input
                  className={styles.input}
                  type="number"
                  min={0}
                  max={6}
                  value={secondary.precision}
                  onChange={(e) => setSecondary({
                    ...secondary,
                    precision: Math.max(0, Math.min(6, Number(e.target.value) || 0)),
                  })}
                />
              </div>
            </div>
          )}

          {/* ── Color rules (conditional coloring of the main number) ── */}
          <div className={styles.builderField}>
            <label>Color rules</label>
            <div className={styles.hint} style={{ marginTop: 0, marginBottom: 8 }}>
              First rule that matches the main value wins. Operators: <code>&gt;</code>
              , <code>&lt;</code>, <code>=</code>, <code>&ge;</code>, <code>&le;</code>.
              No match → default text color.
            </div>
            <div className={styles.varList}>
              {colorRules.map((r, i) => (
                <div key={i} className={styles.ruleRow}>
                  <select
                    className={styles.select}
                    value={r.op}
                    onChange={(e) => updateColorRule(i, { op: e.target.value as ColorOp })}
                  >
                    <option value=">">Greater than (&gt;)</option>
                    <option value=">=">At least (≥)</option>
                    <option value="=">Equals (=)</option>
                    <option value="<=">At most (≤)</option>
                    <option value="<">Less than (&lt;)</option>
                  </select>
                  <input
                    className={styles.input}
                    type="number"
                    placeholder="value"
                    value={r.threshold}
                    onChange={(e) => updateColorRule(i, { threshold: e.target.value })}
                  />
                  <select
                    className={styles.select}
                    value={r.color}
                    onChange={(e) => updateColorRule(i, { color: e.target.value })}
                    style={{ color: r.color, fontWeight: 700 }}
                  >
                    {COLOR_SWATCHES.map((s) => (
                      <option key={s.value} value={s.value} style={{ color: s.value }}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <span
                    className={styles.ruleSwatch}
                    aria-hidden="true"
                    style={{ background: r.color }}
                  />
                  <button type="button" className={styles.btnSecondary} onClick={() => removeColorRule(i)}>
                    ×
                  </button>
                </div>
              ))}
              <button type="button" className={styles.btnSecondary} onClick={addColorRule}>
                + Add color rule
              </button>
            </div>
          </div>

          {/* ── Profile scope ── */}
          <div className={styles.builderField}>
            <label>Appears on</label>
            <select
              className={styles.select}
              value={playerScope}
              onChange={(e) => setPlayerScope(e.target.value as 'ALL' | 'INDIVIDUAL')}
            >
              <option value="ALL">All athlete profiles</option>
              <option value="INDIVIDUAL">Individual athletes…</option>
            </select>
          </div>
          {playerScope === 'INDIVIDUAL' && (
            <div className={`${styles.builderField} ${styles.columnPicker}`}>
              <label>Select athletes ({scopePlayerIds.length} selected)</label>
              <DropdownPanel
                label={
                  scopePlayerIds.length === 0
                    ? 'Choose athletes…'
                    : `${scopePlayerIds.length} athlete${scopePlayerIds.length === 1 ? '' : 's'} selected`
                }
                placeholder={scopePlayerIds.length === 0}
              >
                <div className={styles.columnList} style={{ maxHeight: 260, border: 'none', padding: 0, background: 'transparent' }}>
                  {players.map((p) => {
                    const checked = scopePlayerIds.includes(p.id);
                    return (
                      <label key={p.id} className={styles.columnItem}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setScopePlayerIds(
                              checked
                                ? scopePlayerIds.filter((x) => x !== p.id)
                                : [...scopePlayerIds, p.id],
                            );
                          }}
                        />
                        <span>{p.firstName} {p.lastName}</span>
                        {p.positions && <span className={styles.columnUnit}>({p.positions})</span>}
                      </label>
                    );
                  })}
                </div>
              </DropdownPanel>
            </div>
          )}

          {feedback && <div className={styles.feedback}>{feedback}</div>}

          <div className={styles.formActions}>
            <button type="button" className={styles.btn} onClick={handleSave}>
              Save metric
            </button>
          </div>
        </div>

        {/* ── Preview + saved list column ── */}
        <div className={styles.previewCol}>
          <div className={styles.builderField}>
            <label>Preview against</label>
            <select
              className={styles.select}
              value={previewPlayerId}
              onChange={(e) => setPreviewPlayerId(e.target.value)}
            >
              <option value="">Choose an athlete…</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
              ))}
            </select>
          </div>

          <div
            className={styles.metricPreviewBubble}
            style={resolvedPreviewColor ? { borderLeftColor: resolvedPreviewColor } : undefined}
          >
            <div className={styles.metricPreviewLabel}>
              {title.trim() || 'Untitled metric'}
            </div>
            <div
              className={styles.metricPreviewValue}
              style={resolvedPreviewColor ? { color: resolvedPreviewColor } : undefined}
            >
              {previewValue == null
                ? '—'
                : `${previewValue.toFixed(precision)}${unit ? ` ${unit}` : ''}`}
            </div>
            {secondaryEnabled && (
              <div className={styles.metricPreviewSecondary}>
                <span className={styles.metricPreviewSecondaryValue}>
                  —{secondary.unit ? ` ${secondary.unit}` : ''}
                </span>
                {secondary.label && (
                  <span className={styles.metricPreviewSecondaryLabel}>
                    {secondary.label}
                  </span>
                )}
              </div>
            )}
            <div className={styles.metricPreviewNote}>
              {previewNote}
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            <h4 className={styles.cardTitle} style={{ fontSize: 14, margin: '0 0 8px' }}>
              Saved metrics (session)
            </h4>
            {saved.length === 0 ? (
              <div className={styles.empty} style={{ padding: 16 }}>
                Nothing saved yet. Build a metric on the left and click Save.
              </div>
            ) : (
              <div className={styles.savedList}>
                {saved.map((m) => (
                  <div key={m.id} className={styles.savedItem}>
                    <div>
                      <div className={styles.savedTitle}>{m.title}</div>
                      <div className={styles.savedMeta}>
                        {m.mode === 'basic'
                          ? `${m.basicAggregation} · ${m.basicMetricType || 'no column'}`
                          : `Advanced · ${m.variables.length} var${m.variables.length === 1 ? '' : 's'}`}
                        {' · '}
                        {m.scope === 'PRIVATE' ? 'Private' : 'Global'}
                      </div>
                    </div>
                    <div className={styles.savedActions}>
                      <button type="button" className={styles.btnSecondary} onClick={() => loadSaved(m)}>Load</button>
                      <button type="button" className={styles.btnSecondary} onClick={() => deleteSaved(m.id)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Saved pane ────────────────────────────────────────── */

function SavedPane() {
  const [configs, setConfigs] = useState<ChartConfig[]>([]);
  const [err, setErr] = useState('');

  const reload = async () => {
    try {
      const rows = await api.getChartConfigs();
      setConfigs(rows);
      setErr('');
    } catch (e: any) {
      setErr(e.message || 'Failed to load');
    }
  };

  useEffect(() => { reload(); }, []);

  const remove = async (id: string) => {
    if (!confirm('Delete this chart config?')) return;
    await api.deleteChartConfig(id);
    reload();
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <h3 className={styles.cardTitle}>Saved Charts</h3>
          <p className={styles.cardDesc}>Every custom chart visible to your account, grouped by profile section.</p>
        </div>
      </div>

      {err && <div className={`${styles.feedback} ${styles.feedbackErr}`}>{err}</div>}

      {configs.length === 0 ? (
        <div className={styles.empty}>No saved charts. Create one from the Chart Builder tab.</div>
      ) : (
        <div className={styles.configGrid}>
          {configs.map((c) => {
            let sources: ChartDataSource[] = [];
            try { sources = JSON.parse(c.dataSources); } catch { /* ignore */ }
            return (
              <div key={c.id} className={styles.configCard}>
                <div className={styles.configTop}>
                  <div className={styles.configTitle}>{c.title}</div>
                </div>
                <div className={styles.configMeta}>
                  <span className={styles.configTag}>{c.section}</span>
                  <span className={styles.configTag}>{c.chartType}</span>
                  <span className={styles.configTag}>{c.scope}</span>
                </div>
                <div className={styles.configSources}>
                  {sources.length} data {sources.length === 1 ? 'series' : 'series'} ·{' '}
                  {c.dateMode === 'ALL_TIME' ? 'All time' :
                    c.dateMode === 'LAST_N_DAYS' ? `Last ${c.lastNDays} days` :
                    `${c.dateFrom || '—'} to ${c.dateTo || '—'}`}
                </div>
                <div className={styles.configActions}>
                  <button className={styles.btnDanger} onClick={() => remove(c.id)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Chart views (shared with profile renderer) ────────── */

function StatBubbleView({ series }: { series: ChartEvaluation['series'] }) {
  return (
    <div className={styles.bubbleRow}>
      {series.map((s) => {
        const latest = s.points[s.points.length - 1];
        return (
          <div key={`${s.source}::${s.metricType}`} className={styles.bubble}>
            <div className={styles.bubbleValue}>{latest ? latest.value.toFixed(1) : '—'}</div>
            <div className={styles.bubbleLabel}>{s.label}</div>
            <div className={styles.bubbleSub}>{s.source}</div>
          </div>
        );
      })}
    </div>
  );
}

function PercentIncreaseView({ series }: { series: ChartEvaluation['series'] }) {
  return (
    <div className={styles.bubbleRow}>
      {series.map((s) => {
        const first = s.points[0];
        const last = s.points[s.points.length - 1];
        const pct = first && last && first.value !== 0 ? ((last.value - first.value) / first.value) * 100 : null;
        const positive = (pct || 0) >= 0;
        return (
          <div key={`${s.source}::${s.metricType}`} className={styles.bubble}>
            <div className={`${styles.bubbleValue} ${positive ? styles.pos : styles.neg}`}>
              {pct == null ? '—' : `${positive ? '+' : ''}${pct.toFixed(1)}%`}
            </div>
            <div className={styles.bubbleLabel}>{s.label}</div>
            <div className={styles.bubbleSub}>
              {first && last ? `${first.value.toFixed(1)} → ${last.value.toFixed(1)}` : s.source}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BarView({ series }: { series: ChartEvaluation['series'] }) {
  const bars = series.map((s) => {
    const values = s.points.map((p) => p.value);
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const max = values.length ? Math.max(...values) : 0;
    return { label: s.label, avg, max };
  });
  const scale = Math.max(...bars.map((b) => b.max), 1);

  return (
    <div className={styles.barWrap}>
      {bars.map((b) => (
        <div key={b.label} className={styles.barRow}>
          <div className={styles.barLabel}>{b.label}</div>
          <div className={styles.barTrack}>
            <div className={styles.barFill} style={{ width: `${(b.avg / scale) * 100}%` }} />
          </div>
          <div className={styles.barValue}>{b.avg.toFixed(1)}</div>
        </div>
      ))}
    </div>
  );
}

function LineView({ series }: { series: ChartEvaluation['series'] }) {
  const W = 560;
  const H = 220;
  const PAD = 34;
  const allPoints = series.flatMap((s) => s.points);
  if (allPoints.length === 0) return <div className={styles.previewEmpty}>No points</div>;

  const xs = allPoints.map((p) => new Date(p.date).getTime());
  const ys = allPoints.map((p) => p.value);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  const colors = ['#4682FF', '#D4AF37', '#34D399', '#E11D48', '#8B5CF6', '#F472B6'];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg}>
        <line x1={PAD} y1={H - PAD} x2={W - 6} y2={H - PAD} stroke="rgba(255,255,255,0.12)" />
        <line x1={PAD} y1={6} x2={PAD} y2={H - PAD} stroke="rgba(255,255,255,0.12)" />
        {series.map((s, i) => {
          if (s.points.length === 0) return null;
          const color = colors[i % colors.length];
          const points = s.points.map((p) => {
            const x = PAD + ((new Date(p.date).getTime() - xMin) / xRange) * (W - PAD - 6);
            const y = 6 + (1 - (p.value - yMin) / yRange) * (H - PAD - 6);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          }).join(' ');
          return (
            <g key={`${s.source}::${s.metricType}`}>
              <polyline fill="none" stroke={color} strokeWidth="2" points={points} />
              {s.points.map((p, j) => {
                const x = PAD + ((new Date(p.date).getTime() - xMin) / xRange) * (W - PAD - 6);
                const y = 6 + (1 - (p.value - yMin) / yRange) * (H - PAD - 6);
                return <circle key={j} cx={x} cy={y} r="3" fill={color} />;
              })}
            </g>
          );
        })}
        <text x={PAD - 6} y={H - PAD + 4} fontSize="10" fill="rgba(255,255,255,0.55)" textAnchor="end">{yMin.toFixed(1)}</text>
        <text x={PAD - 6} y={12} fontSize="10" fill="rgba(255,255,255,0.55)" textAnchor="end">{yMax.toFixed(1)}</text>
      </svg>
      <div className={styles.legend}>
        {series.map((s, i) => (
          <span key={`${s.source}::${s.metricType}`} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: colors[i % colors.length] }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─── Advanced chart views ───────────────────────────────── */

const CHART_COLORS = ['#4682FF', '#D4AF37', '#34D399', '#E11D48', '#8B5CF6', '#F472B6'];

function MovementPlotView({ series }: { series: ChartEvaluation['series'] }) {
  // First series = X axis, second series = Y axis. Match by date so each recording becomes one point.
  const W = 560;
  const H = 300;
  const PAD = 38;
  const xSeries = series[0];
  const ySeries = series[1];
  if (!xSeries || !ySeries) return <div className={styles.previewEmpty}>Pick two columns.</div>;

  const yMap = new Map(ySeries.points.map((p) => [p.date.slice(0, 10), p.value]));
  const pairs = xSeries.points
    .map((p) => {
      const y = yMap.get(p.date.slice(0, 10));
      return y != null ? { date: p.date, x: p.value, y } : null;
    })
    .filter(Boolean) as Array<{ date: string; x: number; y: number }>;

  if (pairs.length === 0) {
    return (
      <div className={styles.previewEmpty}>
        No dates overlap between the two columns.<br />
        Movement Plot pairs X and Y by recording date.
      </div>
    );
  }

  const xs = pairs.map((p) => p.x);
  const ys = pairs.map((p) => p.y);
  const xMin = Math.min(0, ...xs);
  const xMax = Math.max(0, ...xs);
  const yMin = Math.min(0, ...ys);
  const yMax = Math.max(0, ...ys);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  const toX = (x: number) => PAD + ((x - xMin) / xRange) * (W - PAD - 6);
  const toY = (y: number) => 6 + (1 - (y - yMin) / yRange) * (H - PAD - 6);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg}>
        {/* axes */}
        <line x1={PAD} y1={H - PAD} x2={W - 6} y2={H - PAD} stroke="rgba(255,255,255,0.12)" />
        <line x1={PAD} y1={6} x2={PAD} y2={H - PAD} stroke="rgba(255,255,255,0.12)" />
        {/* zero lines */}
        {xMin <= 0 && xMax >= 0 && (
          <line x1={toX(0)} y1={6} x2={toX(0)} y2={H - PAD} stroke="rgba(255,255,255,0.20)" strokeDasharray="3 4" />
        )}
        {yMin <= 0 && yMax >= 0 && (
          <line x1={PAD} y1={toY(0)} x2={W - 6} y2={toY(0)} stroke="rgba(255,255,255,0.20)" strokeDasharray="3 4" />
        )}
        {pairs.map((p, i) => (
          <circle key={i} cx={toX(p.x)} cy={toY(p.y)} r="5" fill="#4682FF" fillOpacity="0.75" stroke="#D4AF37" strokeWidth="0.75" />
        ))}
        <text x={W - 8} y={H - PAD - 6} fontSize="10" fill="rgba(255,255,255,0.55)" textAnchor="end">
          X: {xSeries.label}
        </text>
        <text x={PAD + 6} y={14} fontSize="10" fill="rgba(255,255,255,0.55)">
          Y: {ySeries.label}
        </text>
      </svg>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendDot} style={{ background: '#4682FF' }} />
          {pairs.length} paired points
        </span>
      </div>
    </div>
  );
}

/** Compute simple or exponential moving average over a point series */
function computeMovingAverage(
  points: Array<{ date: string; value: number }>,
  window: number,
  mode: 'SMA' | 'EMA',
): Array<{ date: string; value: number }> {
  if (points.length === 0 || window < 2) return [];
  if (mode === 'EMA') {
    const k = 2 / (window + 1);
    const out: Array<{ date: string; value: number }> = [];
    let ema = points[0].value;
    points.forEach((p, i) => {
      ema = i === 0 ? p.value : p.value * k + ema * (1 - k);
      out.push({ date: p.date, value: ema });
    });
    return out;
  }
  // SMA
  const out: Array<{ date: string; value: number }> = [];
  for (let i = 0; i < points.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = points.slice(start, i + 1);
    const avg = slice.reduce((a, b) => a + b.value, 0) / slice.length;
    out.push({ date: points[i].date, value: avg });
  }
  return out;
}

function RollingAvgView({
  series, window, mode,
}: { series: ChartEvaluation['series']; window: number; mode: 'SMA' | 'EMA' }) {
  const withSmoothed = series.map((s) => ({
    ...s,
    smoothed: computeMovingAverage(s.points, window, mode),
  }));
  return (
    <LineViewAnnotated
      series={series}
      overlays={withSmoothed.map((s, i) => ({
        points: s.smoothed,
        color: CHART_COLORS[i % CHART_COLORS.length],
        dashed: true,
        label: `${s.label} · ${mode}${window}`,
      }))}
    />
  );
}

/** Linear regression: y = a + b*x where x is ms timestamp */
function linearRegression(points: Array<{ date: string; value: number }>) {
  if (points.length < 2) return null;
  const xs = points.map((p) => new Date(p.date).getTime());
  const ys = points.map((p) => p.value);
  const n = xs.length;
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxx = xs.reduce((a, b) => a + b * b, 0);
  const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx) || 0;
  const a = (sy - b * sx) / n;
  // R²
  const meanY = sy / n;
  const ssTot = ys.reduce((acc, v) => acc + (v - meanY) ** 2, 0) || 1;
  const ssRes = ys.reduce((acc, v, i) => acc + (v - (a + b * xs[i])) ** 2, 0);
  const r2 = 1 - ssRes / ssTot;
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  return {
    slope: b,
    intercept: a,
    r2,
    endpoints: [
      { date: new Date(xMin).toISOString(), value: a + b * xMin },
      { date: new Date(xMax).toISOString(), value: a + b * xMax },
    ],
  };
}

function TrendlineView({ series }: { series: ChartEvaluation['series'] }) {
  const overlays = series.map((s, i) => {
    const reg = linearRegression(s.points);
    return reg
      ? {
          points: reg.endpoints,
          color: CHART_COLORS[i % CHART_COLORS.length],
          dashed: true,
          label: `${s.label} · trend (R²=${reg.r2.toFixed(2)})`,
        }
      : null;
  }).filter(Boolean) as Array<{ points: Array<{ date: string; value: number }>; color: string; dashed: boolean; label: string }>;
  return <LineViewAnnotated series={series} overlays={overlays} />;
}

function TargetBandView({
  series, targetMin, targetMax,
}: { series: ChartEvaluation['series']; targetMin: number | null; targetMax: number | null }) {
  return <LineViewAnnotated series={series} band={{ min: targetMin, max: targetMax }} />;
}

function PersonalBestView({
  series, direction,
}: { series: ChartEvaluation['series']; direction: 'MAX' | 'MIN' }) {
  const overlays = series.map((s, i) => {
    if (s.points.length === 0) return null;
    let best = s.points[0].value;
    const pb: Array<{ date: string; value: number }> = [];
    s.points.forEach((p) => {
      if (direction === 'MAX' ? p.value > best : p.value < best) best = p.value;
      pb.push({ date: p.date, value: best });
    });
    return {
      points: pb,
      color: CHART_COLORS[i % CHART_COLORS.length],
      dashed: false,
      label: `${s.label} · PB (${direction})`,
      stepped: true,
    };
  }).filter(Boolean) as Array<{ points: Array<{ date: string; value: number }>; color: string; dashed: boolean; label: string; stepped?: boolean }>;
  return <LineViewAnnotated series={series} overlays={overlays} dimRaw />;
}

/**
 * Generic annotated line view used by RollingAvg, Trendline, TargetBand, PersonalBest.
 * Renders the raw series (optionally dimmed) plus overlays and an optional horizontal band.
 */
function LineViewAnnotated({
  series, overlays = [], band, dimRaw = false,
}: {
  series: ChartEvaluation['series'];
  overlays?: Array<{
    points: Array<{ date: string; value: number }>;
    color: string;
    dashed?: boolean;
    label: string;
    stepped?: boolean;
  }>;
  band?: { min: number | null; max: number | null };
  dimRaw?: boolean;
}) {
  const W = 560;
  const H = 220;
  const PAD = 34;
  const rawPoints = series.flatMap((s) => s.points);
  const overlayPoints = overlays.flatMap((o) => o.points);
  const allPoints = [...rawPoints, ...overlayPoints];
  if (allPoints.length === 0) return <div className={styles.previewEmpty}>No points</div>;

  const xs = allPoints.map((p) => new Date(p.date).getTime());
  const ys = allPoints.map((p) => p.value);
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  if (band) {
    if (band.min != null) yMin = Math.min(yMin, band.min);
    if (band.max != null) yMax = Math.max(yMax, band.max);
  }
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  const toX = (d: string) => PAD + ((new Date(d).getTime() - xMin) / xRange) * (W - PAD - 6);
  const toY = (v: number) => 6 + (1 - (v - yMin) / yRange) * (H - PAD - 6);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg}>
        <line x1={PAD} y1={H - PAD} x2={W - 6} y2={H - PAD} stroke="rgba(255,255,255,0.12)" />
        <line x1={PAD} y1={6} x2={PAD} y2={H - PAD} stroke="rgba(255,255,255,0.12)" />

        {/* Target band */}
        {band && band.min != null && band.max != null && (
          <rect
            x={PAD}
            y={toY(Math.max(band.min, band.max))}
            width={W - PAD - 6}
            height={Math.abs(toY(band.min) - toY(band.max))}
            fill="rgba(52, 211, 153, 0.14)"
            stroke="rgba(52, 211, 153, 0.38)"
            strokeDasharray="3 4"
          />
        )}

        {/* Raw series */}
        {series.map((s, i) => {
          if (s.points.length === 0) return null;
          const color = CHART_COLORS[i % CHART_COLORS.length];
          const pts = s.points.map((p) => `${toX(p.date).toFixed(1)},${toY(p.value).toFixed(1)}`).join(' ');
          return (
            <g key={`raw-${i}`} opacity={dimRaw ? 0.45 : 1}>
              <polyline fill="none" stroke={color} strokeWidth="2" points={pts} />
              {s.points.map((p, j) => (
                <circle key={j} cx={toX(p.date)} cy={toY(p.value)} r="2.5" fill={color} />
              ))}
            </g>
          );
        })}

        {/* Overlays */}
        {overlays.map((o, i) => {
          if (o.points.length === 0) return null;
          let d = '';
          if (o.stepped && o.points.length > 0) {
            d = `M ${toX(o.points[0].date).toFixed(1)} ${toY(o.points[0].value).toFixed(1)}`;
            for (let k = 1; k < o.points.length; k++) {
              const px = toX(o.points[k - 1].date);
              const py = toY(o.points[k - 1].value);
              const x = toX(o.points[k].date);
              const y = toY(o.points[k].value);
              d += ` L ${x.toFixed(1)} ${py.toFixed(1)} L ${x.toFixed(1)} ${y.toFixed(1)}`;
            }
          } else {
            d = o.points.map((p, k) => `${k === 0 ? 'M' : 'L'} ${toX(p.date).toFixed(1)} ${toY(p.value).toFixed(1)}`).join(' ');
          }
          return (
            <path
              key={`ov-${i}`}
              d={d}
              fill="none"
              stroke={o.color}
              strokeWidth="2.5"
              strokeDasharray={o.dashed ? '6 5' : undefined}
            />
          );
        })}

        <text x={PAD - 6} y={H - PAD + 4} fontSize="10" fill="rgba(255,255,255,0.55)" textAnchor="end">{yMin.toFixed(1)}</text>
        <text x={PAD - 6} y={12} fontSize="10" fill="rgba(255,255,255,0.55)" textAnchor="end">{yMax.toFixed(1)}</text>
      </svg>
      <div className={styles.legend}>
        {series.map((s, i) => (
          <span key={`leg-raw-${i}`} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
            {s.label}
          </span>
        ))}
        {overlays.map((o, i) => (
          <span key={`leg-ov-${i}`} className={styles.legendItem}>
            <span
              className={styles.legendDot}
              style={{
                background: 'transparent',
                border: `2px ${o.dashed ? 'dashed' : 'solid'} ${o.color}`,
              }}
            />
            {o.label}
          </span>
        ))}
        {band && band.min != null && band.max != null && (
          <span className={styles.legendItem}>
            <span
              className={styles.legendDot}
              style={{ background: 'rgba(52, 211, 153, 0.35)', border: '1px solid rgba(52,211,153,0.6)' }}
            />
            Target {band.min}–{band.max}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Strike zone heat map.
 * NOTE: real per-pitch zone coordinates aren't stored on Metric rows yet.
 * For the live preview we deterministically bin the values of the FIRST series
 * across the grid (index % cells) so coaches can see the visual treatment and
 * save the config; once pitch location is wired into ingest the same renderer
 * will display real spatial data with no further changes.
 */
function StrikeZoneHeatView({
  series, grid, metric,
}: { series: ChartEvaluation['series']; grid: '3x3' | '5x5'; metric: 'COUNT' | 'AVG' | 'WHIFF' }) {
  const n = grid === '3x3' ? 3 : 5;
  const cells: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const sums: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  const first = series[0];
  if (first) {
    first.points.forEach((p, i) => {
      const r = i % n;
      const c = Math.floor(i / n) % n;
      cells[r][c] += 1;
      sums[r][c] += p.value;
    });
  }

  const values: number[][] = cells.map((row, r) => row.map((count, c) => {
    if (metric === 'COUNT') return count;
    if (metric === 'AVG') return count ? sums[r][c] / count : 0;
    // WHIFF proxy: normalize low values as "miss" — just a demo until real whiff flags are available
    return count ? 1 - Math.min(1, sums[r][c] / (count * Math.max(...sums.flat(), 1))) : 0;
  }));
  const maxV = Math.max(...values.flat(), 1);

  const W = 320;
  const H = 320;
  const cellSize = (W - 40) / n;
  const ox = 20;
  const oy = 20;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} style={{ maxWidth: 360, margin: '0 auto' }}>
        <rect x={ox} y={oy} width={cellSize * n} height={cellSize * n} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
        {values.map((row, r) =>
          row.map((v, c) => {
            const intensity = maxV ? v / maxV : 0;
            const hue = metric === 'WHIFF' ? 355 : 210;
            return (
              <g key={`${r}-${c}`}>
                <rect
                  x={ox + c * cellSize}
                  y={oy + r * cellSize}
                  width={cellSize - 1}
                  height={cellSize - 1}
                  fill={`hsla(${hue}, 70%, 55%, ${0.15 + intensity * 0.65})`}
                  stroke="rgba(255,255,255,0.08)"
                />
                <text
                  x={ox + c * cellSize + cellSize / 2}
                  y={oy + r * cellSize + cellSize / 2 + 4}
                  textAnchor="middle"
                  fontSize="11"
                  fill="rgba(255,255,255,0.85)"
                  fontFamily="DM Mono, monospace"
                >
                  {metric === 'COUNT' ? v : v.toFixed(1)}
                </text>
              </g>
            );
          }),
        )}
      </svg>
      <div className={styles.previewEmpty} style={{ padding: '8px 0', fontSize: 11 }}>
        Showing <strong>{metric}</strong> on a {grid} grid from {first?.label || '—'}.{' '}
        Once per-pitch zone coordinates are ingested, this chart will reflect real spatial data.
      </div>
    </div>
  );
}

/* ─── Date range calendar picker ─────────────────────────── */

/** Format a Date as YYYY-MM-DD in local time (what <input type="date"> uses). */
function fmtLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a YYYY-MM-DD string as a local-time Date (avoids UTC off-by-one). */
function parseLocal(s: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/**
 * Input-style trigger that opens an inline calendar popover.
 * Sits in the same grid slot as the "Number of days" input so the form
 * layout stays consistent.
 */
function DateRangePopover({
  from, to, onChange,
}: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close the popover when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const fmtDisplay = (s: string) => {
    const d = parseLocal(s);
    return d ? d.toLocaleDateString() : '';
  };

  const label = from && to
    ? `${fmtDisplay(from)} — ${fmtDisplay(to)}`
    : from
      ? `${fmtDisplay(from)} — …`
      : 'Pick a date range';

  const placeholder = !from && !to;

  return (
    <div className={styles.datePopoverWrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.datePopoverTrigger} ${placeholder ? styles.datePopoverPlaceholder : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>{label}</span>
        <span className={styles.datePopoverChevron}>▾</span>
      </button>
      {open && (
        <div className={styles.datePopoverPanel}>
          <DateRangeCalendar
            from={from}
            to={to}
            onChange={(f, t) => {
              onChange(f, t);
              // Auto-close once both ends are set so the field collapses back.
              if (f && t && f !== t) setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Generic multi-select dropdown wrapper. Renders a trigger button styled like
 * the other form inputs; on click, reveals a floating panel with the children
 * (typically a checklist). Closes on outside-click or Escape.
 */
function DropdownPanel({
  label, placeholder = false, children,
}: { label: string; placeholder?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div className={styles.datePopoverWrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.datePopoverTrigger} ${placeholder ? styles.datePopoverPlaceholder : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>{label}</span>
        <span className={styles.datePopoverChevron}>▾</span>
      </button>
      {open && (
        <div className={styles.datePopoverPanel} style={{ minWidth: 320 }}>
          {children}
        </div>
      )}
    </div>
  );
}

function DateRangeCalendar({
  from, to, onChange,
}: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const fromDate = parseLocal(from);
  const toDate = parseLocal(to);

  // Month displayed; defaults to the first picked date or today
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const seed = fromDate || toDate || new Date();
    return new Date(seed.getFullYear(), seed.getMonth(), 1);
  });

  const today = new Date();
  const todayKey = fmtLocal(today);

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Build a 6-row grid (42 cells)
  const cells: Array<{ date: Date | null; key: string | null }> = [];
  for (let i = 0; i < startWeekday; i++) cells.push({ date: null, key: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    cells.push({ date, key: fmtLocal(date) });
  }
  while (cells.length < 42) cells.push({ date: null, key: null });

  const monthLabel = viewMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const weekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const handleClick = (key: string) => {
    // No start yet, OR both set (starting a new range), OR clicked before start
    if (!from || (from && to)) {
      onChange(key, '');
      return;
    }
    // Clicked the same day as start → clear end
    if (key === from) {
      onChange(from, from);
      return;
    }
    // Clicked before start → swap
    if (parseLocal(key)! < parseLocal(from)!) {
      onChange(key, from);
      return;
    }
    onChange(from, key);
  };

  const inRange = (key: string) => {
    if (!from || !to) return false;
    return key >= from && key <= to;
  };
  const isStart = (key: string) => key === from && from !== '';
  const isEnd = (key: string) => key === to && to !== '';

  const prevMonth = () => setViewMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setViewMonth(new Date(year, month + 1, 1));
  const gotoToday = () => setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1));
  const clearRange = () => onChange('', '');

  return (
    <div className={styles.calendarWrap}>
      <div className={styles.calendarHeader}>
        <button type="button" className={styles.calendarNav} onClick={prevMonth} aria-label="Previous month">‹</button>
        <div className={styles.calendarMonth}>{monthLabel}</div>
        <button type="button" className={styles.calendarNav} onClick={nextMonth} aria-label="Next month">›</button>
      </div>

      <div className={styles.calendarWeekdays}>
        {weekdays.map((w) => <div key={w} className={styles.calendarWeekday}>{w}</div>)}
      </div>

      <div className={styles.calendarGrid}>
        {cells.map((c, i) => {
          if (!c.date || !c.key) {
            return <div key={`e-${i}`} className={styles.calendarCellEmpty} />;
          }
          const classes = [styles.calendarCell];
          if (inRange(c.key)) classes.push(styles.calendarCellInRange);
          if (isStart(c.key)) classes.push(styles.calendarCellStart);
          if (isEnd(c.key)) classes.push(styles.calendarCellEnd);
          if (c.key === todayKey) classes.push(styles.calendarCellToday);
          return (
            <button
              type="button"
              key={c.key}
              className={classes.join(' ')}
              onClick={() => handleClick(c.key!)}
            >
              {c.date.getDate()}
            </button>
          );
        })}
      </div>

      <div className={styles.calendarFooter}>
        <div className={styles.calendarSummary}>
          {from && to
            ? <>From <strong>{from}</strong> to <strong>{to}</strong></>
            : from
              ? <>Start <strong>{from}</strong> · click a later date to set end</>
              : 'Click a day to start the range'}
        </div>
        <div className={styles.calendarActions}>
          <button type="button" className={styles.calendarLink} onClick={gotoToday}>Today</button>
          <button type="button" className={styles.calendarLink} onClick={clearRange}>Clear</button>
        </div>
      </div>
    </div>
  );
}
