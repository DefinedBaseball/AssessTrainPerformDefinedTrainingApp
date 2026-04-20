'use client';

import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { EduClass, Drill, MlbPlayer, MlbVideo } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import styles from './page.module.css';

const SPORTS = [
  { id: 'hitting', label: 'Hitting', color: '#3B82D2' },
  { id: 'pitching', label: 'Pitching', color: '#DC4646' },
  { id: 'defense', label: 'Defense', color: '#38A850' },
  { id: 'strength', label: 'S&C', color: '#EA9230' },
  { id: 'vision', label: 'Vision', color: '#DAC328' },
];

const LEVELS = [
  { id: 'beginner', label: 'Beginner', cls: styles.levelBeginner },
  { id: 'intermediate', label: 'Intermediate', cls: styles.levelIntermediate },
  { id: 'advanced', label: 'Advanced', cls: styles.levelAdvanced },
  { id: 'expert', label: 'Expert', cls: styles.levelExpert },
];

const DRILL_CATS: Record<string, { id: string; label: string }[]> = {
  hitting: [{ id: 'Movement Prep', label: 'Movement Prep' }, { id: 'Drills', label: 'Drills' }, { id: 'Batting Practice', label: 'Batting Practice' }, { id: 'Machine', label: 'Machine' }, { id: 'Live', label: 'Live' }],
  pitching: [{ id: 'Movement Prep', label: 'Movement Prep' }, { id: 'Drills', label: 'Drills' }, { id: 'Bullpen', label: 'Bullpen' }, { id: 'Live', label: 'Live' }, { id: 'Post-Throw', label: 'Post-Throw' }],
  defense: [{ id: 'Movement Prep', label: 'Movement Prep' }, { id: 'Drills', label: 'Drills' }, { id: 'Machine', label: 'Machine' }, { id: 'Live', label: 'Live' }],
  strength: [{ id: 'Movement Prep', label: 'Movement Prep' }, { id: 'Exercises', label: 'Exercises' }, { id: 'Cool Down', label: 'Cool Down' }],
  vision: [{ id: 'Vizual Edge', label: 'Vizual Edge' }, { id: 'Drills', label: 'Drills' }, { id: 'Live', label: 'Live' }],
};

const POSITIONS = ['Hitter', 'Pitcher', 'Catcher', 'Infield', 'Outfield'];

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
  const [drillCat, setDrillCat] = useState('all');
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
        subtitle="Your complete learning library — classes, drills, and Major League video study."
        readout={`${classCount + drillCount + playerCount} resources`}
      />
      <div className={styles.hubGrid}>
        <div className={styles.hubCard} style={{ borderColor: 'rgba(232,175,52,.3)' }} onClick={() => goTo('classes')}>
          <div className={styles.hubIcon} style={{ background: 'var(--gold-dim)' }}>🎓</div>
          <div className={styles.hubCardTitle}>Classes</div>
          <div className={styles.hubCardDesc}>Structured courses from Beginner to Expert across Hitting, Pitching, Defense, S&C, and Vision.</div>
          <div className={styles.hubCardCount} style={{ color: 'var(--gold)' }}>{classCount} classes <span className={styles.hubCardArrow}>→</span></div>
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
    await api.deleteClass(id);
    setClasses((prev: EduClass[]) => prev.filter(c => c.id !== id));
  };

  const handleClassUpdated = (updated: EduClass) => {
    setClasses((prev: EduClass[]) => prev.map(c => c.id === updated.id ? updated : c));
    setEditingClass(null);
  };

  return (
    <>
      <div className={styles.sectionHead}>
        <div>
          <div className={styles.sectionTitle}>Classes</div>
          <div className={styles.sectionSub}>Structured courses organized by sport and skill level</div>
        </div>
        {isCoach && <button className={styles.addBtn} onClick={() => setShowModal(true)}>+ Add Class</button>}
      </div>
      <input className={styles.searchInput} placeholder="Search classes..." value={search} onChange={e => setSearch(e.target.value)} />
      <div className={styles.sportTabs}>
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
    const result = await api.createClass({ sport: sp, level, name, desc, description: description || undefined, videoUrl: videoUrl || undefined, lessons, duration, emoji });
    onSaved(result);
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
          <div className={styles.field}><label className={styles.fieldLabel}>Video URL</label><input className={styles.fieldInput} value={videoUrl} onChange={e => setVideoUrl(e.target.value)} placeholder="https://youtube.com/... or direct video link" /></div>
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
          <div className={styles.field}><label className={styles.fieldLabel}>Video URL</label><input className={styles.fieldInput} value={videoUrl} onChange={e => setVideoUrl(e.target.value)} placeholder="https://youtube.com/... or direct video link" /></div>
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

  /* Try to extract YouTube embed from various URL formats */
  const embedUrl = (() => {
    if (!cls.videoUrl) return null;
    const url = cls.videoUrl;
    // YouTube watch URL
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
    if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
    // Already an embed URL
    if (url.includes('youtube.com/embed/')) return url;
    // Direct video URL (mp4, etc.)
    return null;
  })();

  const isDirectVideo = cls.videoUrl && !embedUrl;

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
          {embedUrl ? (
            <iframe
              className={styles.classDetailIframe}
              src={embedUrl}
              title={cls.name}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : isDirectVideo ? (
            <video
              className={styles.classDetailVideoPlayer}
              src={cls.videoUrl}
              controls
              playsInline
            />
          ) : null}
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
    await api.deleteDrill(id);
    setDrills((prev: Drill[]) => prev.filter(d => d.id !== id));
  };

  const handleDrillUpdated = (updated: Drill) => {
    setDrills((prev: Drill[]) => prev.map(d => d.id === updated.id ? updated : d));
    setEditingDrill(null);
  };

  return (
    <>
      <div className={styles.sectionHead}>
        <div>
          <div className={styles.sectionTitle}>Drill Library</div>
          <div className={styles.sectionSub}>All training drills organized by sport and category</div>
        </div>
        {isCoach && <button className={styles.addBtn} onClick={() => setShowModal(true)}>+ Add Drill</button>}
      </div>
      <input className={styles.searchInput} placeholder="Search drills..." value={search} onChange={e => setSearch(e.target.value)} />
      <div className={styles.sportTabs}>
        {SPORTS.map(s => (
          <button key={s.id} className={`${styles.sportTab} ${sport === s.id ? styles.sportTabActive : ''}`}
            style={sport === s.id ? { background: s.color } : {}}
            onClick={() => { setSport(s.id); setCat('all'); }}>
            {s.label}
          </button>
        ))}
      </div>
      <div className={styles.filterRow}>
        <button className={`${styles.pill} ${cat === 'all' ? styles.pillActive : ''}`} onClick={() => setCat('all')}>All ({drills.filter((d: Drill) => d.tab === sport).length})</button>
        {cats.map((c: any) => {
          const n = drills.filter((d: Drill) => d.tab === sport && d.category === c.id).length;
          return <button key={c.id} className={`${styles.pill} ${cat === c.id ? styles.pillActive : ''}`} onClick={() => setCat(c.id)}>{c.label} ({n})</button>;
        })}
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

function MlbView({ players, setPlayers, pos, setPos, bats, setBats, throws_, setThrows, search, setSearch, isCoach, goToPlayer, showModal, setShowModal }: any) {
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
      <div className={styles.sectionHead}>
        <div>
          <div className={styles.sectionTitle}>Major League Video</div>
          <div className={styles.sectionSub}>Player video library — click any player to view their folder</div>
        </div>
        {isCoach && <button className={styles.addBtn} onClick={() => setShowModal(true)}>+ Add Player</button>}
      </div>
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
            {['all', 'RHH', 'LHH', 'Switch'].map(b => (
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
            return (
              <div key={p.id} className={styles.playerCard} onClick={() => goToPlayer(p.id)}>
                <div className={styles.playerThumb} style={{ background: `${posColor}15` }}>
                  {p.emoji}
                  <span className={styles.playerPosBadge} style={{ background: `${posColor}22`, color: posColor, border: `1px solid ${posColor}44` }}>{mainPos}</span>
                </div>
                <div className={styles.playerInfo}>
                  <div className={styles.playerName}>{p.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.team}</div>
                  <div className={styles.playerTags}>
                    {p.bats && <span className={styles.playerTag} style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}>{p.bats}</span>}
                    {p.throws && <span className={styles.playerTag} style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>{p.throws}</span>}
                  </div>
                  <div className={styles.videoCount}>{(p.videos || []).length} videos</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {showModal && <PlayerModal onClose={() => setShowModal(false)} onSaved={(p: MlbPlayer) => { setPlayers((prev: MlbPlayer[]) => [...prev, p]); setShowModal(false); }} />}
    </>
  );
}

function PlayerModal({ onClose, onSaved }: { onClose: () => void; onSaved: (p: MlbPlayer) => void }) {
  const [name, setName] = useState('');
  const [positions, setPositions] = useState<string[]>([]);
  const [bats, setBats] = useState('');
  const [throws_, setThrows] = useState('');
  const [team, setTeam] = useState('');
  const [emoji, setEmoji] = useState('⚾');
  const [saving, setSaving] = useState(false);

  const togglePos = (p: string) => setPositions(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const result = await api.createMlbPlayer({ name, positions: positions.join(','), bats: bats || undefined, throws: throws_ || undefined, team: team || undefined, emoji });
    onSaved(result);
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
                <button key={p} className={`${styles.pill} ${positions.includes(p) ? styles.pillActive : ''}`} onClick={() => togglePos(p)} style={{ fontSize: 12 }}>{p}</button>
              ))}
            </div>
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}><label className={styles.fieldLabel}>Bats</label><select className={styles.fieldInput} value={bats} onChange={e => setBats(e.target.value)}><option value="">N/A</option><option value="RHH">RHH</option><option value="LHH">LHH</option><option value="Switch">Switch</option></select></div>
            <div className={styles.field}><label className={styles.fieldLabel}>Throws</label><select className={styles.fieldInput} value={throws_} onChange={e => setThrows(e.target.value)}><option value="">N/A</option><option value="RHP">RHP</option><option value="LHP">LHP</option></select></div>
          </div>
          <div className={styles.field}><label className={styles.fieldLabel}>Team</label><input className={styles.fieldInput} value={team} onChange={e => setTeam(e.target.value)} placeholder="e.g. LA Angels" /></div>
          <div className={styles.field}><label className={styles.fieldLabel}>Emoji</label><input className={styles.fieldInput} value={emoji} onChange={e => setEmoji(e.target.value)} maxLength={2} style={{ width: 60 }} /></div>
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.btnCancel} onClick={onClose}>Cancel</button>
          <button className={styles.btnSave} onClick={save} disabled={saving || !name.trim()}>{saving ? 'Saving...' : 'Save Player'}</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════ PLAYER DETAIL ══════════ */

function PlayerDetailView({ player, setPlayer, filter, setFilter, isCoach, showModal, setShowModal }: any) {
  const categories: string[] = useMemo(() => {
    const cats = [...new Set((player.videos || []).map((v: MlbVideo) => v.category))] as string[];
    return ['all', ...cats];
  }, [player]);

  const filtered = useMemo(() => {
    return (player.videos || []).filter((v: MlbVideo) => filter === 'all' || v.category === filter);
  }, [player, filter]);

  const handleDeleteVideo = async (id: string) => {
    await api.deleteMlbVideo(id);
    setPlayer((prev: MlbPlayer) => ({ ...prev, videos: (prev.videos || []).filter((v: MlbVideo) => v.id !== id) }));
  };

  return (
    <>
      <div className={styles.playerDetailHead}>
        <div className={styles.playerAvatar}>{player.emoji}</div>
        <div>
          <div className={styles.playerDetailName}>{player.name}</div>
          <div className={styles.playerDetailMeta}>
            {player.positions.split(',').map((p: string) => (
              <span key={p} className={styles.playerTag} style={{ borderColor: 'var(--accent)', color: 'var(--accent-light)' }}>{p}</span>
            ))}
            {player.bats && <span className={styles.playerTag} style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}>{player.bats}</span>}
            {player.throws && <span className={styles.playerTag} style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>{player.throws}</span>}
            {player.team && <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 4 }}>{player.team}</span>}
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
            <div key={v.id} className={styles.videoCard}>
              <div className={styles.videoThumb}>
                <div className={styles.playBtn}>▶</div>
              </div>
              <div className={styles.videoInfo}>
                <div className={styles.videoTitle}>{v.title}</div>
                <div className={styles.videoMeta}>{v.category}</div>
                {v.notes && <div className={styles.videoNotes}>{v.notes}</div>}
                {isCoach && (
                  <div className={styles.videoActions}>
                    <button className={`${styles.cardBtn} ${styles.cardBtnDel}`} style={{ opacity: 1 }} onClick={() => handleDeleteVideo(v.id)}>×</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && <VideoModal playerId={player.id} onClose={() => setShowModal(false)} onSaved={(v: MlbVideo) => { setPlayer((prev: MlbPlayer) => ({ ...prev, videos: [...(prev.videos || []), v] })); setShowModal(false); }} />}
    </>
  );
}

function VideoModal({ playerId, onClose, onSaved }: { playerId: string; onClose: () => void; onSaved: (v: MlbVideo) => void }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Swing');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const result = await api.createMlbVideo({ playerId, title, category, url: url || undefined, notes: notes || undefined });
    onSaved(result);
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}><span className={styles.modalTitle}>Add Video</span><button className={styles.modalClose} onClick={onClose}>×</button></div>
        <div className={styles.modalBody}>
          <div className={styles.field}><label className={styles.fieldLabel}>Video Title</label><input className={styles.fieldInput} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. 2023 Home Run Swing" /></div>
          <div className={styles.field}><label className={styles.fieldLabel}>Category</label>
            <select className={styles.fieldInput} value={category} onChange={e => setCategory(e.target.value)}>
              {['Swing', 'At-Bat', 'Mechanics', 'Pitching', 'Defense', 'Highlight', 'Interview'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className={styles.field}><label className={styles.fieldLabel}>Video URL</label><input className={styles.fieldInput} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://youtube.com/..." /></div>
          <div className={styles.field}><label className={styles.fieldLabel}>Notes</label><textarea className={styles.fieldInput} value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="What to watch for..." style={{ resize: 'vertical' }} /></div>
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.btnCancel} onClick={onClose}>Cancel</button>
          <button className={styles.btnSave} onClick={save} disabled={saving || !title.trim()}>{saving ? 'Saving...' : 'Save Video'}</button>
        </div>
      </div>
    </div>
  );
}
