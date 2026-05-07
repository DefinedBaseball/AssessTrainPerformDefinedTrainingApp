/**
 * API Client for the Player Development Web App
 * Uses Next.js rewrites to proxy /api/* to the NestJS backend.
 */

const TOKEN_KEY = 'pdapp_token';

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options?.headers as Record<string, string>) || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.text();
    // Extract the human-readable message from NestJS error JSON
    let msg = body;
    try {
      const parsed = JSON.parse(body);
      if (parsed.message) msg = parsed.message;
    } catch { /* use raw body */ }
    throw new Error(msg);
  }

  return res.json();
}

// ---- Types ----

export interface Player {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  positions: string;
  profilePhoto: string | null;
  heightInches: number | null;
  weightLbs: number | null;
  gradYear: number | null;
  collegeCommit: string | null;
  pbrNational: number | null;
  pbrState: number | null;
  pbrPosition: number | null;
  pgScore: number | null;
  bats: string | null;
  throws: string | null;
  highSchool: string | null;
  clubTeam: string | null;
  birthDate: string | null;
  /** JSON-encoded map of `{ [aggregateSectionKey]: nextStepsText }` shown in
   *  the Player Summary's Development snapshot. */
  developmentNotes?: string | null;
  user?: { email: string; role: string };
}

export interface Metric {
  id: string;
  playerId: string;
  source: string;
  metricType: string;
  value: number;
  unit: string;
  recordedAt: string;
  rawData: string | null;
}

export interface CsvUploadResult {
  message: string;
  uploadId: string;
  detectedSource: string;
  confidence: number;
  totalRows: number;
  metricsCreated: number;
  playersMatched: string[];
  playersUnmatched: string[];
  errors: { row: number; message: string }[];
}

export interface LeaderboardEntry {
  id: string;
  gradYear: number;
  metricType: string;
  playerId: string;
  value: number;
  rank: number;
  player?: Player;
}

export interface Video {
  id: string;
  playerId: string;
  title: string;
  category: string;
  originalUrl: string | null;
  hlsUrl: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  status: string;
  createdAt: string;
  annotations?: any[];
  voiceOvers?: any[];
}

// ---- Auth ----

export interface AuthResponse {
  token: string;
  id: string;
  email: string;
  role: string;
  playerId: string | null;
}

export async function login(email: string, password: string) {
  return request<AuthResponse>(
    '/auth/login',
    { method: 'POST', body: JSON.stringify({ email, password }) },
  );
}

export async function getMe() {
  return request<{ sub: string; email: string; role: string; playerId: string | null; exp: number }>(
    '/auth/me',
  );
}

export async function register(email: string, password: string, role: string) {
  return request<AuthResponse>(
    '/auth/register',
    { method: 'POST', body: JSON.stringify({ email, password, role }) },
  );
}

// ---- Players ----

export async function getPlayers(filters?: { gradYear?: number; position?: string }) {
  const params = new URLSearchParams();
  if (filters?.gradYear) params.set('gradYear', String(filters.gradYear));
  if (filters?.position) params.set('position', filters.position);
  const qs = params.toString() ? `?${params}` : '';
  return request<Player[]>(`/players${qs}`);
}

export async function getPlayer(id: string) {
  return request<Player & { metrics: Metric[] }>(`/players/${id}`);
}

export async function createPlayer(data: {
  userId: string;
  firstName: string;
  lastName: string;
  positions: string;
  heightInches?: number;
  weightLbs?: number;
  gradYear?: number;
}) {
  return request<Player>('/players', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updatePlayer(id: string, data: Partial<Player>) {
  return request<Player>(`/players/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function getTopMetrics(playerId: string) {
  return request<Record<string, { value: number; unit: string; recordedAt: string }>>(
    `/players/${playerId}/top-metrics`,
  );
}

// ---- Metrics ----

export async function getPlayerMetrics(
  playerId: string,
  options?: { source?: string; date?: string; month?: string; latest?: boolean; uploadIds?: string[] },
) {
  const params = new URLSearchParams();
  if (options?.source) params.set('source', options.source);
  if (options?.date) params.set('date', options.date);
  if (options?.month) params.set('month', options.month);
  if (options?.latest) params.set('latest', 'true');
  if (options?.uploadIds?.length) params.set('uploadIds', options.uploadIds.join(','));
  const qs = params.toString() ? `?${params}` : '';
  return request<Metric[]>(`/players/${playerId}/metrics${qs}`);
}

export async function createMetric(playerId: string, data: {
  source: string;
  metricType: string;
  value: number;
  unit: string;
  recordedAt: string;
}) {
  return request<Metric>(`/players/${playerId}/metrics`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getMetricProgress(
  playerId: string,
  metricType: string,
  source?: string,
) {
  const qs = source ? `?source=${encodeURIComponent(source)}` : '';
  return request<{ value: number; recordedAt: string }[]>(
    `/players/${playerId}/metrics/progress/${metricType}${qs}`,
  );
}

export async function getSessionData(
  playerId: string,
  source: string,
  types?: string[],
  opts?: { date?: string; from?: string; to?: string; uploadIds?: string[] },
) {
  const params = new URLSearchParams();
  if (types?.length) params.set('types', types.join(','));
  if (opts?.date) params.set('date', opts.date);
  if (opts?.from) params.set('from', opts.from);
  if (opts?.to) params.set('to', opts.to);
  if (opts?.uploadIds?.length) params.set('uploadIds', opts.uploadIds.join(','));
  const qs = params.toString();
  return request<{ metricType: string; value: number; unit: string; recordedAt: string; rawData: string | null }[]>(
    `/players/${playerId}/metrics/session-data/${source}${qs ? `?${qs}` : ''}`,
  );
}

export async function getBattedBallSummary(playerId: string, source?: string, uploadIds?: string[]) {
  const params = new URLSearchParams();
  if (source) params.set('source', source);
  if (uploadIds?.length) params.set('uploadIds', uploadIds.join(','));
  const qs = params.toString() ? `?${params}` : '';
  return request<Record<string, { avg: number; max: number; min: number; count: number }>>(
    `/players/${playerId}/metrics/batted-ball-summary${qs}`,
  );
}

// ---- Trackman Pitches ----

export interface TrackmanPitch {
  id: string;
  velocity: number;
  recordedAt: string;
  pitchType: string;
  relSpeed: number | null;
  spinRate: number | null;
  spinAxis: number | null;
  tilt: string | null;
  relHeight: number | null;
  relSide: number | null;
  extension: number | null;
  vertBreak: number | null;
  inducedVertBreak: number | null;
  horzBreak: number | null;
  plateLocHeight: number | null;
  plateLocSide: number | null;
  zoneSpeed: number | null;
  effectiveVelo: number | null;
  vertApprAngle: number | null;
  horzApprAngle: number | null;
  pitchCall: string | null;
  pitcherThrows: string | null;
}

export async function getTrackmanPitches(playerId: string, opts?: { from?: string; to?: string; uploadIds?: string[] }) {
  const params = new URLSearchParams();
  if (opts?.from) params.set('from', opts.from);
  if (opts?.to) params.set('to', opts.to);
  if (opts?.uploadIds?.length) params.set('uploadIds', opts.uploadIds.join(','));
  const qs = params.toString() ? `?${params}` : '';
  return request<TrackmanPitch[]>(`/players/${playerId}/metrics/trackman-pitches${qs}`);
}

// ---- CSV Uploads ----

export async function uploadCSV(file: File, uploadedById: string, source?: string, playerId?: string): Promise<CsvUploadResult> {
  const formData = new FormData();
  formData.append('file', file);

  const params = new URLSearchParams({ uploadedById });
  if (source) params.set('source', source);
  if (playerId) params.set('playerId', playerId);

  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`/api/uploads/csv?${params}`, {
    method: 'POST',
    body: formData,
    headers,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upload failed: ${body}`);
  }

  return res.json();
}

export async function getSupportedSources() {
  return request<{ sources: string[]; note: string }>('/uploads/sources');
}

export interface UploadHistoryEntry {
  id: string;
  uploadedById: string;
  source: string;
  fileUrl: string;
  status: string;
  totalRows: number | null;
  successRows: number | null;
  errorDetails: string | null;
  createdAt: string;
}

export async function getUploadHistory(uploadedById?: string) {
  const qs = uploadedById ? `?uploadedById=${uploadedById}` : '';
  return request<UploadHistoryEntry[]>(`/uploads${qs}`);
}

// ---- Leaderboards ----

export async function getLeaderboard(gradYear: number, metricType: string, limit = 15) {
  const params = new URLSearchParams({
    gradYear: String(gradYear),
    metricType,
    limit: String(limit),
  });
  return request<LeaderboardEntry[]>(`/leaderboards?${params}`);
}

export async function recomputeLeaderboard(gradYear?: number) {
  const qs = gradYear ? `?gradYear=${gradYear}` : '';
  return request<{ status: string }>(`/leaderboards/recompute${qs}`, { method: 'POST' });
}

// ---- Videos ----

export async function getPlayerVideos(playerId: string, category?: string) {
  const qs = category ? `?category=${category}` : '';
  return request<Video[]>(`/videos/player/${playerId}${qs}`);
}

export interface VideoWithPlayer extends Video {
  player: {
    id: string;
    firstName: string;
    lastName: string;
    positions: string;
    gradYear: number | null;
    profilePhoto: string | null;
  };
}

export async function browseVideos(opts?: {
  playerId?: string;
  category?: string;
  gradYears?: number[];
  from?: string;
  to?: string;
}) {
  const params = new URLSearchParams();
  if (opts?.playerId) params.set('playerId', opts.playerId);
  if (opts?.category) params.set('category', opts.category);
  if (opts?.gradYears?.length) params.set('gradYears', opts.gradYears.join(','));
  if (opts?.from) params.set('from', opts.from);
  if (opts?.to) params.set('to', opts.to);
  const qs = params.toString() ? `?${params}` : '';
  return request<VideoWithPlayer[]>(`/videos/browse${qs}`);
}

export async function getVideo(id: string) {
  return request<Video>(`/videos/${id}`);
}

export async function uploadVideo(
  file: File,
  playerId: string,
  title: string,
  category: string,
  uploadedById?: string,
): Promise<Video> {
  const token = getAuthToken();
  const params = new URLSearchParams({ playerId, title, category });
  if (uploadedById) params.set('uploadedById', uploadedById);

  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`/api/videos/upload?${params}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }

  return res.json();
}

// ---- Reports ----

export async function getPlayerReports(playerId: string, reportType?: string) {
  const qs = reportType ? `?type=${reportType}` : '';
  return request<any[]>(`/reports/player/${playerId}${qs}`);
}

export async function getReport(id: string) {
  return request<any>(`/reports/${id}`);
}

export async function createReport(data: {
  playerId: string;
  createdById: string;
  reportType: string;
  title?: string;
  content: string;
  notes?: string;
  videoIds?: string;
}) {
  return request<any>('/reports', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteReport(id: string) {
  return request<any>(`/reports/${id}`, { method: 'DELETE' });
}

/** Backend supports `PATCH /reports/:id` with { title?, content?, notes?, videoIds? }. */
export async function updateReport(
  id: string,
  data: { title?: string; content?: string; notes?: string; videoIds?: string },
) {
  return request<any>(`/reports/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// ---- Training ----

export async function getPlayerPrograms(playerId: string) {
  return request<any[]>(`/training/player/${playerId}`);
}

export async function getTrainingCalendar(playerId: string, year: number, month: number) {
  return request<Record<string, string[]>>(
    `/training/calendar/${playerId}?year=${year}&month=${month}`,
  );
}

// ---- Drill Library ----

export interface Drill {
  id: string;
  name: string;
  tab: string;
  category: string;
  description: string | null;
  videoUrl: string | null;
  createdAt: string;
}

export async function getDrills(tab?: string) {
  const qs = tab ? `?tab=${tab}` : '';
  return request<Drill[]>(`/training/drills${qs}`);
}

export async function searchDrills(query: string, tab?: string) {
  const params = new URLSearchParams({ q: query });
  if (tab) params.set('tab', tab);
  return request<Drill[]>(`/training/drills/search?${params}`);
}

export async function createDrill(data: { name: string; tab: string; category: string; description?: string; videoUrl?: string }) {
  return request<Drill>('/training/drills', { method: 'POST', body: JSON.stringify(data) });
}

export async function uploadDrillVideo(drillId: string, file: File): Promise<Drill> {
  const token = getAuthToken();
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`/api/training/drills/${drillId}/upload-video`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }

  return res.json();
}

export async function updateDrill(id: string, data: { name?: string; tab?: string; category?: string; description?: string; videoUrl?: string }) {
  return request<Drill>(`/training/drills/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteDrill(id: string) {
  return request<void>(`/training/drills/${id}`, { method: 'DELETE' });
}

// ---- Scheduled Drills ----

export interface ScheduledDrill {
  id: string;
  playerId: string;
  drillId: string | null;
  tab: string;
  category: string;
  name: string;
  date: string;
  time: string;
  duration: number;
  notes: string | null;
  createdAt: string;
  drill: Drill | null;
}

export async function getScheduledDrills(playerId: string, opts?: { startDate?: string; endDate?: string; date?: string; tab?: string }) {
  const params = new URLSearchParams();
  if (opts?.startDate) params.set('startDate', opts.startDate);
  if (opts?.endDate) params.set('endDate', opts.endDate);
  if (opts?.date) params.set('date', opts.date);
  if (opts?.tab) params.set('tab', opts.tab);
  const qs = params.toString() ? `?${params}` : '';
  return request<ScheduledDrill[]>(`/training/schedule/${playerId}${qs}`);
}

export async function createScheduledDrill(data: {
  playerId: string;
  drillId?: string;
  tab: string;
  category: string;
  name: string;
  date: string;
  time: string;
  duration: number;
  notes?: string;
}) {
  return request<ScheduledDrill>('/training/schedule', { method: 'POST', body: JSON.stringify(data) });
}

export async function createScheduledDrillsBatch(items: {
  playerId: string;
  drillId?: string;
  tab: string;
  category: string;
  name: string;
  date: string;
  time: string;
  duration: number;
  notes?: string;
}[]) {
  return request<ScheduledDrill[]>('/training/schedule/batch', { method: 'POST', body: JSON.stringify({ items }) });
}

export async function updateScheduledDrill(id: string, data: Partial<ScheduledDrill>) {
  return request<ScheduledDrill>(`/training/schedule/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteScheduledDrill(id: string) {
  return request<void>(`/training/schedule/${id}`, { method: 'DELETE' });
}

// ---- Education: Classes ----

export interface EduClass {
  id: string;
  sport: string;
  level: string;
  name: string;
  desc: string | null;
  description: string | null;
  videoUrl: string | null;
  lessons: number;
  duration: number;
  emoji: string;
}

export async function getClasses(sport?: string, level?: string) {
  const params = new URLSearchParams();
  if (sport) params.set('sport', sport);
  if (level) params.set('level', level);
  const qs = params.toString() ? `?${params}` : '';
  return request<EduClass[]>(`/education/classes${qs}`);
}

export async function getClassById(id: string) {
  return request<EduClass>(`/education/classes/${id}`);
}

export async function createClass(data: Partial<EduClass>) {
  return request<EduClass>('/education/classes', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateClass(id: string, data: Partial<EduClass>) {
  return request<EduClass>(`/education/classes/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteClass(id: string) {
  return request<void>(`/education/classes/${id}`, { method: 'DELETE' });
}

// ---- Education: MLB Players ----

export interface MlbVideo {
  id: string;
  playerId: string;
  title: string;
  category: string;
  url: string | null;
  notes: string | null;
}

export interface MlbPlayer {
  id: string;
  name: string;
  positions: string;
  bats: string | null;
  throws: string | null;
  team: string | null;
  emoji: string;
  videos?: MlbVideo[];
}

export async function getMlbPlayers(filters?: { position?: string; bats?: string; throws?: string }) {
  const params = new URLSearchParams();
  if (filters?.position) params.set('position', filters.position);
  if (filters?.bats) params.set('bats', filters.bats);
  if (filters?.throws) params.set('throws', filters.throws);
  const qs = params.toString() ? `?${params}` : '';
  return request<MlbPlayer[]>(`/education/mlb/players${qs}`);
}

export async function getMlbPlayer(id: string) {
  return request<MlbPlayer>(`/education/mlb/players/${id}`);
}

export async function createMlbPlayer(data: Partial<MlbPlayer>) {
  return request<MlbPlayer>('/education/mlb/players', { method: 'POST', body: JSON.stringify(data) });
}

export async function deleteMlbPlayer(id: string) {
  return request<void>(`/education/mlb/players/${id}`, { method: 'DELETE' });
}

export async function createMlbVideo(data: { playerId: string; title: string; category: string; url?: string; notes?: string }) {
  return request<MlbVideo>('/education/mlb/videos', { method: 'POST', body: JSON.stringify(data) });
}

export async function deleteMlbVideo(id: string) {
  return request<void>(`/education/mlb/videos/${id}`, { method: 'DELETE' });
}

// ---- Games ----

export async function getGameReports(playerId: string, season?: string) {
  const qs = season ? `?season=${season}` : '';
  return request<any[]>(`/games/player/${playerId}${qs}`);
}

export async function createGameReport(data: {
  playerId: string;
  gameDate: string;
  opponent: string;
  stats: string;
  journal?: string;
  season: string;
}) {
  return request<any>('/games', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ─── Posts / Announcements ────────────────────────────────────────
export interface PostItem {
  id: string;
  type: 'FACILITY_ANNOUNCEMENT' | 'ATHLETE_HIGHLIGHT' | 'PROGRAM_ANNOUNCEMENT' | 'COLLEGE_COMMITMENT' | 'PRO_SIGNING';
  title: string;
  body: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  linkUrl: string | null;
  urgency: 'NORMAL' | 'IMPORTANT';
  taggedPlayerId: string | null;
  taggedPlayer: { id: string; firstName: string; lastName: string; positions: string; profilePhoto: string | null } | null;
  collegeName: string | null;
  position: string | null;
  organizationName: string | null;
  level: string | null;
  authorId: string;
  author: { id: string; email: string; role: string };
  createdAt: string;
  updatedAt: string;
}

export async function getPosts(limit = 50, offset = 0): Promise<PostItem[]> {
  return request(`/posts?limit=${limit}&offset=${offset}`);
}

export async function createPost(data: {
  type: string;
  title: string;
  body?: string;
  imageUrl?: string;
  videoUrl?: string;
  linkUrl?: string;
  urgency?: string;
  taggedPlayerId?: string;
  collegeName?: string;
  position?: string;
  organizationName?: string;
  level?: string;
}): Promise<PostItem> {
  return request('/posts', { method: 'POST', body: JSON.stringify(data) });
}

export async function updatePost(id: string, data: {
  type?: string;
  title?: string;
  body?: string;
  imageUrl?: string;
  videoUrl?: string;
  linkUrl?: string;
  urgency?: string;
  taggedPlayerId?: string;
  collegeName?: string;
  position?: string;
  organizationName?: string;
  level?: string;
}): Promise<PostItem> {
  return request(`/posts/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deletePost(id: string): Promise<void> {
  return request(`/posts/${id}`, { method: 'DELETE' });
}

// ---- Analytics / Chart Configs ----

export interface AnalyticsColumn {
  source: string;
  metricType: string;
  unit: string;
}

export interface ChartDataSource {
  source: string;
  metricType: string;
  label?: string;
  color?: string;
}

export interface ChartConfig {
  id: string;
  createdById: string;
  scope: 'PRIVATE' | 'GLOBAL';
  section: string;
  chartType: string;
  title: string;
  dataSources: string; // JSON string
  dateMode: 'ALL_TIME' | 'RANGE' | 'LAST_N_DAYS';
  dateFrom: string | null;
  dateTo: string | null;
  lastNDays: number | null;
  playerScope: 'ALL' | 'INDIVIDUAL' | string;
  playerIds: string | null; // JSON string[] or null
  dataMode: 'DATE_RANGE' | 'REPORTS';
  reportIds: string | null; // JSON string[] or null
  sortOrder: number;
  rollingWindow?: number | null;
  rollingMode?: 'SMA' | 'EMA' | null;
  targetMin?: number | null;
  targetMax?: number | null;
  pbDirection?: 'MAX' | 'MIN' | null;
  zoneGrid?: '3x3' | '5x5' | null;
  zoneMetric?: 'COUNT' | 'AVG' | 'WHIFF' | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChartConfigInput {
  scope?: 'PRIVATE' | 'GLOBAL';
  section: string;
  chartType: string;
  title: string;
  dataSources: ChartDataSource[];
  dateMode?: 'ALL_TIME' | 'RANGE' | 'LAST_N_DAYS';
  dateFrom?: string | null;
  dateTo?: string | null;
  lastNDays?: number | null;
  playerScope?: 'ALL' | 'INDIVIDUAL' | string;
  playerIds?: string[] | null;
  dataMode?: 'DATE_RANGE' | 'REPORTS';
  reportIds?: string[] | null;
  sortOrder?: number;
  rollingWindow?: number | null;
  rollingMode?: 'SMA' | 'EMA' | null;
  targetMin?: number | null;
  targetMax?: number | null;
  pbDirection?: 'MAX' | 'MIN' | null;
  zoneGrid?: '3x3' | '5x5' | null;
  zoneMetric?: 'COUNT' | 'AVG' | 'WHIFF' | null;
}

export async function getAnalyticsColumns(): Promise<AnalyticsColumn[]> {
  return request('/analytics/columns');
}

export async function getChartConfigs(section?: string): Promise<ChartConfig[]> {
  const q = section ? `?section=${encodeURIComponent(section)}` : '';
  return request(`/analytics/configs${q}`);
}

export async function createChartConfig(data: ChartConfigInput): Promise<ChartConfig> {
  return request('/analytics/configs', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateChartConfig(id: string, data: Partial<ChartConfigInput>): Promise<ChartConfig> {
  return request(`/analytics/configs/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteChartConfig(id: string): Promise<void> {
  return request(`/analytics/configs/${id}`, { method: 'DELETE' });
}

export interface ChartEvaluation {
  config: ChartConfig;
  series: Array<{
    source: string;
    metricType: string;
    label: string;
    points: Array<{ date: string; value: number }>;
  }>;
}

export async function evaluateChartConfig(id: string, playerId: string): Promise<ChartEvaluation> {
  return request(`/analytics/configs/${id}/evaluate/${playerId}`);
}

export async function previewChartConfig(playerId: string, data: ChartConfigInput): Promise<ChartEvaluation> {
  return request(`/analytics/preview/${playerId}`, { method: 'POST', body: JSON.stringify(data) });
}

// ──────────────────────────────────────────────────────────────
// Club Teams
// ──────────────────────────────────────────────────────────────

export interface ClubTeam {
  id: string;
  name: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClubTeamInput {
  name: string;
  logoUrl?: string | null;
  websiteUrl?: string | null;
}

export async function getClubTeams(): Promise<ClubTeam[]> {
  return request('/club-teams');
}

export async function createClubTeam(data: ClubTeamInput): Promise<ClubTeam> {
  return request('/club-teams', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateClubTeam(id: string, data: Partial<ClubTeamInput>): Promise<ClubTeam> {
  return request(`/club-teams/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteClubTeam(id: string): Promise<void> {
  return request(`/club-teams/${id}`, { method: 'DELETE' });
}

// ──────────────────────────────────────────────────────────────
// Colleges
// ──────────────────────────────────────────────────────────────

export interface College {
  id: string;
  name: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollegeInput {
  name: string;
  logoUrl?: string | null;
  websiteUrl?: string | null;
}

export async function getColleges(): Promise<College[]> {
  return request('/colleges');
}

export async function createCollege(data: CollegeInput): Promise<College> {
  return request('/colleges', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateCollege(id: string, data: Partial<CollegeInput>): Promise<College> {
  return request(`/colleges/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteCollege(id: string): Promise<void> {
  return request(`/colleges/${id}`, { method: 'DELETE' });
}
