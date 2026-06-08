/**
 * PDF Theme — Colors, spacing, and reusable StyleSheet for @react-pdf/renderer
 */
import { StyleSheet, Font } from '@react-pdf/renderer';

/* ── Brand Colors ── */
export const colors = {
  // Primary — true black for the cover page; navy is kept as a softer
  // dark tone for in-body accents (player info bar, table headers, etc.).
  black:      '#000000',
  navy:       '#0D1117',
  navyLight:  '#161B22',
  surface:    '#1C2128',
  surface2:   '#2D333B',
  border:     '#373E47',

  // Accent
  teal:       '#20808D',
  tealLight:  '#2EA8B8',
  tealDark:   '#1A6670',
  accent:     '#4A90D9',
  accentLight:'#5BA3EC',
  gold:       '#E8AF34',

  // Text
  white:      '#FFFFFF',
  textPrimary:'#CDD9E5',
  /* textMuted darkened 40% (RGB × 0.6) so PDF axis labels, grid-line
     tick chips, and table-cell unit suffixes ("mph", "ft") read with
     stronger contrast against the page-white background and the new
     darker card surfaces below. Old: #768390. */
  textMuted:  '#474F56',
  textDark:   '#1C2128',

  // Grade badges — Red (bad) / Yellow (average) / Green (good).
  // EXACT match for the in-app `scoreColor()` palette so PDF chips and
  // value text render identically to the on-screen Hitting Snapshot.
  //   in-app: < 40 red   #EF4444
  //          40-59 yellow #EAB308
  //          ≥ 60 green   #22C55E
  elite:      '#22C55E',     // green text
  eliteBg:    '#DCFCE7',     // light green bg (white-page friendly)
  aboveAvg:   '#EAB308',     // yellow text
  aboveAvgBg: '#FEF9C3',     // light yellow bg
  developing: '#EF4444',     // red text
  developingBg:'#FEE2E2',    // light red bg

  // Page
  pageBg:     '#FFFFFF',
  /* Bubble + table FILLS are pure white so each card / KPI / plot pane
     reads as a clean panel on the white page. The darker contrast lives
     ONLY in the BORDERS (`cardBorder`) and graph-line strokes — those
     stay at 40%-darker greys so the section divisions and plot axes
     are clearly visible against the white fills.
       cardBg     #F6F8FA → #FFFFFF (white bubble fill)
       cardBorder #E1E4E8 → #87898B (40% darker; borders + grid lines)
       tableBg    #F0F3F6 → #FFFFFF (white table fill)
       tableAlt   #FAFBFC → #FFFFFF (no row striping — all rows white) */
  cardBg:     '#FFFFFF',
  cardBorder: '#87898B',
  tableBg:    '#FFFFFF',
  tableAlt:   '#FFFFFF',
};

/* ── Common Styles ── */
export const s = StyleSheet.create({
  /* ── Page ── */
  page: {
    backgroundColor: colors.pageBg,
    /* Tightened top padding to give the snapshot + notes more vertical
       room on page 2. Bottom padding keeps the existing footer breathing
       space. */
    paddingTop: 24,
    paddingBottom: 36,
    paddingHorizontal: 36,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: colors.textDark,
  },
  pageFooter: {
    position: 'absolute',
    bottom: 20,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7,
    color: colors.textMuted,
  },

  /* ── Cover ── */
  coverPage: {
    backgroundColor: colors.black,
    padding: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* ── Section Headers ── */
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    marginTop: 18,
    /* Section header underline switched from teal to black for the new
       white / grey / black body palette. */
    borderBottom: `1.5px solid ${colors.black}`,
    paddingBottom: 6,
  },
  sectionIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: colors.navy,
  },
  sectionSubtitle: {
    fontSize: 8,
    color: colors.textMuted,
    marginLeft: 8,
    marginTop: 2,
  },

  /* ── KPI Grid ── */
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  kpiCard: {
    width: '23%',
    backgroundColor: colors.cardBg,
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 6,
    padding: 10,
    alignItems: 'center',
  },
  kpiCardWide: {
    width: '31%',
    backgroundColor: colors.cardBg,
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 6,
    padding: 10,
    alignItems: 'center',
  },
  kpiLabel: {
    fontSize: 7,
    /* All KPI labels (Avg EV, Max EV, Launch Angle, Distance, Max Bat
       Speed, Avg Bat Speed, Attack Angle, Plane Angle, Time to Contact,
       Plane Score, Connection Score, Rotation Score, etc.) render in
       solid black so they read at parity with the section headers. */
    color: colors.black,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
    textAlign: 'center',
  },
  kpiValue: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: colors.navy,
  },
  kpiUnit: {
    fontSize: 7,
    color: colors.textMuted,
    marginTop: 2,
  },
  kpiBadge: {
    fontSize: 6,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    marginTop: 4,
    textTransform: 'uppercase',
  },

  /* ── Table ── */
  table: {
    marginBottom: 12,
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 6,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    /* Header row — solid black, mirroring the player info bar above it. */
    backgroundColor: colors.black,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  tableHeaderCell: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: colors.white,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderBottom: `0.5px solid ${colors.cardBorder}`,
  },
  tableRowAlt: {
    backgroundColor: colors.tableAlt,
  },
  tableCell: {
    fontSize: 8,
    color: colors.textDark,
  },
  tableCellBold: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: colors.navy,
  },

  /* ── Score Bar ── */
  scoreBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  scoreBarLabel: {
    width: 100,
    fontSize: 8,
    color: colors.textDark,
  },
  scoreBarTrack: {
    flex: 1,
    height: 10,
    backgroundColor: colors.cardBg,
    borderRadius: 5,
    border: `0.5px solid ${colors.cardBorder}`,
    overflow: 'hidden',
  },
  scoreBarFill: {
    height: '100%',
    borderRadius: 5,
  },
  scoreBarValue: {
    width: 50,
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'right',
    color: colors.navy,
  },

  /* ── Notes Box ── */
  notesBox: {
    backgroundColor: colors.cardBg,
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 6,
    padding: 10,
    marginBottom: 0,
  },
  notesLabel: {
    /* DIAGNOSIS NOTES heading — bumped to fontSize 8 (matches the
       SPRAY CHART / HITTING GRADES section eyebrows above it) and
       solid black for visual parity. */
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: colors.black,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    marginBottom: 6,
  },
  notesText: {
    fontSize: 9,
    color: colors.textDark,
    lineHeight: 1.5,
  },

  /* ── Player Info Bar ──
     Top bar on body pages — solid black with white text + soft grey
     secondary labels. Matches the cover-page palette so the report reads
     as one cohesive black/white/grey theme on the body pages. */
  playerInfoBar: {
    flexDirection: 'row',
    backgroundColor: colors.black,
    borderRadius: 8,
    /* Tighter vertical padding + smaller marginBottom so the bar takes
       less of page 2's vertical budget — leaves more room for the notes
       block below. Horizontal padding kept generous for breathing room. */
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 10,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  playerInfoName: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: colors.white,
  },
  playerInfoDetail: {
    fontSize: 8,
    color: 'rgba(255,255,255,0.65)',
    marginTop: 2,
  },
  playerInfoStat: {
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  playerInfoStatLabel: {
    fontSize: 6,
    color: 'rgba(255,255,255,0.55)',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  playerInfoStatValue: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: colors.white,
    marginTop: 2,
  },

  /* ── Grade Row ── */
  gradeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderBottom: `0.5px solid ${colors.cardBorder}`,
  },
  gradeLabel: {
    flex: 2,
    fontSize: 8,
    color: colors.textDark,
  },
  gradeValue: {
    flex: 1,
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    color: colors.navy,
  },
  gradePips: {
    flex: 3,
    flexDirection: 'row',
    gap: 2,
    alignItems: 'center',
  },

  /* ── Divider ── */
  divider: {
    height: 1,
    backgroundColor: colors.cardBorder,
    marginVertical: 12,
  },

  /* ── Inline Row ── */
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  col: {
    flex: 1,
  },
});

/* ── Badge color helper ── */
export function badgeColors(level: string): { bg: string; text: string } {
  switch (level) {
    case 'high':  return { bg: colors.eliteBg,      text: colors.elite };
    case 'mid':   return { bg: colors.aboveAvgBg,   text: colors.aboveAvg };
    case 'low':   return { bg: colors.developingBg,  text: colors.developing };
    default:      return { bg: colors.tealDark,      text: colors.tealLight };
  }
}

/* ── Score bar fill color ── */
export function barColor(level: string): string {
  switch (level) {
    case 'high':  return colors.elite;
    case 'mid':   return colors.aboveAvg;
    case 'low':   return colors.developing;
    default:      return colors.teal;
  }
}
