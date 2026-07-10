'use client';

import { rem } from '@/lib/rem';
import { useEffect, useState, useMemo, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { EduClass, Drill, MlbPlayer, MlbVideo } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import aStyles from '@/components/assessment/assessment.module.css';
import styles from './page.module.css';
import { DRILL_TAXONOMY } from '@/lib/drill-taxonomy.generated';

/* Unified app-wide section identity palette:
     Hitting  → Blue, Pitching → Orange,
     Catching → Turquoise, Infield → Green, Outfield → Green,
     S&C → Red, Cognition → Yellow.                                   */
const SPORTS = [
  { id: 'hitting',  label: 'Hitting',   color: '#3B82F6' },
  { id: 'pitching', label: 'Pitching',  color: '#F59E0B' },
  { id: 'catching', label: 'Catching',  color: '#14B8A6' },
  { id: 'infield',  label: 'Infield',   color: '#22C55E' },
  { id: 'outfield', label: 'Outfield',  color: '#22C55E' },
  { id: 'strength', label: 'S&C',       color: '#EF4444' },
];

const LEVELS = [
  { id: 'beginner', label: 'Beginner', cls: styles.levelBeginner },
  { id: 'intermediate', label: 'Intermediate', cls: styles.levelIntermediate },
  { id: 'advanced', label: 'Advanced', cls: styles.levelAdvanced },
  { id: 'expert', label: 'Expert', cls: styles.levelExpert },
];

/* Secondary tabs per primary tab — DERIVED from the generated taxonomy
   (single source of truth shared with Training + Program). */
const DRILL_CATS: Record<string, { id: string; label: string }[]> =
  Object.fromEntries(
    Object.entries(DRILL_TAXONOMY).map(([tab, cats]): [string, { id: string; label: string }[]] => [
      tab,
      cats.map((c) => ({ id: c.id, label: c.id })),
    ]),
  );

const POSITIONS = ['Hitter', 'Pitcher', 'Catcher', 'Infield', 'Outfield'];
/* Fielding positions whose handedness is a simple L/R throw (vs. a pitcher's
   LHP/RHP). Drives the conditional Bats/Throws fields in the MLB player form. */
const FIELDER_POSITIONS = ['Catcher', 'Infield', 'Outfield'];

/* MLB video categories are DERIVED from the player's listed positions rather
   than picked from a fixed list. Every position-player also hits, so Catcher,
   Infield, and Outfield each contribute a Hitting category alongside their
   fielding one; only Pitcher is hitting-exempt. A single-category player
   (e.g. Sonny Gray = Pitcher only → Pitching) gets that one auto-assigned with
   no dropdown; a multi-category player (e.g. Shohei = Hitter+Pitcher, or any
   fielder who also hits) gets a category picker. */
const POSITION_VIDEO_CATEGORIES: Record<string, string[]> = {
  Hitter: ['Hitting'],
  Pitcher: ['Pitching'],
  Catcher: ['Catching', 'Hitting'],
  Infield: ['Fielding', 'Hitting'],
  Outfield: ['Fielding', 'Hitting'],
};
const VIDEO_CATEGORY_ORDER = ['Hitting', 'Pitching', 'Catching', 'Fielding'];

function parsePositions(positions?: string | null): string[] {
  return (positions || '').split(',').map(s => s.trim()).filter(Boolean);
}

function videoCategoriesForPositions(positions?: string | null): string[] {
  const cats = parsePositions(positions).flatMap(p => POSITION_VIDEO_CATEGORIES[p] || []);
  const unique = [...new Set(cats)].sort(
    (a, b) => VIDEO_CATEGORY_ORDER.indexOf(a) - VIDEO_CATEGORY_ORDER.indexOf(b),
  );
  return unique.length ? unique : ['Highlight'];
}

type Page = 'landing' | 'classes' | 'classDetail' | 'drills' | 'mlb' | 'player';

export default function EducationPage() {
  const { user, isCoach } = useAuth();
  const [page, setPage] = useState<Page>('landing');
  const [search, setSearch] = useState('');

  // Data
  const [classes, setClasses] = useState<EduClass[]>([]);
  const [drills, setDrills] = useState<Drill[]>([]);
  const [mlbPlayers, setMlbPlayers] = useState<MlbPlayer[]>([]);
  const [currentPlayer, setCurrentPlayer] = useState<MlbPlayer | null>(null);
  const [currentClass, setCurrentClass] = useState<EduClass | null>(null);

  // Filters
  const [classSport, setClassSport] = useState('hitting');
  const [classLevel, setClassLevel] = useState('all');
  const [drillSport, setDrillSport] = useState('hitting');
  /* Default to "Movement Prep" so the Drill Library lands directly on
     coach-friendly content instead of the firehose "All" view. Every
     sport in `DRILL_CATS` has "Movement Prep" as its first category,
     so this default is universal regardless of which sport is
     selected on mount. The "All" filter is still available — it just
     sits at the END of the category strip now (see the filter row
     in `DrillsView` below). */
  const [drillCat, setDrillCat] = useState('Movement Prep');
  const [mlbPos, setMlbPos] = useState('all');
  const [mlbBats, setMlbBats] = useState('all');
  const [mlbThrows, setMlbThrows] = useState('all');
  const [videoFilter, setVideoFilter] = useState('all');

  // Modals
  const [showClassModal, setShowClassModal] = useState(false);
  const [showDrillModal, setShowDrillModal] = useState(false);
  const [showPlayerModal, setShowPlayerModal] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState(false);

  // Load data on mount
  useEffect(() => {
    if (!user) return;
    api.getClasses().then(setClasses).catch(() => {});
    api.getDrills().then(setDrills).catch(() => {});
    api.getMlbPlayers().then(setMlbPlayers).catch(() => {});
  }, [user]);

  /* Reset to landing whenever the user clicks the Education sidebar
     link while already on this route (Sidebar fires a 'sidebar-nav-home'
     custom event with the target href). */
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { href: string } | undefined;
      if (detail?.href === '/education') {
        setPage('landing');
        setSearch('');
        setCurrentPlayer(null);
        setCurrentClass(null);
      }
    };
    window.addEventListener('sidebar-nav-home', handler);
    return () => window.removeEventListener('sidebar-nav-home', handler);
  }, []);

  const goTo = (p: Page, id?: string) => {
    setPage(p);
    setSearch('');
    if (p === 'player' && id) {
      api.getMlbPlayer(id).then(setCurrentPlayer).catch(() => {});
    }
    if (p === 'classDetail' && id) {
      api.getClassById(id).then(setCurrentClass).catch(() => {});
    }
  };

  if (!user) return null;

  return (
    <div className={styles.page}>
      {/* Breadcrumb */}
      {page !== 'landing' && (
        <div className={styles.breadcrumb}>
          <button className={styles.bcLink} onClick={() => goTo('landing')}>Education</button>
          <span className={styles.bcSep}>/</span>
          {page === 'player' ? (
            <>
              <button className={styles.bcLink} onClick={() => goTo('mlb')}>Major League Video</button>
              <span className={styles.bcSep}>/</span>
              <span className={styles.bcCurrent}>{currentPlayer?.name || 'Player'}</span>
            </>
          ) : page === 'classDetail' ? (
            <>
              <button className={styles.bcLink} onClick={() => goTo('classes')}>Classes</button>
              <span className={styles.bcSep}>/</span>
              <span className={styles.bcCurrent}>{currentClass?.name || 'Class'}</span>
            </>
          ) : (
            <span className={styles.bcCurrent}>
              {page === 'classes' ? 'Classes' : page === 'drills' ? 'Drill Library' : 'Major League Video'}
            </span>
          )}
        </div>
      )}

      {/* Pages */}
      {page === 'landing' && (
        <LandingView
          classCount={classes.length}
          drillCount={drills.length}
          playerCount={mlbPlayers.length}
          goTo={goTo}
        />
      )}
      {page === 'classes' && (
        <ClassesView
          classes={classes}
          setClasses={setClasses}
          sport={classSport}
          setSport={setClassSport}
          level={classLevel}
          setLevel={setClassLevel}
          search={search}
          setSearch={setSearch}
          isCoach={isCoach}
          showModal={showClassModal}
          setShowModal={setShowClassModal}
          goToClass={(id: string) => goTo('classDetail', id)}
        />
      )}
      {page === 'classDetail' && currentClass && (
        <ClassDetailView cls={currentClass} />
      )}
      {page === 'drills' && (
        <DrillsView
          drills={drills}
          setDrills={setDrills}
          sport={drillSport}
          setSport={setDrillSport}
          cat={drillCat}
          setCat={setDrillCat}
          search={search}
          setSearch={setSearch}
          isCoach={isCoach}
          showModal={showDrillModal}
          setShowModal={setShowDrillModal}
        />
      )}
      {page === 'mlb' && (
        <MlbView
          players={mlbPlayers}
          setPlayers={setMlbPlayers}
          pos={mlbPos}
          setPos={setMlbPos}
          bats={mlbBats}
          setBats={setMlbBats}
          throws_={mlbThrows}
          setThrows={setMlbThrows}
          search={search}
          setSearch={setSearch}
          isCoach={isCoach}
          goToPlayer={(id: string) => goTo('player', id)}
          showModal={showPlayerModal}
          setShowModal={setShowPlayerModal}
        />
      )}
      {page === 'player' && currentPlayer && (
        <PlayerDetailView
          player={currentPlayer}
          setPlayer={setCurrentPlayer}
          filter={videoFilter}
          setFilter={setVideoFilter}
          isCoach={isCoach}
          showModal={showVideoModal}
          setShowModal={setShowVideoModal}
        />
      )}
    </div>
  );
}

/* ══════════ LANDING ══════════ */

function LandingView({ classCount, drillCount, playerCount, goTo }: { classCount: number; drillCount: number; playerCount: number; goTo: (p: Page) => void }) {
  return (
    <>
      <PageHeader
        eyebrow="Player Development"
        title="Education"
        titleAccent="Hub"
        readout={`${classCount + drillCount + playerCount} resources`}
      />
      <div className={styles.hubGrid}>
        <div className={styles.hubCard} style={{ borderColor: 'rgba(232,175,52,.3)' }} onClick={() => goTo('classes')}>
          <div className={styles.hubIcon} style={{ background: 'var(--gold-dim)' }}>🎓</div>
          <div className={styles.hubCardTitle}>Classes</div>
          <div className={styles.hubCardDesc}>Structured courses from Beginner to Expert across Hitting, Pitching, Defense, S&C, and Vision.</div>
          <div className={styles.hubCardCount} style={{ color: 'var(--gold-readable)' }}>{classCount} classes <span className={styles.hubCardArrow}>→</span></div>
        </div>
        <div className={styles.hubCard} style={{ borderColor: 'rgba(32,128,141,.3)' }} onClick={() => goTo('drills')}>
          <div className={styles.hubIcon} style={{ background: 'var(--accent-dim)' }}>⚾</div>
          <div className={styles.hubCardTitle}>Drills</div>
          <div className={styles.hubCardDesc}>Complete drill database organized by sport and category. The same drills used in training calendars.</div>
          <div className={styles.hubCardCount} style={{ color: 'var(--accent-light)' }}>{drillCount} drills <span className={styles.hubCardArrow}>→</span></div>
        </div>
        <div className={styles.hubCard} style={{ borderColor: 'rgba(221,105,116,.3)' }} onClick={() => goTo('mlb')}>
          <div className={styles.hubIcon} style={{ background: 'var(--red-dim)' }}>🎬</div>
          <div className={styles.hubCardTitle}>Major League Video</div>
          <div className={styles.hubCardDesc}>MLB player video library organized by position. Filter by LHH / RHH / LHP / RHP for targeted study.</div>
          <div className={styles.hubCardCount} style={{ color: 'var(--red)' }}>{playerCount} players <span className={styles.hubCardArrow}>→</span></div>
        </div>
      </div>
    </>
  );
}

/* ══════════ CLASSES ══════════ */

function ClassesView({ classes, setClasses, sport, setSport, level, setLevel, search, setSearch, isCoach, showModal, setShowModal, goToClass }: any) {
  const [editingClass, setEditingClass] = useState<EduClass | null>(null);
  const sportObj = SPORTS.find(s => s.id === sport)!;
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return classes
      .filter((c: EduClass) => c.sport === sport && (level === 'all' || c.level === level) && (!q || c.name.toLowerCase().includes(q) || (c.desc || '').toLowerCase().includes(q)))
      .sort((a: EduClass, b: EduClass) => {
        const order = ['beginner', 'intermediate', 'advanced', 'expert'];
        return order.indexOf(a.level) - order.indexOf(b.level);
      });
  }, [classes, sport, level, search]);

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this class? This cannot be undone.')) return;
    await api.deleteClass(id);
    setClasses((prev: EduClass[]) => prev.filter(c => c.id !== id));
  };

  const handleClassUpdated = (updated: EduClass) => {
    setClasses((prev: EduClass[]) => prev.map(c => c.id === updated.id ? updated : c));
    setEditingClass(null);
  };

  return (
    <>
      <PageHeader
        eyebrow="Education Library"
        title="Classes"
        titleAccent="Library"
        subtitle="Structured courses organized by sport and skill level."
        actions={isCoach ? <button className={styles.addBtn} onClick={() => setShowModal(true)}>+ Add Class</button> : undefined}
      />
      <div
        className={aStyles.profilePanel}
        style={{ marginTop: 16, padding: 20, display: 'flex', flexDirection: 'column' }}
      >
      <input className={styles.searchInput} placeholder="Search classes..." value={search} onChange={e => setSearch(e.target.value)} />
      <div className={styles.sportTabs} style={{ marginTop: 16 }}>
        {SPORTS.map(s => (
          <button key={s.id} className={`${styles.sportTab} ${sport === s.id ? styles.sportTabActive : ''}`}
            style={sport === s.id ? { background: s.color } : {}}
            onClick={() => { setSport(s.id); setLevel('all'); }}>
            {s.label}
          </button>
        ))}
      </div>
      <div className={styles.filterRow}>
        <button className={`${styles.pill} ${level === 'all' ? styles.pillActive : ''}`} onClick={() => setLevel('all')}>All ({classes.filter((c: EduClass) => c.sport === sport).length})</button>
        {LEVELS.map(l => {
          const n = classes.filter((c: EduClass) => c.sport === sport && c.level === l.id).length;
          return <button key={l.id} className={`${styles.pill} ${level === l.id ? styles.pillActive : ''}`} onClick={() => setLevel(l.id)}>{l.label} ({n})</button>;
        })}
      </div>
      <div style={{ marginTop: 4 }}>
      {filtered.length === 0 ? (
        <div className={styles.empty}>No classes found.</div>
      ) : (
        <div className={styles.classGrid}>
          {filtered.map((c: EduClass) => {
            const lv = LEVELS.find(l => l.id === c.level)!;
            return (
              <div key={c.id} className={styles.classCard} onClick={() => goToClass(c.id)} style={{ cursor: 'pointer' }}>
                <div className={styles.classThumb} style={{ background: sportObj.color + '22' }}>{c.emoji}</div>
                <div className={styles.classBody}>
                  <div className={styles.className}>{c.name}</div>
                  <div className={styles.classMeta}><span className={`${styles.levelBadge} ${lv.cls}`}>{lv.label}</span></div>
                  <div className={styles.classDesc}>{c.desc}</div>
                  <div className={styles.cardMeta} style={{ marginTop: 8 }}>
                    <span className={styles.metaItem}>{c.lessons} lesson{c.lessons !== 1 ? 's' : ''}</span>
                    <span className={styles.metaItem}>{c.duration} min/lesson</span>
                    {isCoach && (
                      <span className={styles.classCardActions}>
                        <button className={`${styles.cardBtn} ${styles.cardBtnEdit}`} onClick={(e) => { e.stopPropagation(); setEditingClass(c); }} title="Edit class">&#9998;</button>
                        <button className={`${styles.cardBtn} ${styles.cardBtnDel}`} onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }} title="Delete class">×</button>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>{/* /grid wrapper */}
      </div>{/* /profilePanel */}
      {showModal && <ClassModal sport={sport} onClose={() => setShowModal(false)} onSaved={(c: EduClass) => { setClasses((prev: EduClass[]) => [...prev, c]); setShowModal(false); }} />}
      {editingClass && <EditClassModal cls={editingClass} onClose={() => setEditingClass(null)} onSaved={handleClassUpdated} />}
    </>
  );
}

function ClassModal({ sport, onClose, onSaved }: { sport: string; onClose: () => void; onSaved: (c: EduClass) => void }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [description, setDescription] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [sp, setSp] = useState(sport);
  const [level, setLevel] = useState('beginner');
  const [lessons, setLessons] = useState(1);
  const [duration, setDuration] = useState(30);
  const [emoji, setEmoji] = useState('📚');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const result = await api.createClass({ sport: sp, level, name, desc, description: description || undefined, videoUrl: videoUrl || undefined, lessons, duration, emoji });
      onSaved(result);
    } catch (err) {
      console.error('Failed to create class:', err);
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}><span className={styles.modalTitle}>Add Class</span><button className={styles.modalClose} onClick={onClose}>×</button></div>
        <div className={styles.modalBody}>
          <div className={styles.fieldRow}>
            <div className={styles.field}><label className={styles.fieldLabel}>Sport</label><select className={styles.fieldInput} value={sp} onChange={e => setSp(e.target.value)}>{SPORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
            <div className={styles.field}><label className={styles.fieldLabel}>Level</label><select className={styles.fieldInput} value={level} onChange={e => setLevel(e.target.value)}>{LEVELS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}</select></div>
          </div>
          <div className={styles.field}><label className={styles.fieldLabel}>Class Name</label><input className={styles.fieldInput} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Hitting Fundamentals 101" /></div>
          <div className={styles.field}><label className={styles.fieldLabel}>Short Description</label><textarea className={styles.fieldInput} value={desc} onChange={e => setDesc(e.target.value)} rows={2} placeholder="Brief summary shown on the card" style={{ resize: 'vertical' }} /></div>
          <div className={styles.field}><label className={styles.fieldLabel}>Full Description</label><textarea className={styles.fieldInput} value={description} onChange={e => setDescription(e.target.value)} rows={5} placeholder="Detailed explanation athletes will read when they open the class..." style={{ resize: 'vertical' }} /></div>
          <div className={styles.field}><label className={styles.fieldLabel}>Video URL</label><input className={styles.fieldInput} value={videoUrl} onChange={e => setVideoUrl(e.target.value)} placeholder="Direct video file link" /></div>
          <div className={styles.fieldRow}>
            <div className={styles.field}><label className={styles.fieldLabel}>Lessons</label><input className={styles.fieldInput} type="number" value={lessons} min={1} onChange={e => setLessons(parseInt(e.target.value) || 1)} /></div>
            <div className={styles.field}><label className={styles.fieldLabel}>Duration (min)</label><input className={styles.fieldInput} type="number" value={duration} min={1} onChange={e => setDuration(parseInt(e.target.value) || 30)} /></div>
          </div>
          <div className={styles.field}><label className={styles.fieldLabel}>Emoji</label><input className={styles.fieldInput} value={emoji} onChange={e => setEmoji(e.target.value)} maxLength={2} style={{ width: 60 }} /></div>
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.btnCancel} onClick={onClose}>Cancel</button>
          <button className={styles.btnSave} onClick={save} disabled={saving || !name.trim()}>{saving ? 'Saving...' : 'Save Class'}</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════ EDIT CLASS MODAL ══════════ */

function EditClassModal({ cls, onClose, onSaved }: { cls: EduClass; onClose: () => void; onSaved: (c: EduClass) => void }) {
  const [name, setName] = useState(cls.name);
  const [desc, setDesc] = useState(cls.desc || '');
  const [description, setDescription] = useState(cls.description || '');
  const [videoUrl, setVideoUrl] = useState(cls.videoUrl || '');
  const [sp, setSp] = useState(cls.sport);
  const [level, setLevel] = useState(cls.level);
  const [lessons, setLessons] = useState(cls.lessons);
  const [duration, setDuration] = useState(cls.duration);
  const [emoji, setEmoji] = useState(cls.emoji);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const result = await api.updateClass(cls.id, {
        sport: sp,
        level,
        name,
        desc: desc || undefined,
        description: description || undefined,
        videoUrl: videoUrl || undefined,
        lessons,
        duration,
        emoji,
      });
      onSaved(result);
    } catch (err) {
      console.error('Failed to update class:', err);
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}><span className={styles.modalTitle}>Edit Class</span><button className={styles.modalClose} onClick={onClose}>×</button></div>
        <div className={styles.modalBody}>
          <div className={styles.fieldRow}>
            <div className={styles.field}><label className={styles.fieldLabel}>Sport</label><select className={styles.fieldInput} value={sp} onChange={e => setSp(e.target.value)}>{SPORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
            <div className={styles.field}><label className={styles.fieldLabel}>Level</label><select className={styles.fieldInput} value={level} onChange={e => setLevel(e.target.value)}>{LEVELS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}</select></div>
          </div>
          <div className={styles.field}><label className={styles.fieldLabel}>Class Name</label><input className={styles.fieldInput} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Hitting Fundamentals 101" /></div>
          <div className={styles.field}><label className={styles.fieldLabel}>Short Description</label><textarea className={styles.fieldInput} value={desc} onChange={e => setDesc(e.target.value)} rows={2} placeholder="Brief summary shown on the card" style={{ resize: 'vertical' }} /></div>
          <div className={styles.field}><label className={styles.fieldLabel}>Full Description</label><textarea className={styles.fieldInput} value={description} onChange={e => setDescription(e.target.value)} rows={5} placeholder="Detailed explanation athletes will read when they open the class..." style={{ resize: 'vertical' }} /></div>
          <div className={styles.field}><label className={styles.fieldLabel}>Video URL</label><input className={styles.fieldInput} value={videoUrl} onChange={e => setVideoUrl(e.target.value)} placeholder="Direct video file link" /></div>
          <div className={styles.fieldRow}>
            <div className={styles.field}><label className={styles.fieldLabel}>Lessons</label><input className={styles.fieldInput} type="number" value={lessons} min={1} onChange={e => setLessons(parseInt(e.target.value) || 1)} /></div>
            <div className={styles.field}><label className={styles.fieldLabel}>Duration (min)</label><input className={styles.fieldInput} type="number" value={duration} min={1} onChange={e => setDuration(parseInt(e.target.value) || 30)} /></div>
          </div>
          <div className={styles.field}><label className={styles.fieldLabel}>Emoji</label><input className={styles.fieldInput} value={emoji} onChange={e => setEmoji(e.target.value)} maxLength={2} style={{ width: 60 }} /></div>
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.btnCancel} onClick={onClose}>Cancel</button>
          <button className={styles.btnSave} onClick={save} disabled={saving || !name.trim()}>{saving ? 'Saving...' : 'Save Changes'}</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════ CLASS DETAIL ══════════ */

function ClassDetailView({ cls }: { cls: EduClass }) {
  const sportObj = SPORTS.find(s => s.id === cls.sport);
  const lv = LEVELS.find(l => l.id === cls.level);
  const sportColor = sportObj?.color || '#3B82D2';

  return (
    <div className={styles.classDetailPage}>
      {/* ── Header ── */}
      <div className={styles.classDetailHeader}>
        <div className={styles.classDetailEmoji} style={{ background: sportColor + '18' }}>
          {cls.emoji}
        </div>
        <div className={styles.classDetailInfo}>
          <div className={styles.classDetailName}>{cls.name}</div>
          <div className={styles.classDetailTags}>
            <span className={styles.classDetailSport} style={{ background: sportColor + '22', color: sportColor, borderColor: sportColor + '44' }}>
              {sportObj?.label}
            </span>
            {lv && <span className={`${styles.levelBadge} ${lv.cls}`}>{lv.label}</span>}
            <span className={styles.classDetailMeta}>{cls.lessons} lesson{cls.lessons !== 1 ? 's' : ''}</span>
            <span className={styles.classDetailMeta}>{cls.duration} min/lesson</span>
          </div>
          {cls.desc && <div className={styles.classDetailSummary}>{cls.desc}</div>}
        </div>
      </div>

      {/* ── Video Player ── */}
      {cls.videoUrl && (
        <div className={styles.classDetailVideo}>
          <video
            className={styles.classDetailVideoPlayer}
            src={cls.videoUrl}
            controls
            playsInline
          />
        </div>
      )}

      {/* ── Full Description ── */}
      {cls.description && (
        <div className={styles.classDetailBody}>
          <div className={styles.classDetailBodyLabel}>About This Class</div>
          <div className={styles.classDetailBodyText}>{cls.description}</div>
        </div>
      )}

      {/* ── Empty state if no video and no description ── */}
      {!cls.videoUrl && !cls.description && (
        <div className={styles.classDetailEmpty}>
          This class doesn't have detailed content yet. Check back soon!
        </div>
      )}
    </div>
  );
}

/* ══════════ DRILLS ══════════ */

function DrillsView({ drills, setDrills, sport, setSport, cat, setCat, search, setSearch, isCoach, showModal, setShowModal }: any) {
  const [viewingDrill, setViewingDrill] = useState<Drill | null>(null);
  const [editingDrill, setEditingDrill] = useState<Drill | null>(null);
  const sportObj = SPORTS.find(s => s.id === sport)!;
  const cats = DRILL_CATS[sport] || [];

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return drills.filter((d: Drill) =>
      d.tab === sport &&
      (cat === 'all' || d.category === cat) &&
      (!q || d.name.toLowerCase().includes(q) || (d.description || '').toLowerCase().includes(q))
    );
  }, [drills, sport, cat, search]);

  const groups = useMemo(() => {
    const showCats = cat === 'all' ? cats : cats.filter((c: any) => c.id === cat);
    return showCats.map((c: any) => ({ ...c, items: filtered.filter((d: Drill) => d.category === c.id) })).filter((g: any) => g.items.length > 0);
  }, [filtered, cats, cat]);

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this drill? Scheduled occurrences keep their custom name but will be unlinked from the library.')) return;
    await api.deleteDrill(id);
    setDrills((prev: Drill[]) => prev.filter(d => d.id !== id));
  };

  const handleDrillUpdated = (updated: Drill) => {
    setDrills((prev: Drill[]) => prev.map(d => d.id === updated.id ? updated : d));
    setEditingDrill(null);
  };

  return (
    <>
      <PageHeader
        eyebrow="Education Library"
        title="Drill"
        titleAccent="Library"
        subtitle="All training drills organized by sport and category."
        actions={isCoach ? <button className={styles.addBtn} onClick={() => setShowModal(true)}>+ Add Drill</button> : undefined}
      />
      <div
        className={aStyles.profilePanel}
        style={{ marginTop: 16, padding: 20, display: 'flex', flexDirection: 'column' }}
      >
      <input className={styles.searchInput} placeholder="Search drills..." value={search} onChange={e => setSearch(e.target.value)} />
      <div className={styles.sportTabs} style={{ marginTop: 16 }}>
        {SPORTS.map(s => (
          <button key={s.id} className={`${styles.sportTab} ${sport === s.id ? styles.sportTabActive : ''}`}
            style={sport === s.id ? { background: s.color } : {}}
            /* Switching sport tabs snaps the category filter back to
               "Movement Prep" — the universal first category across
               every sport in `DRILL_CATS` — so the coach lands on a
               focused starting view in the new sport instead of the
               "All" firehose. */
            onClick={() => { setSport(s.id); setCat('Movement Prep'); }}>
            {s.label}
          </button>
        ))}
      </div>
      {/* Category filter strip — per-category pills first (Movement Prep
          leads the row since it's the default selection), with the
          "All" pill pinned at the END as a fallback escape hatch
          rather than the prominent first choice. This keeps the most
          common drill-discovery flow (browse a single category)
          one click in front of the broader "show me everything"
          view. */}
      <div className={styles.filterRow}>
        {cats.map((c: any) => {
          const n = drills.filter((d: Drill) => d.tab === sport && d.category === c.id).length;
          return <button key={c.id} className={`${styles.pill} ${cat === c.id ? styles.pillActive : ''}`} onClick={() => setCat(c.id)}>{c.label} ({n})</button>;
        })}
        <button className={`${styles.pill} ${cat === 'all' ? styles.pillActive : ''}`} onClick={() => setCat('all')}>All ({drills.filter((d: Drill) => d.tab === sport).length})</button>
      </div>
      {groups.length === 0 ? (
        <div className={styles.empty}>No drills found.</div>
      ) : (
        groups.map((g: any) => (
          <div key={g.id} className={styles.catGroup}>
            <div className={styles.catHeader}>
              <span className={styles.catLabel}>{g.label}</span>
              <div className={styles.catLine} />
              <span className={styles.catCount}>{g.items.length} drill{g.items.length !== 1 ? 's' : ''}</span>
            </div>
            {g.items.map((d: Drill) => (
              <div key={d.id} className={styles.drillCard} onClick={() => setViewingDrill(d)} style={{ cursor: 'pointer' }}>
                <div className={styles.colorBar} style={{ background: sportObj.color }} />
                <div className={styles.cardBody}>
                  <div className={styles.cardNameRow}>
                    <div className={styles.cardName}>{d.name}</div>
                    {d.videoUrl && <span className={styles.cardVideoIcon} title="Has video">&#9654;</span>}
                  </div>
                  {d.description && <div className={styles.cardDesc}>{d.description}</div>}
                  <div className={styles.cardMeta}>
                    <span className={styles.metaItem}>{d.category}</span>
                    {isCoach && (
                      <span className={styles.cardActions}>
                        <button className={`${styles.cardBtn} ${styles.cardBtnEdit}`} onClick={(e) => { e.stopPropagation(); setEditingDrill(d); }} title="Edit drill">&#9998;</button>
                        <button className={`${styles.cardBtn} ${styles.cardBtnDel}`} onClick={(e) => { e.stopPropagation(); handleDelete(d.id); }} title="Delete drill">×</button>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))
      )}
      </div>{/* /profilePanel */}
      {showModal && <DrillModal sport={sport} onClose={() => setShowModal(false)} onSaved={(d: Drill) => { setDrills((prev: Drill[]) => [...prev, d]); setShowModal(false); }} />}
      {viewingDrill && <DrillVideoModal drill={viewingDrill} onClose={() => setViewingDrill(null)} />}
      {editingDrill && <EditDrillModal drill={editingDrill} onClose={() => setEditingDrill(null)} onSaved={handleDrillUpdated} />}
    </>
  );
}

function DrillModal({ sport, onClose, onSaved }: { sport: string; onClose: () => void; onSaved: (d: Drill) => void }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [sp, setSp] = useState(sport);
  const [category, setCategory] = useState((DRILL_CATS[sport] || [])[0]?.id || 'Drills');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const cats = DRILL_CATS[sp] || [];

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      // Create the drill first
      let result = await api.createDrill({ name, tab: sp, category, description: desc || undefined });
      // Then upload the video if one was selected
      if (videoFile) {
        result = await api.uploadDrillVideo(result.id, videoFile);
      }
      onSaved(result);
    } catch (err) {
      console.error('Failed to save drill:', err);
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}><span className={styles.modalTitle}>Add Drill</span><button className={styles.modalClose} onClick={onClose}>×</button></div>
        <div className={styles.modalBody}>
          <div className={styles.fieldRow}>
            <div className={styles.field}><label className={styles.fieldLabel}>Sport Tab</label><select className={styles.fieldInput} value={sp} onChange={e => { setSp(e.target.value); setCategory((DRILL_CATS[e.target.value] || [])[0]?.id || 'Drills'); }}>{SPORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
            <div className={styles.field}><label className={styles.fieldLabel}>Category</label><select className={styles.fieldInput} value={category} onChange={e => setCategory(e.target.value)}>{cats.map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
          </div>
          <div className={styles.field}><label className={styles.fieldLabel}>Drill Name</label><input className={styles.fieldInput} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Tee Work — Inside/Out" /></div>
          <div className={styles.field}><label className={styles.fieldLabel}>Description</label><textarea className={styles.fieldInput} value={desc} onChange={e => setDesc(e.target.value)} rows={2} placeholder="Coaching cues, setup, keys..." style={{ resize: 'vertical' }} /></div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Drill Video</label>
            <label className={styles.fileUpload}>
              <input type="file" accept="video/*" onChange={e => setVideoFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
              <span className={styles.fileUploadBtn}>{videoFile ? videoFile.name : 'Choose Video File...'}</span>
            </label>
            {videoFile && <span className={styles.fileUploadMeta}>{(videoFile.size / (1024 * 1024)).toFixed(1)} MB</span>}
          </div>
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.btnCancel} onClick={onClose}>Cancel</button>
          <button className={styles.btnSave} onClick={save} disabled={saving || !name.trim()}>{saving ? (videoFile ? 'Uploading...' : 'Saving...') : 'Save Drill'}</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════ DRILL VIDEO PLAYER MODAL ══════════ */

function DrillVideoModal({ drill, onClose }: { drill: Drill; onClose: () => void }) {
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.videoModal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>{drill.name}</span>
          <button className={styles.modalClose} onClick={onClose}>×</button>
        </div>
        <div className={styles.videoContainer}>
          {drill.videoUrl ? (
            <video
              className={styles.videoPlayer}
              src={drill.videoUrl}
              controls
              autoPlay
              playsInline
            />
          ) : (
            <div className={styles.noVideo}>No video uploaded for this drill</div>
          )}
        </div>
        {drill.description && (
          <div className={styles.videoDesc}>
            <div className={styles.videoDescLabel}>Description</div>
            <div className={styles.videoDescText}>{drill.description}</div>
          </div>
        )}
        <div className={styles.videoMeta}>
          <span className={styles.videoMetaTag}>{drill.tab}</span>
          <span className={styles.videoMetaTag}>{drill.category}</span>
        </div>
      </div>
    </div>
  );
}

/* ══════════ EDIT DRILL MODAL ══════════ */

function EditDrillModal({ drill, onClose, onSaved }: { drill: Drill; onClose: () => void; onSaved: (d: Drill) => void }) {
  const [name, setName] = useState(drill.name);
  const [desc, setDesc] = useState(drill.description || '');
  const [sp, setSp] = useState(drill.tab);
  const [category, setCategory] = useState(drill.category);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const cats = DRILL_CATS[sp] || [];

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      let result = await api.updateDrill(drill.id, {
        name,
        tab: sp,
        category,
        description: desc || undefined,
      });
      // If a new video was chosen, upload it
      if (videoFile) {
        result = await api.uploadDrillVideo(result.id, videoFile);
      }
      onSaved(result);
    } catch (err) {
      console.error('Failed to update drill:', err);
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}><span className={styles.modalTitle}>Edit Drill</span><button className={styles.modalClose} onClick={onClose}>×</button></div>
        <div className={styles.modalBody}>
          <div className={styles.fieldRow}>
            <div className={styles.field}><label className={styles.fieldLabel}>Sport Tab</label><select className={styles.fieldInput} value={sp} onChange={e => { setSp(e.target.value); setCategory((DRILL_CATS[e.target.value] || [])[0]?.id || 'Drills'); }}>{SPORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
            <div className={styles.field}><label className={styles.fieldLabel}>Category</label><select className={styles.fieldInput} value={category} onChange={e => setCategory(e.target.value)}>{cats.map((c: any) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
          </div>
          <div className={styles.field}><label className={styles.fieldLabel}>Drill Name</label><input className={styles.fieldInput} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Tee Work — Inside/Out" /></div>
          <div className={styles.field}><label className={styles.fieldLabel}>Description</label><textarea className={styles.fieldInput} value={desc} onChange={e => setDesc(e.target.value)} rows={3} placeholder="Coaching cues, setup, keys..." style={{ resize: 'vertical' }} /></div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Replace Video</label>
            {drill.videoUrl && !videoFile && (
              <span className={styles.fileUploadMeta}>Current video attached ✓</span>
            )}
            <label className={styles.fileUpload}>
              <input type="file" accept="video/*" onChange={e => setVideoFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
              <span className={styles.fileUploadBtn}>{videoFile ? videoFile.name : 'Choose New Video File...'}</span>
            </label>
            {videoFile && <span className={styles.fileUploadMeta}>{(videoFile.size / (1024 * 1024)).toFixed(1)} MB</span>}
          </div>
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.btnCancel} onClick={onClose}>Cancel</button>
          <button className={styles.btnSave} onClick={save} disabled={saving || !name.trim()}>{saving ? (videoFile ? 'Uploading...' : 'Saving...') : 'Save Changes'}</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════ MLB VIDEO ══════════ */

/* ── Cover-image upload helper ──────────────────────────────────
   Reads a File from a `<input type="file">`, downscales to a
   max-width of 800 px via canvas, and re-encodes as a JPEG
   data URL so the base64-stored cover image stays around
   ~50–150 KB per player (vs. 5–10 MB for an unprocessed
   8-megapixel photo). Quality 0.85 keeps the photo crisp at
   thumb + avatar sizes while dropping the payload by an
   order of magnitude — important since each MlbPlayer row
   carries the data URL in the DB.
   ─────────────────────────────────────────────────────────── */
async function fileToCoverDataUrl(file: File, maxWidth = 800, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('canvas 2d context unavailable'));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('image decode failed'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('file read failed'));
    reader.readAsDataURL(file);
  });
}

function MlbView({ players, setPlayers, pos, setPos, bats, setBats, throws_, setThrows, search, setSearch, isCoach, goToPlayer, showModal, setShowModal }: any) {
  const [editingPlayer, setEditingPlayer] = useState<MlbPlayer | null>(null);
  const handleDeletePlayer = async (id: string) => {
    if (!window.confirm('Delete this MLB player AND all of their videos? This cannot be undone.')) return;
    await api.deleteMlbPlayer(id);
    setPlayers((prev: MlbPlayer[]) => prev.filter((p) => p.id !== id));
  };

  const handlePlayerUpdated = (updated: MlbPlayer) => {
    // Server returns the player without the videos relation on update —
    // preserve whatever videos we already had locally so the count chip
    // doesn't flash to 0.
    setPlayers((prev: MlbPlayer[]) => prev.map((p) =>
      p.id === updated.id ? { ...updated, videos: p.videos } : p,
    ));
    setEditingPlayer(null);
  };

  /* Cover-photo uploads moved OFF the grid cards (2026-07 request):
     clicking a card image now just opens the player's profile like the
     rest of the card. Uploading/replacing a cover lives solely on the
     detail page's avatar (PlayerDetail below). */

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return players.filter((p: MlbPlayer) => {
      if (pos !== 'all' && !p.positions.includes(pos)) return false;
      if (bats !== 'all' && p.bats !== bats) return false;
      if (throws_ !== 'all' && p.throws !== throws_) return false;
      if (q && !p.name.toLowerCase().includes(q) && !(p.team || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [players, pos, bats, throws_, search]);

  return (
    <>
      <PageHeader
        eyebrow="Education Library"
        title="Major League"
        titleAccent="Video"
        subtitle="MLB player video library organized by position."
        actions={isCoach ? <button className={styles.addBtn} onClick={() => setShowModal(true)}>+ Add Player</button> : undefined}
      />
      <div
        className={aStyles.profilePanel}
        style={{ marginTop: 16, padding: 20, display: 'flex', flexDirection: 'column' }}
      >
      <input className={styles.searchInput} placeholder="Search players..." value={search} onChange={e => setSearch(e.target.value)} />
      <div className={styles.mlbFilters}>
        <div className={styles.mlbFilterGroup}>
          <div className={styles.mlbFilterLabel}>Position</div>
          <div className={styles.mlbFilterPills}>
            {['all', ...POSITIONS].map(p => (
              <button key={p} className={`${styles.pill} ${pos === p ? styles.pillActive : ''}`} onClick={() => setPos(p)}>{p === 'all' ? 'All' : p}</button>
            ))}
          </div>
        </div>
        <div className={styles.mlbDivider} />
        <div className={styles.mlbFilterGroup}>
          <div className={styles.mlbFilterLabel}>Batter Hand</div>
          <div className={styles.mlbFilterPills}>
            {['all', 'R', 'L', 'S'].map(b => (
              <button key={b} className={`${styles.pill} ${bats === b ? styles.pillActive : ''}`} onClick={() => setBats(b)}>{b === 'all' ? 'All' : b}</button>
            ))}
          </div>
        </div>
        <div className={styles.mlbDivider} />
        <div className={styles.mlbFilterGroup}>
          <div className={styles.mlbFilterLabel}>Pitcher Hand</div>
          <div className={styles.mlbFilterPills}>
            {['all', 'RHP', 'LHP'].map(t => (
              <button key={t} className={`${styles.pill} ${throws_ === t ? styles.pillActive : ''}`} onClick={() => setThrows(t)}>{t === 'all' ? 'All' : t}</button>
            ))}
          </div>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className={styles.empty}>No players found.</div>
      ) : (
        <div className={styles.playerGrid}>
          {filtered.map((p: MlbPlayer) => {
            const mainPos = p.positions.split(',')[0];
            const posColor = mainPos === 'Pitcher' ? 'var(--red)' : mainPos === 'Catcher' ? 'var(--gold)' : 'var(--accent)';
            /* No cover photo yet → fall back to the first playable video's
               first frame as the placeholder (the videos list is ordered
               newest-first, so this matches the first clip the user sees in
               that player's videos section). Replaced once a coach uploads. */
            const fallbackVideoUrl = !p.coverImageUrl
              ? (p.videos || []).find((v: MlbVideo) => v.url)?.url
              : undefined;
            return (
              <div key={p.id} className={styles.playerCard} onClick={() => goToPlayer(p.id)} style={{ cursor: 'pointer', position: 'relative' }}>
                <div
                  className={styles.playerThumb}
                  /* Cover photo (when set) fills the thumb area as a
                     `background-image`. Without a cover photo we render
                     a clean position-tinted fill — NO emoji placeholder.
                     The position badge stays anchored bottom-right in
                     both states. No click handler of its own: clicks
                     bubble to the card's goToPlayer, so the image opens
                     the profile like the rest of the card. Cover uploads
                     live on the detail page's avatar only. */
                  style={p.coverImageUrl
                    ? { backgroundImage: `url(${p.coverImageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', cursor: 'pointer' }
                    : { background: `${posColor}15`, cursor: 'pointer' }}
                >
                  {fallbackVideoUrl && (
                    <video
                      src={`${fallbackVideoUrl}#t=0.1`}
                      preload="metadata"
                      muted
                      playsInline
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                    />
                  )}
                  <span className={styles.playerPosBadge} style={{ background: `${posColor}22`, color: posColor, border: `1px solid ${posColor}44` }}>{mainPos}</span>
                </div>
                <div className={styles.playerInfo}>
                  <div className={styles.playerName}>{p.name}</div>
                  {(p.heightInches != null || p.weightLbs != null) && (
                    <div style={{ fontSize: rem(11), color: 'var(--text-muted)' }}>
                      {p.heightInches != null ? `${Math.floor(p.heightInches / 12)}'${p.heightInches % 12}"` : ''}
                      {p.heightInches != null && p.weightLbs != null ? ' · ' : ''}
                      {p.weightLbs != null ? `${p.weightLbs} lb` : ''}
                    </div>
                  )}
                  <div className={styles.playerTags}>
                    {p.bats && <span className={styles.playerTag} style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}>{p.bats}</span>}
                    {p.throws && <span className={styles.playerTag} style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>{p.throws}</span>}
                  </div>
                  <div className={styles.videoCount}>{(p.videos || []).length} videos</div>
                </div>
                {isCoach && (
                  <div
                    className={styles.cardActions}
                    style={{ position: 'absolute', top: 8, right: 8 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className={`${styles.cardBtn} ${styles.cardBtnEdit}`}
                      style={{ opacity: 1 }}
                      onClick={() => setEditingPlayer(p)}
                      title="Edit player"
                    >&#9998;</button>
                    <button
                      className={`${styles.cardBtn} ${styles.cardBtnDel}`}
                      style={{ opacity: 1 }}
                      onClick={() => handleDeletePlayer(p.id)}
                      title="Delete player"
                    >×</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      </div>{/* /profilePanel */}
      {showModal && <PlayerModal onClose={() => setShowModal(false)} onSaved={(p: MlbPlayer) => { setPlayers((prev: MlbPlayer[]) => [...prev, p]); setShowModal(false); }} />}
      {editingPlayer && <EditPlayerModal player={editingPlayer} onClose={() => setEditingPlayer(null)} onSaved={handlePlayerUpdated} />}
    </>
  );
}

function PlayerModal({ onClose, onSaved }: { onClose: () => void; onSaved: (p: MlbPlayer) => void }) {
  const [name, setName] = useState('');
  const [positions, setPositions] = useState<string[]>([]);
  const [bats, setBats] = useState('');
  const [throws_, setThrows] = useState('');
  const [heightFt, setHeightFt] = useState('');
  const [heightIn, setHeightIn] = useState('');
  const [weight, setWeight] = useState('');
  const [saving, setSaving] = useState(false);

  const togglePos = (p: string) => setPositions(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  /* Handedness fields are position-driven: Bats (R/L/S) for Hitters; Throws
     as LHP/RHP for Pitchers, or a plain L/R for fielders (C/IF/OF). Pitcher
     takes precedence for the Throws options when both are selected. */
  const showBats = positions.includes('Hitter');
  const isPitcher = positions.includes('Pitcher');
  const showFielderThrows = positions.some(p => FIELDER_POSITIONS.includes(p));
  const showThrows = isPitcher || showFielderThrows;
  const throwsOpts = isPitcher ? ['RHP', 'LHP'] : ['R', 'L'];

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const heightInches = (heightFt || heightIn)
        ? (parseInt(heightFt || '0', 10) * 12 + parseInt(heightIn || '0', 10))
        : null;
      const result = await api.createMlbPlayer({
        name: name.trim(),
        positions: positions.join(','),
        bats: showBats ? (bats || null) : null,
        throws: showThrows ? (throws_ || null) : null,
        heightInches,
        weightLbs: weight ? parseInt(weight, 10) : null,
      });
      onSaved(result);
    } catch (err) {
      console.error('Failed to create MLB player:', err);
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}><span className={styles.modalTitle}>Add Player</span><button className={styles.modalClose} onClick={onClose}>×</button></div>
        <div className={styles.modalBody}>
          <div className={styles.field}><label className={styles.fieldLabel}>Player Name</label><input className={styles.fieldInput} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Mike Trout" /></div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Positions</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {POSITIONS.map(p => (
                <button key={p} className={`${styles.pill} ${positions.includes(p) ? styles.pillActive : ''}`} onClick={() => togglePos(p)} style={{ fontSize: rem(12) }}>{p}</button>
              ))}
            </div>
          </div>
          {(showBats || showThrows) && (
            <div className={styles.fieldRow}>
              {showBats && (
                <div className={styles.field}><label className={styles.fieldLabel}>Bats</label><select className={styles.fieldInput} value={bats} onChange={e => setBats(e.target.value)}><option value="">N/A</option><option value="R">R</option><option value="L">L</option><option value="S">S</option></select></div>
              )}
              {showThrows && (
                <div className={styles.field}><label className={styles.fieldLabel}>Throws</label><select className={styles.fieldInput} value={throws_} onChange={e => setThrows(e.target.value)}><option value="">N/A</option>{throwsOpts.map(o => <option key={o} value={o}>{o}</option>)}</select></div>
              )}
            </div>
          )}
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Height</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input className={styles.fieldInput} type="number" min={4} max={8} value={heightFt} onChange={e => setHeightFt(e.target.value)} placeholder="ft" style={{ width: 64 }} />
                <span style={{ color: 'var(--text-muted)' }}>&apos;</span>
                <input className={styles.fieldInput} type="number" min={0} max={11} value={heightIn} onChange={e => setHeightIn(e.target.value)} placeholder="in" style={{ width: 64 }} />
                <span style={{ color: 'var(--text-muted)' }}>&quot;</span>
              </div>
            </div>
            <div className={styles.field}><label className={styles.fieldLabel}>Weight (lbs)</label><input className={styles.fieldInput} type="number" min={100} max={350} value={weight} onChange={e => setWeight(e.target.value)} placeholder="lbs" /></div>
          </div>
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.btnCancel} onClick={onClose}>Cancel</button>
          <button className={styles.btnSave} onClick={save} disabled={saving || !name.trim()}>{saving ? 'Saving...' : 'Save Player'}</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════ EDIT MLB PLAYER MODAL ══════════ */

function EditPlayerModal({ player, onClose, onSaved }: { player: MlbPlayer; onClose: () => void; onSaved: (p: MlbPlayer) => void }) {
  const [name, setName] = useState(player.name);
  const [positions, setPositions] = useState<string[]>(player.positions ? player.positions.split(',').map((p) => p.trim()).filter(Boolean) : []);
  const [bats, setBats] = useState(player.bats || '');
  const [throws_, setThrows] = useState(player.throws || '');
  const [heightFt, setHeightFt] = useState(player.heightInches != null ? String(Math.floor(player.heightInches / 12)) : '');
  const [heightIn, setHeightIn] = useState(player.heightInches != null ? String(player.heightInches % 12) : '');
  const [weight, setWeight] = useState(player.weightLbs != null ? String(player.weightLbs) : '');
  const [saving, setSaving] = useState(false);

  const togglePos = (p: string) => setPositions((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);

  const showBats = positions.includes('Hitter');
  const isPitcher = positions.includes('Pitcher');
  const showFielderThrows = positions.some(p => FIELDER_POSITIONS.includes(p));
  const showThrows = isPitcher || showFielderThrows;
  const throwsOpts = isPitcher ? ['RHP', 'LHP'] : ['R', 'L'];

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const heightInches = (heightFt || heightIn)
        ? (parseInt(heightFt || '0', 10) * 12 + parseInt(heightIn || '0', 10))
        : null;
      const result = await api.updateMlbPlayer(player.id, {
        name: name.trim(),
        positions: positions.join(','),
        // Send null (not undefined) so removing a position actually clears
        // a now-irrelevant hand — undefined would be dropped by JSON and
        // leave the stale value in the DB.
        bats: showBats ? (bats || null) : null,
        throws: showThrows ? (throws_ || null) : null,
        heightInches,
        weightLbs: weight ? parseInt(weight, 10) : null,
      });
      onSaved(result);
    } catch (err) {
      console.error('Failed to update MLB player:', err);
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}><span className={styles.modalTitle}>Edit Player</span><button className={styles.modalClose} onClick={onClose}>×</button></div>
        <div className={styles.modalBody}>
          <div className={styles.field}><label className={styles.fieldLabel}>Player Name</label><input className={styles.fieldInput} value={name} onChange={e => setName(e.target.value)} /></div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Positions</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {POSITIONS.map(p => (
                <button key={p} className={`${styles.pill} ${positions.includes(p) ? styles.pillActive : ''}`} onClick={() => togglePos(p)} style={{ fontSize: rem(12) }}>{p}</button>
              ))}
            </div>
          </div>
          {(showBats || showThrows) && (
            <div className={styles.fieldRow}>
              {showBats && (
                <div className={styles.field}><label className={styles.fieldLabel}>Bats</label><select className={styles.fieldInput} value={bats} onChange={e => setBats(e.target.value)}><option value="">N/A</option><option value="R">R</option><option value="L">L</option><option value="S">S</option></select></div>
              )}
              {showThrows && (
                <div className={styles.field}><label className={styles.fieldLabel}>Throws</label><select className={styles.fieldInput} value={throws_} onChange={e => setThrows(e.target.value)}><option value="">N/A</option>{throwsOpts.map(o => <option key={o} value={o}>{o}</option>)}</select></div>
              )}
            </div>
          )}
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Height</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input className={styles.fieldInput} type="number" min={4} max={8} value={heightFt} onChange={e => setHeightFt(e.target.value)} placeholder="ft" style={{ width: 64 }} />
                <span style={{ color: 'var(--text-muted)' }}>&apos;</span>
                <input className={styles.fieldInput} type="number" min={0} max={11} value={heightIn} onChange={e => setHeightIn(e.target.value)} placeholder="in" style={{ width: 64 }} />
                <span style={{ color: 'var(--text-muted)' }}>&quot;</span>
              </div>
            </div>
            <div className={styles.field}><label className={styles.fieldLabel}>Weight (lbs)</label><input className={styles.fieldInput} type="number" min={100} max={350} value={weight} onChange={e => setWeight(e.target.value)} placeholder="lbs" /></div>
          </div>
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.btnCancel} onClick={onClose}>Cancel</button>
          <button className={styles.btnSave} onClick={save} disabled={saving || !name.trim()}>{saving ? 'Saving...' : 'Save Changes'}</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════ PLAYER DETAIL ══════════ */

function PlayerDetailView({ player, setPlayer, filter, setFilter, isCoach, showModal, setShowModal }: any) {
  // Local UI state — playback modal + per-video edit modal. Lives here so it
  // resets when the user navigates back to the MLB grid.
  const [playingVideo, setPlayingVideo] = useState<MlbVideo | null>(null);
  const [editingVideo, setEditingVideo] = useState<MlbVideo | null>(null);
  // Cover-photo file input — same upload flow as the grid card thumb,
  // but here it only ever targets the single player whose detail page
  // we're on.
  const coverInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarClick = () => {
    if (!isCoach) return;
    coverInputRef.current?.click();
  };

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await fileToCoverDataUrl(file);
      const updated = await api.updateMlbPlayer(player.id, { coverImageUrl: dataUrl } as any);
      // Server returns the player without `videos`; preserve the local
      // copy so the video grid below doesn't flash empty.
      setPlayer((prev: MlbPlayer) => ({ ...updated, videos: prev.videos }));
    } catch (err: any) {
      window.alert(`Could not upload cover photo: ${err?.message || err}`);
    }
  };

  const categories: string[] = useMemo(() => {
    const cats = [...new Set((player.videos || []).map((v: MlbVideo) => v.category))] as string[];
    return ['all', ...cats];
  }, [player]);

  const filtered = useMemo(() => {
    return (player.videos || []).filter((v: MlbVideo) => filter === 'all' || v.category === filter);
  }, [player, filter]);

  /* Same cover-photo fallback as the grid card: until a real photo is
     uploaded, use the first playable video's first frame (videos are
     createdAt-desc, so this is the first clip in the videos section). */
  const fallbackVideoUrl = !player.coverImageUrl
    ? (player.videos || []).find((v: MlbVideo) => v.url)?.url
    : undefined;

  const handleDeleteVideo = async (id: string) => {
    if (!window.confirm('Delete this video?')) return;
    await api.deleteMlbVideo(id);
    setPlayer((prev: MlbPlayer) => ({ ...prev, videos: (prev.videos || []).filter((v: MlbVideo) => v.id !== id) }));
  };

  const handleVideoUpdated = (updated: MlbVideo) => {
    setPlayer((prev: MlbPlayer) => ({
      ...prev,
      videos: (prev.videos || []).map((v: MlbVideo) => v.id === updated.id ? updated : v),
    }));
    setEditingVideo(null);
  };

  return (
    <>
      <div className={styles.playerDetailHead}>
        <div
          className={styles.playerAvatar}
          /* When a cover photo exists it fills the avatar circle as a
             background-image. Without a cover photo the avatar is
             rendered EMPTY — no emoji placeholder — so it reads as a
             clean blank circle until a coach uploads a photo.
             Coach-mode click opens the file picker (hidden input
             below); player app users see the static avatar with no
             handler. */
          style={player.coverImageUrl
            ? { backgroundImage: `url(${player.coverImageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', cursor: isCoach ? 'pointer' : 'default' }
            : { cursor: isCoach ? 'pointer' : 'default', overflow: 'hidden' }}
          title={isCoach ? (player.coverImageUrl ? 'Click to replace cover photo' : 'Click to upload cover photo') : undefined}
          onClick={isCoach ? handleAvatarClick : undefined}
        >
          {fallbackVideoUrl && (
            <video
              src={`${fallbackVideoUrl}#t=0.1`}
              preload="metadata"
              muted
              playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%', pointerEvents: 'none' }}
            />
          )}
        </div>
        {/* Hidden file input mirrors the grid-card upload flow but
            only ever targets THIS player. */}
        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleAvatarFile}
        />
        <div>
          <div className={styles.playerDetailName}>{player.name}</div>
          <div className={styles.playerDetailMeta}>
            {player.positions.split(',').map((p: string) => (
              <span key={p} className={styles.playerTag} style={{ borderColor: 'var(--accent)', color: 'var(--accent-light)' }}>{p}</span>
            ))}
            {player.bats && <span className={styles.playerTag} style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}>{player.bats}</span>}
            {player.throws && <span className={styles.playerTag} style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>{player.throws}</span>}
            {player.team && <span style={{ fontSize: rem(13), color: 'var(--text-muted)', marginLeft: 4 }}>{player.team}</span>}
          </div>
        </div>
        {isCoach && <button className={styles.addBtn} style={{ marginLeft: 'auto' }} onClick={() => setShowModal(true)}>+ Add Video</button>}
      </div>

      <div className={styles.filterRow}>
        {categories.map((c: string) => (
          <button key={c} className={`${styles.pill} ${filter === c ? styles.pillActive : ''}`} onClick={() => setFilter(c)}>{c === 'all' ? 'All' : c}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className={styles.empty}>No videos yet.</div>
      ) : (
        <div className={styles.videoGrid}>
          {filtered.map((v: MlbVideo) => (
            <div
              key={v.id}
              className={styles.videoCard}
              onClick={() => v.url && setPlayingVideo(v)}
              style={{ cursor: v.url ? 'pointer' : 'default', opacity: v.url ? 1 : 0.6 }}
              title={v.url ? 'Click to play' : 'No video URL — coach can edit to add one'}
            >
              <div className={styles.videoThumb}>
                {v.url && (
                  <video
                    src={`${v.url}#t=0.1`}
                    preload="metadata"
                    muted
                    playsInline
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                )}
                <div className={styles.playBtn}>▶</div>
              </div>
              <div className={styles.videoInfo}>
                <div className={styles.videoTitle}>{v.title}</div>
                <div className={styles.videoMeta}>{v.category}</div>
                {v.notes && <div className={styles.videoNotes}>{v.notes}</div>}
                {isCoach && (
                  <div className={styles.videoActions} onClick={(e) => e.stopPropagation()}>
                    <button
                      className={`${styles.cardBtn} ${styles.cardBtnEdit}`}
                      style={{ opacity: 1 }}
                      onClick={() => setEditingVideo(v)}
                      title="Edit video"
                    >&#9998;</button>
                    <button
                      className={`${styles.cardBtn} ${styles.cardBtnDel}`}
                      style={{ opacity: 1 }}
                      onClick={() => handleDeleteVideo(v.id)}
                      title="Delete video"
                    >×</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && <VideoModal playerId={player.id} positions={player.positions} onClose={() => setShowModal(false)} onSaved={(vs: MlbVideo[]) => { setPlayer((prev: MlbPlayer) => ({ ...prev, videos: [...vs, ...(prev.videos || [])] })); setShowModal(false); }} />}
      {editingVideo && <EditVideoModal video={editingVideo} positions={player.positions} onClose={() => setEditingVideo(null)} onSaved={handleVideoUpdated} />}
      {playingVideo && <MlbVideoPlayerModal video={playingVideo} onClose={() => setPlayingVideo(null)} />}
    </>
  );
}

/* ══════════ MLB VIDEO PLAYER MODAL ══════════ */

/**
 * Plays an MLB study video — a direct video file dropped into the app —
 * in a native <video> element.
 */
function MlbVideoPlayerModal({ video, onClose }: { video: MlbVideo; onClose: () => void }) {
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.videoModal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>{video.title}</span>
          <button className={styles.modalClose} onClick={onClose}>×</button>
        </div>
        <div className={styles.videoContainer}>
          {video.url ? (
            <video
              className={styles.videoPlayer}
              src={video.url}
              controls
              autoPlay
              playsInline
            />
          ) : (
            <div className={styles.noVideo}>No video on this clip</div>
          )}
        </div>
        {video.notes && (
          <div className={styles.videoDesc}>
            <div className={styles.videoDescLabel}>Notes</div>
            <div className={styles.videoDescText}>{video.notes}</div>
          </div>
        )}
        <div className={styles.videoMeta}>
          <span className={styles.videoMetaTag}>{video.category}</span>
        </div>
      </div>
    </div>
  );
}

/* ══════════ EDIT MLB VIDEO MODAL ══════════ */

/* Drag/drop (or click) video-file upload for the MLB Add/Edit Video
   modals. Uploads via the standalone /videos/upload-file endpoint and
   reports the resulting URL up to the parent, which saves it on the
   MlbVideo row. */
function VideoFileDrop({ url, onUrl }: { url: string; onUrl: (u: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file?: File) => {
    if (!file) return;
    setErr('');
    setName(file.name);
    setUploading(true);
    try {
      const res = await api.uploadVideoFile(file);
      onUrl(res.url);
    } catch (e: any) {
      setErr(e?.message || 'Upload failed');
      setName('');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel}>Video File</label>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
        style={{
          border: '1px dashed var(--border-strong, rgba(128,128,128,0.55))',
          borderRadius: 8,
          padding: '16px 12px',
          textAlign: 'center',
          fontSize: rem(13),
          lineHeight: 1.4,
          cursor: uploading ? 'progress' : 'pointer',
          color: url ? 'var(--green, #16a34a)' : 'var(--text-muted, #888)',
          background: 'var(--input-bg, rgba(128,128,128,0.06))',
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          style={{ display: 'none' }}
          onChange={(e) => handleFile(e.target.files?.[0] || undefined)}
        />
        {uploading
          ? `Uploading ${name}…`
          : url
            ? `✓ Video attached${name ? ` — ${name}` : ''} · click to replace`
            : 'Drop a video file here, or click to choose'}
      </div>
      {err && <div style={{ color: 'var(--red, #dc2626)', fontSize: rem(12), marginTop: 4 }}>{err}</div>}
    </div>
  );
}

function EditVideoModal({ video, positions, onClose, onSaved }: { video: MlbVideo; positions?: string | null; onClose: () => void; onSaved: (v: MlbVideo) => void }) {
  // Same position-derived categories as Add Video, but always include the
  // video's current category so a legacy/auto value is never silently dropped.
  const derived = videoCategoriesForPositions(positions);
  const cats = derived.includes(video.category) ? derived : [video.category, ...derived];
  const [title, setTitle] = useState(video.title);
  const [category, setCategory] = useState(video.category);
  const [url, setUrl] = useState(video.url || '');
  const [notes, setNotes] = useState(video.notes || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const result = await api.updateMlbVideo(video.id, {
        title,
        category,
        url: url || undefined,
        notes: notes || undefined,
      });
      onSaved(result);
    } catch (err) {
      console.error('Failed to update video:', err);
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}><span className={styles.modalTitle}>Edit Video</span><button className={styles.modalClose} onClick={onClose}>×</button></div>
        <div className={styles.modalBody}>
          <div className={styles.field}><label className={styles.fieldLabel}>Video Title</label><input className={styles.fieldInput} value={title} onChange={e => setTitle(e.target.value)} /></div>
          <div className={styles.field}><label className={styles.fieldLabel}>Category</label>
            {cats.length > 1 ? (
              <select className={styles.fieldInput} value={category} onChange={e => setCategory(e.target.value)}>
                {cats.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : (
              <div className={styles.fieldInput} style={{ opacity: 0.75, cursor: 'default' }}>{cats[0]}</div>
            )}
          </div>
          <VideoFileDrop url={url} onUrl={setUrl} />
          <div className={styles.field}><label className={styles.fieldLabel}>Video URL</label><input className={styles.fieldInput} value={url} onChange={e => setUrl(e.target.value)} placeholder="Direct video file link" /></div>
          <div className={styles.field}><label className={styles.fieldLabel}>Notes</label><textarea className={styles.fieldInput} value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ resize: 'vertical' }} /></div>
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.btnCancel} onClick={onClose}>Cancel</button>
          <button className={styles.btnSave} onClick={save} disabled={saving || !title.trim()}>{saving ? 'Saving...' : 'Save Changes'}</button>
        </div>
      </div>
    </div>
  );
}

/* One queued upload in the Add-Video modal. Files upload immediately on
   selection/drop so their URLs are ready by Save; `url` is set once the
   upload resolves, `err` if it fails. */
type UploadEntry = { id: string; file: File; url?: string; uploading: boolean; err?: string };

const VIDEO_FILE_RX = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;

function MultiVideoFileDrop({ entries, setEntries }: { entries: UploadEntry[]; setEntries: React.Dispatch<React.SetStateAction<UploadEntry[]>> }) {
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: FileList | File[] | null) => {
    const list = Array.from(files || []).filter(f => f.type.startsWith('video/') || VIDEO_FILE_RX.test(f.name));
    if (!list.length) return;
    const fresh: UploadEntry[] = list.map(f => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file: f, uploading: true }));
    setEntries(prev => [...prev, ...fresh]);
    fresh.forEach(async (entry) => {
      try {
        const res = await api.uploadVideoFile(entry.file);
        setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, url: res.url, uploading: false } : e));
      } catch (err: any) {
        setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, uploading: false, err: err?.message || 'Upload failed' } : e));
      }
    });
  };

  const removeEntry = (id: string) => setEntries(prev => prev.filter(e => e.id !== id));

  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel}>Video Files</label>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
        style={{
          border: '1px dashed var(--border-strong, rgba(128,128,128,0.55))',
          borderRadius: 8,
          padding: '16px 12px',
          textAlign: 'center',
          fontSize: rem(13),
          lineHeight: 1.4,
          cursor: 'pointer',
          color: 'var(--text-muted, #888)',
          background: 'var(--input-bg, rgba(128,128,128,0.06))',
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = ''; }}
        />
        Drop video files here, or click to choose — you can pick several at once
      </div>
      {entries.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {entries.map((e, i) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: rem(12), padding: '4px 8px', borderRadius: 6, background: 'var(--input-bg, rgba(128,128,128,0.06))' }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i + 1}. {e.file.name}</span>
              <span style={{ color: e.err ? 'var(--red, #dc2626)' : e.uploading ? 'var(--text-muted, #888)' : 'var(--green, #16a34a)', whiteSpace: 'nowrap' }}>
                {e.err ? `✗ ${e.err}` : e.uploading ? 'Uploading…' : '✓'}
              </span>
              <button
                type="button"
                onClick={(ev) => { ev.stopPropagation(); removeEntry(e.id); }}
                style={{ border: 'none', background: 'transparent', color: 'var(--text-muted, #888)', cursor: 'pointer', fontSize: rem(14), lineHeight: 1, padding: 0 }}
                title="Remove"
              >×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VideoModal({ playerId, positions, onClose, onSaved }: { playerId: string; positions?: string | null; onClose: () => void; onSaved: (vs: MlbVideo[]) => void }) {
  // Category is derived from the player's positions — auto-assigned when only
  // one discipline applies, picker shown when several do (see videoCategoriesForPositions).
  const cats = videoCategoriesForPositions(positions);
  const [name, setName] = useState('');
  const [category, setCategory] = useState(cats[0]);
  const [notes, setNotes] = useState('');
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const ready = entries.filter(e => e.url);
  const anyUploading = entries.some(e => e.uploading);
  const trimmed = name.trim();
  const canSave = !!trimmed && ready.length > 0 && !anyUploading && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setErr('');
    try {
      // One video per uploaded file. With multiple files the shared name gets
      // a 1,2,3… suffix; a single file keeps the name as-is.
      const multiple = ready.length > 1;
      const created: MlbVideo[] = [];
      for (let i = 0; i < ready.length; i++) {
        const title = multiple ? `${trimmed} ${i + 1}` : trimmed;
        const v = await api.createMlbVideo({ playerId, title, category, url: ready[i].url, notes: notes || undefined });
        created.push(v);
      }
      onSaved(created);
    } catch (e: any) {
      setErr(e?.message || 'Failed to save videos');
      setSaving(false);
    }
  };

  const saveLabel = saving ? 'Saving…' : anyUploading ? 'Uploading…' : ready.length > 1 ? `Save ${ready.length} Videos` : 'Save Video';

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}><span className={styles.modalTitle}>Add Video</span><button className={styles.modalClose} onClick={onClose}>×</button></div>
        <div className={styles.modalBody}>
          <div className={styles.field}><label className={styles.fieldLabel}>Video Name</label><input className={styles.fieldInput} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. 2023 Home Run Swing" /></div>
          <div className={styles.field}><label className={styles.fieldLabel}>Category</label>
            {cats.length > 1 ? (
              <select className={styles.fieldInput} value={category} onChange={e => setCategory(e.target.value)}>
                {cats.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : (
              <div className={styles.fieldInput} style={{ opacity: 0.75, cursor: 'default' }}>{cats[0]}</div>
            )}
          </div>
          <MultiVideoFileDrop entries={entries} setEntries={setEntries} />
          <div className={styles.field}><label className={styles.fieldLabel}>Notes</label><textarea className={styles.fieldInput} value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="What to watch for..." style={{ resize: 'vertical' }} /></div>
          {ready.length > 1 && trimmed && (
            <div style={{ fontSize: rem(12), color: 'var(--text-muted, #888)' }}>
              Creates {ready.length} videos: “{trimmed} 1” … “{trimmed} {ready.length}”.
            </div>
          )}
          {err && <div style={{ color: 'var(--red, #dc2626)', fontSize: rem(12) }}>{err}</div>}
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.btnCancel} onClick={onClose}>Cancel</button>
          <button className={styles.btnSave} onClick={save} disabled={!canSave}>{saveLabel}</button>
        </div>
      </div>
    </div>
  );
}
