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
  /** JSON-encoded map of `{ [aggregateSectionKey]: notesText }` rendered
   *  as per-section Notes bubbles under the Tool Grades panel on the
   *  Player Summary tab. Coach-editable; player view is read-only. */
  developmentNotes?: string | null;
  playingLevelGoal?: string | null;
  goals?: string | null;
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
  coachLevel?: string | null; // "ADMIN" | "COACH" | "VIEWER" | null (players)
  status: string; // "ACTIVE" | "PENDING" | "DECLINED"
  name?: string | null;
  playerId: string | null;
}

export async function login(email: string, password: string) {
  return request<AuthResponse>(
    '/auth/login',
    { method: 'POST', body: JSON.stringify({ email, password }) },
  );
}

export interface AccountProfile {
  id: string;
  email: string;
  role: string;
  coachLevel: string | null; // "ADMIN" | "COACH" | "VIEWER" | null (players)
  status: string;
  name: string | null;
  phone: string | null;
  position: string | null;
  isPrimaryAdmin: boolean;
  playerId: string | null;
}

export async function getMe() {
  return request<AccountProfile>('/auth/me');
}

export async function register(
  email: string,
  password: string,
  role: string,
  coachLevel?: string, // for COACH accounts: "ADMIN" | "COACH" | "VIEWER"
  name?: string,       // optional display name (First Last)
) {
  return request<AuthResponse>(
    '/auth/register',
    { method: 'POST', body: JSON.stringify({ email, password, role, coachLevel, name }) },
  );
}

/** Update editable account fields (Settings → Account). */
export async function updateAccount(dto: {
  name?: string | null;
  phone?: string | null;
  position?: string | null;
  email?: string | null;
}) {
  return request<AccountProfile>('/auth/account', {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

/** Change the current user's password (requires the current one). */
export async function changePassword(currentPassword: string, newPassword: string) {
  return request<{ ok: boolean }>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

/** Coach sets another account's password (player reset from the athlete
 *  profile, coach reset from Settings → Staff). Primary admin is self-only. */
export async function setUserPassword(userId: string, newPassword: string) {
  return request<{ ok: boolean }>(`/auth/users/${userId}/set-password`, {
    method: 'POST',
    body: JSON.stringify({ newPassword }),
  });
}

/** Coach changes a player account's login email (from the athlete profile). */
export async function setUserEmail(userId: string, email: string) {
  return request<{ ok: boolean; email: string }>(`/auth/users/${userId}/email`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

/** Set another account's display name (admin for anyone; self allowed). */
export async function setUserName(userId: string, name: string) {
  return request<{ ok: boolean; name: string }>(`/auth/users/${userId}/name`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

// ---- Notification channel preferences ----

export interface NotifChannelPrefs {
  app: boolean;
  email: boolean;
  phone: boolean;
}
/** Map of subject (= notification type) → per-channel on/off. */
export type NotificationPrefs = Record<string, NotifChannelPrefs>;

export async function getNotificationPrefs() {
  return request<NotificationPrefs>('/auth/notification-prefs');
}

export async function setNotificationPrefs(prefs: NotificationPrefs) {
  return request<{ ok: boolean }>('/auth/notification-prefs', {
    method: 'PUT',
    body: JSON.stringify(prefs),
  });
}

export interface CoachAccount {
  id: string;
  email: string;
  name: string | null;
  position: string | null;
  isPrimaryAdmin: boolean;
  coachLevel: string | null; // "ADMIN" | "COACH" | "VIEWER"
  createdAt: string;
}

/** List all coach accounts (coach-only endpoint). */
export async function getCoaches() {
  return request<CoachAccount[]>('/auth/coaches');
}

/** Admin: set a coach's access level (ADMIN / COACH / VIEWER). */
export async function setCoachLevel(userId: string, level: 'ADMIN' | 'COACH' | 'VIEWER') {
  return request<{ ok: boolean; coachLevel: string }>(`/auth/users/${userId}/coach-level`, {
    method: 'POST',
    body: JSON.stringify({ level }),
  });
}

// ---- Player self-registration + approval ----

export interface SignupPlayerInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  positions: string; // comma-separated, e.g. "INF,OF"
  heightInches?: number | null;
  weightLbs?: number | null;
  gradYear?: number | null;
  bats?: string | null;
  throws?: string | null;
  birthDate?: string | null;
  highSchool?: string | null;
  clubTeam?: string | null;
  collegeCommit?: string | null;
  pbrNational?: number | null;
  pbrState?: number | null;
  pbrPosition?: number | null;
  pgScore?: number | null;
}

/** Public player self-registration → pending account + a session token. */
export async function signupPlayer(input: SignupPlayerInput) {
  return request<AuthResponse>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface PendingPlayer {
  id: string; // the pending userId
  email: string;
  createdAt: string;
  playerId: string | null;
  firstName: string | null;
  lastName: string | null;
  positions: string | null;
  gradYear: number | null;
}

/** Pending player accounts awaiting approval (coach-only). */
export function getPendingPlayers() {
  return request<PendingPlayer[]>('/auth/pending');
}

export function approvePlayer(userId: string) {
  return request<{ ok: boolean; status: string }>(`/auth/pending/${userId}/approve`, {
    method: 'POST',
  });
}

export function declinePlayer(userId: string) {
  return request<{ ok: boolean }>(`/auth/pending/${userId}/decline`, { method: 'POST' });
}

// ---- Notifications ----

export type NotificationType =
  | 'ACCOUNT_REQUEST'
  | 'ANNOUNCEMENT'
  | 'COMMITMENT'
  | 'COACH_REVIEW'
  | 'REPORT'
  | 'VIDEO'
  | 'SCHEDULE';

export interface AppNotification {
  id: string;
  recipientId: string;
  type: NotificationType;
  title: string;
  body: string | null;
  linkUrl: string | null;
  actorId: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export function getNotifications(limit = 50) {
  return request<AppNotification[]>(`/notifications?limit=${limit}`);
}

export function getUnreadNotificationCount() {
  return request<{ count: number }>('/notifications/unread-count');
}

export function markNotificationRead(id: string) {
  return request<{ ok: boolean }>(`/notifications/${id}/read`, { method: 'POST' });
}

export function markAllNotificationsRead() {
  return request<{ ok: boolean }>('/notifications/read-all', { method: 'POST' });
}

// ---- Players ----

/* Grad-year sentinels for athletes past high school. Stored in the numeric
   gradYear field so the leaderboard's existing numeric grouping keeps working;
   formatGradYear maps them back to labels for display. */
export const GRAD_COLLEGE = 9001;
export const GRAD_PRO = 9002;
export function formatGradYear(y: number | null | undefined): string {
  if (y == null) return '—';
  if (y === GRAD_COLLEGE) return 'College';
  if (y === GRAD_PRO) return 'Professional';
  return String(y);
}
export function gradYearShort(y: number | null | undefined): string {
  if (y == null) return '';
  if (y === GRAD_COLLEGE) return 'College';
  if (y === GRAD_PRO) return 'Pro';
  return `'${String(y).slice(-2)}`;
}

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
  /** True for pitches rebuilt from a Trackman PDF report (table-driven, not
   *  per-pitch tracked) — the Pitching tab renders these non-interactive. */
  pdfSource?: boolean;
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

export interface TrackmanPdfResult {
  message: string;
  uploadId: string;
  totalRows: number;
  metricsCreated: number;
  pitchTypes: string[];
}

/**
 * Upload a Trackman session-report PDF for a player. The backend reads the
 * summary table and rebuilds non-interactive `trackman_pitch` rows scoped to
 * the returned uploadId (so the owning report can filter the Pitching tab).
 */
export async function uploadTrackmanPdf(file: File, uploadedById: string, playerId: string): Promise<TrackmanPdfResult> {
  const formData = new FormData();
  formData.append('file', file);

  const params = new URLSearchParams({ uploadedById, playerId });

  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`/api/uploads/trackman-pdf?${params}`, {
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

/** Distinct grad years present, for the leaderboard filter dropdown. Returns
 *  just the year numbers (no player data) so PLAYERS can build the dropdown
 *  too — the coach-only player list otherwise left their leaderboard blank. */
export async function getLeaderboardGradYears() {
  return request<number[]>('/leaderboards/grad-years');
}

/** A single row of the per-player rank summary — the player's leaderboard
 *  position for one metric within their grad-year class. */
export interface PlayerRank {
  metricType: string;
  value: number;
  rank: number;
  outOf: number;
  gradYear: number;
}

/** Every leaderboard metric the player qualifies for, with their rank
 *  within their grad-year class. Used by the player profile's "Class
 *  Rankings" widget to surface the data without leaving the profile. */
export async function getPlayerRank(playerId: string) {
  return request<PlayerRank[]>(`/leaderboards/player/${playerId}`);
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

/** Bunny TUS presign bundle returned by POST /videos/bunny-presign. */
interface BunnyPresign {
  guid: string;
  endpoint: string;
  signature: string;
  expiration: number;
  libraryId: string;
}

/**
 * Upload a video. In production this goes BROWSER-DIRECT to Bunny via the TUS
 * resumable protocol — the file never lands in the API's memory (so there's no
 * 500MB/RAM ceiling) and the upload resumes if a flaky mobile connection drops.
 * If the direct path is unavailable (local dev: Bunny isn't configured and
 * /bunny-presign returns 503) or errors for any reason, it transparently falls
 * back to the buffered server-side POST /videos/upload — so uploads always
 * succeed and the call sites never change.
 *
 * `onProgress` (0-100) is optional and only reported on the direct path.
 */
export async function uploadVideo(
  file: File,
  playerId: string,
  title: string,
  category: string,
  uploadedById?: string,
  onProgress?: (pct: number) => void,
): Promise<Video> {
  try {
    return await uploadVideoDirectToBunny(file, playerId, title, category, uploadedById, onProgress);
  } catch (err) {
    // Bunny not configured (dev → 503) or the direct path errored — fall back
    // to the buffered upload so the action still succeeds (small files / dev).
    console.warn('[uploadVideo] direct Bunny upload unavailable, using buffered fallback:', err);
    return uploadVideoBuffered(file, playerId, title, category, uploadedById);
  }
}

async function uploadVideoDirectToBunny(
  file: File,
  playerId: string,
  title: string,
  category: string,
  uploadedById: string | undefined,
  onProgress?: (pct: number) => void,
): Promise<Video> {
  const token = getAuthToken();
  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  // 1. Server creates the Bunny video object + signs a short-lived TUS token.
  //    A 503 here (Bunny not configured, e.g. dev) bubbles up to the fallback.
  const presignRes = await fetch('/api/videos/bunny-presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ title }),
  });
  if (!presignRes.ok) throw new Error(`bunny-presign ${presignRes.status}`);
  const presign = (await presignRes.json()) as BunnyPresign;

  // 2. Push the bytes STRAIGHT to Bunny (resumable; never touches our API).
  //    Dynamic import keeps tus-js-client out of the SSR/server bundle.
  const tus = await import('tus-js-client');
  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: presign.endpoint,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        AuthorizationSignature: presign.signature,
        AuthorizationExpire: String(presign.expiration),
        VideoId: presign.guid,
        LibraryId: String(presign.libraryId),
      },
      metadata: { filetype: file.type || 'video/mp4', title },
      onError: reject,
      onProgress: (sent: number, total: number) => {
        if (onProgress && total > 0) onProgress(Math.round((sent / total) * 100));
      },
      onSuccess: () => resolve(),
    });
    upload.start();
  });

  // 3. Finalize: server creates the READY Video row pointing at the guid.
  const completeRes = await fetch('/api/videos/bunny-complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ guid: presign.guid, playerId, title, category, uploadedById }),
  });
  if (!completeRes.ok) {
    const body = await completeRes.text();
    throw new Error(`bunny-complete ${completeRes.status}: ${body}`);
  }
  return completeRes.json();
}

async function uploadVideoBuffered(
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

/**
 * Upload a standalone video file and get back its URL — no Video DB
 * record is created. Used by the MLB clip library (Education → Major
 * League Video), where clips are stored as MlbVideo rows that just need
 * a playable `url`.
 */
export async function uploadVideoFile(file: File): Promise<{ url: string }> {
  const token = getAuthToken();
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/videos/upload-file', {
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
  /** Cover photo as a base64 data URL string. When present,
   *  the player's card thumb + detail-page avatar render the
   *  image instead of the `emoji` icon. Uploaded by coaches
   *  via clicking the avatar/thumb in the Coaching App. */
  coverImageUrl?: string | null;
  heightInches?: number | null;
  weightLbs?: number | null;
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

export async function updateMlbPlayer(id: string, data: Partial<MlbPlayer>) {
  return request<MlbPlayer>(`/education/mlb/players/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteMlbPlayer(id: string) {
  return request<void>(`/education/mlb/players/${id}`, { method: 'DELETE' });
}

export async function createMlbVideo(data: { playerId: string; title: string; category: string; url?: string; notes?: string }) {
  return request<MlbVideo>('/education/mlb/videos', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateMlbVideo(id: string, data: { title?: string; category?: string; url?: string; notes?: string }) {
  return request<MlbVideo>(`/education/mlb/videos/${id}`, { method: 'PUT', body: JSON.stringify(data) });
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
  cohortEnabled?: boolean | null;
  cohortMode?: 'GRAD_YEAR' | 'POSITION' | 'ALL' | null;
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
  cohortEnabled?: boolean | null;
  cohortMode?: 'GRAD_YEAR' | 'POSITION' | 'ALL' | null;
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
    /** When true this series is the class-average overlay, not the focal athlete. */
    cohort?: boolean;
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

// ---- Live Sessions ----
/* Coach-led capture flows backed by the LiveSessionsModule on the API.
 * Two modes share the same surface:
 *   • TRAINING — one row per athlete on each clip recorded; clips
 *                attach to the player on session-end save.
 *   • LIVE     — per-batter at-bats with pitch-by-pitch tracking;
 *                video is optional per at-bat. (Phase 3+.) */

export type LiveSessionMode = 'TRAINING' | 'LIVE';
export type LiveSessionStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface LiveSession {
  id: string;
  createdById: string;
  mode: LiveSessionMode;
  position: string | null;
  status: LiveSessionStatus;
  startedAt: string;
  endedAt: string | null;
  notes: string | null;
}

export interface LiveSessionDetail extends LiveSession {
  trainingClips: TrainingClipDetail[];
  atBats: unknown[]; // shape filled in Phase 3
}

export interface TrainingClipDetail {
  id: string;
  liveSessionId: string;
  playerId: string;
  videoId: string | null;
  savedToReportId: string | null;
  recordedAt: string;
  player: { id: string; firstName: string; lastName: string; positions: string | null; profilePhoto: string | null };
  video: { id: string; originalUrl: string | null; hlsUrl: string | null; thumbnailUrl: string | null; status: string } | null;
}

export async function createLiveSession(input: {
  mode: LiveSessionMode;
  position?: string;
  notes?: string;
}): Promise<LiveSession> {
  return request('/live-sessions', { method: 'POST', body: JSON.stringify(input) });
}

export async function getLiveSession(id: string): Promise<LiveSessionDetail> {
  return request(`/live-sessions/${id}`);
}

export async function getRecentLiveSessions(limit = 25): Promise<(LiveSession & { _count: { trainingClips: number; atBats: number } })[]> {
  return request(`/live-sessions?limit=${limit}`);
}

export async function updateLiveSession(
  id: string,
  input: { notes?: string; status?: LiveSessionStatus },
): Promise<LiveSession> {
  return request(`/live-sessions/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export async function endLiveSession(id: string): Promise<LiveSession> {
  return request(`/live-sessions/${id}/end`, { method: 'POST' });
}

// ── Training Clips (nested under live-sessions) ──

export async function createTrainingClip(
  sessionId: string,
  input: { playerId: string; videoId?: string; savedToReportId?: string },
): Promise<TrainingClipDetail> {
  return request(`/live-sessions/${sessionId}/training-clips`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateTrainingClip(
  clipId: string,
  input: { videoId?: string | null; savedToReportId?: string | null },
): Promise<TrainingClipDetail> {
  return request(`/live-sessions/training-clips/${clipId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteTrainingClip(clipId: string): Promise<void> {
  return request(`/live-sessions/training-clips/${clipId}`, { method: 'DELETE' });
}

// ── At-Bats + Pitches (LIVE-mode capture) ──

export const PITCH_TYPES = [
  'FASTBALL', 'SINKER', 'CUTTER', 'SLIDER', 'CURVEBALL',
  'SWEEPER', 'CHANGEUP', 'SPLITTER', 'KNUCKLEBALL',
] as const;
export type PitchType = (typeof PITCH_TYPES)[number];

export const PITCH_RESULTS = [
  'STRIKE_LOOKING', 'STRIKE_SWINGING', 'STRIKE_OUT_LOOKING', 'STRIKE_OUT_SWINGING',
  'FOUL', 'BALL', 'FLY_BALL', 'GROUND_BALL', 'LINE_DRIVE', 'BARREL', 'WALK',
] as const;
export type PitchResult = (typeof PITCH_RESULTS)[number];

/** Pitch results that terminate the at-bat — closing it should
 *  set the AB outcome and stamp endedAt. */
export const TERMINAL_PITCH_RESULTS: ReadonlySet<PitchResult> = new Set<PitchResult>([
  'STRIKE_OUT_LOOKING', 'STRIKE_OUT_SWINGING',
  'FLY_BALL', 'GROUND_BALL', 'LINE_DRIVE', 'BARREL',
  'WALK',
]);

/** Quality-of-contact options for balls in play — a separate dimension
 *  from the batted-ball type (LINE_DRIVE / FLY_BALL / GROUND_BALL). The
 *  coach picks one after the in-play result and before the spray
 *  location. Barrel% across balls in play derives from these. Legacy
 *  ABs that recorded a BARREL `outcome` keep that and have no QoC. */
export const QUALITY_OF_CONTACT = ['BARREL', 'JAM', 'CAP'] as const;
export type QualityOfContact = (typeof QUALITY_OF_CONTACT)[number];

export interface AtBat {
  id: string;
  liveSessionId: string | null;
  hitterId: string;
  pitcherId: string | null;
  pitcherHandedness: string | null;
  reportId: string | null;
  videoId: string | null;
  outcome: string | null;
  /** Normalized spray-chart coordinates set when the coach taps
   *  the live-tracker mini field for in-play outcomes (BARREL /
   *  FLY_BALL / GROUND_BALL / LINE_DRIVE). Both values in [0,1]
   *  where x is horizontal (0 = pull-side foul, 1 = oppo-side
   *  foul) and y is depth (0 = home plate, 1 = deep outfield).
   *  Null for K / BB / in-progress. */
  sprayX: number | null;
  sprayY: number | null;
  /** Quality of contact for balls in play — separate from the batted-ball
   *  type in `outcome`. "BARREL" | "JAM" | "CAP" | null. Null for legacy
   *  ABs (which may carry BARREL in `outcome` instead), K / BB, and
   *  in-progress at-bats. */
  qualityOfContact: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface AtBatDetail extends AtBat {
  hitter:  { id: string; firstName: string; lastName: string; positions: string | null };
  pitcher: { id: string; firstName: string; lastName: string; positions: string | null; throws: string | null } | null;
  pitches: Pitch[];
}

export interface Pitch {
  id: string;
  atBatId: string;
  pitchNumber: number;
  pitchType: string;
  callBallStrike: string | null;
  result: string | null;
  recordedAt: string;
}

export async function createAtBat(sessionId: string, input: {
  hitterId: string;
  pitcherId?: string | null;
  pitcherHandedness?: string | null;
}): Promise<AtBat> {
  return request(`/live-sessions/${sessionId}/at-bats`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateAtBat(atBatId: string, input: {
  outcome?: string | null;
  endedAt?: string | null;
  reportId?: string | null;
  videoId?: string | null;
}): Promise<AtBat> {
  return request(`/live-sessions/at-bats/${atBatId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function closeAtBat(
  atBatId: string,
  outcome: string,
  spray?: { x: number; y: number } | null,
  qualityOfContact?: string | null,
): Promise<AtBat> {
  return request(`/live-sessions/at-bats/${atBatId}/close`, {
    method: 'POST',
    body: JSON.stringify({
      outcome,
      sprayX: spray?.x ?? null,
      sprayY: spray?.y ?? null,
      qualityOfContact: qualityOfContact ?? null,
    }),
  });
}

export async function deleteAtBat(atBatId: string): Promise<void> {
  return request(`/live-sessions/at-bats/${atBatId}`, { method: 'DELETE' });
}

export async function listAtBats(filters: {
  hitterId?: string;
  pitcherId?: string;
  pitcherHandedness?: 'L' | 'R';
  limit?: number;
  since?: string;
}): Promise<AtBatDetail[]> {
  const params = new URLSearchParams();
  if (filters.hitterId)          params.set('hitterId', filters.hitterId);
  if (filters.pitcherId)         params.set('pitcherId', filters.pitcherId);
  if (filters.pitcherHandedness) params.set('pitcherHandedness', filters.pitcherHandedness);
  if (filters.limit)             params.set('limit', String(filters.limit));
  if (filters.since)             params.set('since', filters.since);
  return request(`/live-sessions/at-bats?${params}`);
}

export async function createPitch(atBatId: string, input: {
  pitchType: PitchType | string;
  callBallStrike?: 'BALL' | 'STRIKE' | null;
  result?: PitchResult | string | null;
}): Promise<Pitch> {
  return request(`/live-sessions/at-bats/${atBatId}/pitches`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updatePitch(pitchId: string, input: {
  pitchType?: PitchType | string;
  callBallStrike?: 'BALL' | 'STRIKE' | null;
  result?: PitchResult | string | null;
}): Promise<Pitch> {
  return request(`/live-sessions/pitches/${pitchId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deletePitch(pitchId: string): Promise<void> {
  return request(`/live-sessions/pitches/${pitchId}`, { method: 'DELETE' });
}

// ---- Direct Messages ----

export interface MessageContact {
  id: string;
  name: string;
  role: 'COACH' | 'PLAYER';
  photo: string | null;
}

export interface DirectMessage {
  id: string;
  senderId: string;
  recipientId: string;
  body: string | null;
  videoUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface Conversation {
  user: MessageContact;
  lastMessage: DirectMessage;
  unreadCount: number;
}

export interface MessageThread {
  user: MessageContact;
  messages: DirectMessage[];
}

/** Directory of users the current user may start a conversation with. */
export function getMessageContacts(): Promise<MessageContact[]> {
  return request('/messages/contacts');
}

/** The current user's conversations (latest message + unread count each). */
export function getConversations(): Promise<Conversation[]> {
  return request('/messages/conversations');
}

/** Total unread messages for the current user (drives the bell badge). */
export function getUnreadMessageCount(): Promise<{ count: number }> {
  return request('/messages/unread-count');
}

/** Full history with another user; opening it marks their messages read. */
export function getMessageThread(userId: string): Promise<MessageThread> {
  return request(`/messages/thread/${userId}`);
}

/** Send a message (text and/or an attached video URL) to another user. */
export function sendMessage(input: {
  recipientId: string;
  body?: string;
  videoUrl?: string;
}): Promise<DirectMessage> {
  return request('/messages', { method: 'POST', body: JSON.stringify(input) });
}
