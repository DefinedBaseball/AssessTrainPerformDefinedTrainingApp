'use client';

import { rem } from '@/lib/rem';
import { useMemo, useState } from 'react';
import { Section, SectionHeader, VideoPlaceholder } from '@/components/assessment';
import type { TabProps, ReportSummary } from '../helpers';
import * as api from '@/lib/api';

interface CoachingMeta {
  title?: string;
  primaryVideoTitle?: string;
  compareVideoTitle?: string;
  annotationCount?: number;
  voiceOverCount?: number;
  durationSec?: number;
  notes?: string;
}

function parseCoachingMeta(report: ReportSummary): CoachingMeta {
  if (!report.content) return {};
  try {
    const c = JSON.parse(report.content);
    return {
      title: c.title,
      primaryVideoTitle: c.primaryVideoTitle,
      compareVideoTitle: c.compareVideoTitle,
      annotationCount: Array.isArray(c.annotations) ? c.annotations.length : 0,
      voiceOverCount: Array.isArray(c.voiceOvers) ? c.voiceOvers.length : 0,
      durationSec: typeof c.durationSec === 'number' ? c.durationSec : undefined,
      notes: c.notes,
    };
  } catch { return {}; }
}

export function CoachingLibrary({
  player, videos, reports, isCoach, onRefresh,
}: TabProps) {
  const coachingReports = useMemo(
    () => reports.filter(r => r.reportType === 'COACHING')
                 .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [reports],
  );
  const readyVideos = useMemo(
    () => videos.filter(v => v.status === 'READY' || v.originalUrl || v.hlsUrl),
    [videos],
  );

  const [deleting, setDeleting] = useState<string | null>(null);
  async function deleteSession(id: string) {
    if (!confirm('Delete this coaching session? This cannot be undone.')) return;
    setDeleting(id);
    try {
      await api.deleteReport(id);
      onRefresh?.();
    } catch (e) {
      alert('Failed to delete: ' + (e as Error).message);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      {/* ── Coaching Sessions (positioned ABOVE the videos section) ── */}
      <Section>
        <SectionHeader
          icon="🎬"
          iconColor="gold"
          title="Coaching"
          subtitle={`${coachingReports.length} saved session${coachingReports.length === 1 ? '' : 's'} · ${player.firstName} ${player.lastName}`}
        />

        {/* "Open Coaching Studio" button retired — Studio's
            authoring features (mic-narrated Coach Review recording,
            drawing tools, compare, sync/unsync grid playback) now
            live inside the bundle modal that opens from any video
            tile, so a dedicated entry point isn't needed. The
            Library below still surfaces every historical COACHING
            report so coaches can browse what they saved from the
            old Studio. */}

        {coachingReports.length === 0 ? (
          <div style={{
            padding: '32px 24px',
            border: '1px dashed var(--border)',
            borderRadius: 12,
            color: 'var(--text-muted)',
            fontSize: rem(14),
            textAlign: 'center',
          }}>
            No coaching sessions yet.
            {isCoach
              ? ' Click "Open Coaching Studio" to record analysis with drawings, frame review, and voice-over.'
              : ' Sessions saved by your coach will appear here.'}
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 14,
          }}>
            {coachingReports.map(r => {
              const meta = parseCoachingMeta(r);
              const created = new Date(r.createdAt).toLocaleDateString(undefined,
                { month: 'short', day: 'numeric', year: 'numeric' });
              return (
                <div key={r.id} style={{
                  background: 'rgba(255,255,255,0.025)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  minHeight: 160,
                  position: 'relative',
                }}>
                  <div style={{
                    fontSize: rem(9.5), fontWeight: 700, letterSpacing: '0.20em',
                    textTransform: 'uppercase', color: 'rgba(126,182,255,0.85)',
                  }}>
                    Coaching Session
                  </div>
                  <div style={{ fontSize: rem(15), fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>
                    {meta.title || `Session — ${created}`}
                  </div>
                  <div style={{ fontSize: rem(11), color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    {meta.primaryVideoTitle && <div>📹 {meta.primaryVideoTitle}</div>}
                    {meta.compareVideoTitle && <div>↔︎ Compare: {meta.compareVideoTitle}</div>}
                    {(meta.annotationCount ?? 0) > 0 && <div>✏️ {meta.annotationCount} annotation{meta.annotationCount === 1 ? '' : 's'}</div>}
                    {(meta.voiceOverCount ?? 0) > 0 && <div>🎤 {meta.voiceOverCount} voice-over{meta.voiceOverCount === 1 ? '' : 's'}</div>}
                  </div>
                  {(r.notes || meta.notes) && (
                    <div style={{
                      fontSize: rem(12), color: 'var(--text-muted)', fontStyle: 'italic',
                      paddingTop: 6, borderTop: '1px solid var(--border)',
                      lineHeight: 1.45, maxHeight: 60, overflow: 'hidden',
                    }}>
                      {r.notes || meta.notes}
                    </div>
                  )}
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginTop: 'auto', paddingTop: 6,
                  }}>
                    <span style={{ fontSize: rem(10), color: 'var(--text-muted)' }}>
                      {created}{r.createdBy?.email ? ` · ${r.createdBy.email.split('@')[0]}` : ''}
                    </span>
                    {isCoach && (
                      <button
                        type="button"
                        onClick={() => deleteSession(r.id)}
                        disabled={deleting === r.id}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--text-muted)', fontSize: rem(11),
                          opacity: deleting === r.id ? 0.4 : 0.7,
                        }}
                        title="Delete session"
                      >
                        {deleting === r.id ? '…' : '🗑'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── Standard Videos library (below the Coaching section) ── */}
      <Section>
        <SectionHeader
          icon="🎥"
          iconColor="teal"
          title="All Videos"
          subtitle={`${readyVideos.length} clip${readyVideos.length === 1 ? '' : 's'} on file`}
        />
        {readyVideos.length === 0 ? (
          <div style={{
            padding: '32px 24px',
            border: '1px dashed var(--border)',
            borderRadius: 12,
            color: 'var(--text-muted)',
            fontSize: rem(14),
            textAlign: 'center',
          }}>
            No videos uploaded yet.
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 12,
          }}>
            {readyVideos.map(v => (
              <VideoPlaceholder
                key={v.id}
                tag={v.category}
                title={v.title}
                subtitle={new Date(v.createdAt).toLocaleDateString()}
                videoUrl={v.originalUrl || v.hlsUrl}
              />
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
