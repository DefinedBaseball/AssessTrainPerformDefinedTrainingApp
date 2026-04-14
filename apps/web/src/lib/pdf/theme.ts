/**
 * PDF Theme — Colors, spacing, and reusable StyleSheet for @react-pdf/renderer
 */
import { StyleSheet, Font } from '@react-pdf/renderer';

/* ── Brand Colors ── */
export const colors = {
  // Primary
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
  textMuted:  '#768390',
  textDark:   '#1C2128',

  // Badges
  elite:      '#22C55E',
  eliteBg:    '#14532D',
  aboveAvg:   '#EAB308',
  aboveAvgBg: '#713F12',
  developing: '#EF4444',
  developingBg:'#7F1D1D',

  // Page
  pageBg:     '#FFFFFF',
  cardBg:     '#F6F8FA',
  cardBorder: '#E1E4E8',
  tableBg:    '#F0F3F6',
  tableAlt:   '#FAFBFC',
};

/* ── Common Styles ── */
export const s = StyleSheet.create({
  /* ── Page ── */
  page: {
    backgroundColor: colors.pageBg,
    paddingTop: 40,
    paddingBottom: 50,
    paddingHorizontal: 40,
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
    backgroundColor: colors.navy,
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
    borderBottom: `1.5px solid ${colors.teal}`,
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
    color: colors.textMuted,
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
    backgroundColor: colors.navy,
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
    padding: 12,
    marginBottom: 12,
  },
  notesLabel: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  notesText: {
    fontSize: 9,
    color: colors.textDark,
    lineHeight: 1.5,
  },

  /* ── Player Info Bar ── */
  playerInfoBar: {
    flexDirection: 'row',
    backgroundColor: colors.navy,
    borderRadius: 8,
    padding: 14,
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  playerInfoName: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: colors.white,
  },
  playerInfoDetail: {
    fontSize: 8,
    color: colors.tealLight,
    marginTop: 2,
  },
  playerInfoStat: {
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  playerInfoStatLabel: {
    fontSize: 6,
    color: colors.textMuted,
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
