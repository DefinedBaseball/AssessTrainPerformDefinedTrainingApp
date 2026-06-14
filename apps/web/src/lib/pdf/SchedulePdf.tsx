/**
 * SchedulePdf — a printable training-schedule PDF built from a player's
 * scheduled drills. Layout:
 *   • A thin "Next 7 Days" strip at the top showing the drill TYPES on
 *     each of today + the next 6 days.
 *   • Then one calendar per selected type (Hitting / Pitching / …), each
 *     day listing that type's drills. Span = Day (today), Week (next 7
 *     days), or Month (the calendar month containing today).
 */
import { Document, Page, View, Text, Image } from '@react-pdf/renderer';
import { colors } from './theme';
import { LEGEND_CATEGORIES, getTabCatStyle } from '@/lib/training-colors';

export type ScheduleScope = 'day' | 'week' | 'month';

export interface SchedulePdfEvent {
  date: string;   // YYYY-MM-DD
  tab: string;    // hitting | pitching | catching | infield | outfield | strength
  category: string; // sub-category within the tab (Movement Prep, Tee, …)
  name: string;
  time?: string | null;
}

/* Type → label + accent, mirroring the in-app training palette
   (TAB_LABELS / TAB_ANCHOR_COLORS) so the PDF reads like the calendar. */
const TAB_LABEL: Record<string, string> = {
  hitting: 'Hitting', pitching: 'Pitching', catching: 'Catching',
  infield: 'Infield', outfield: 'Outfield', strength: 'S & C',
};
const TAB_COLOR: Record<string, string> = {
  hitting: '#1E5DA0', pitching: '#F59E0B', catching: '#14B8A6',
  infield: '#38A850', outfield: '#88B838', strength: '#EF4444',
};
export const SCHEDULE_TAB_ORDER = ['hitting', 'pitching', 'catching', 'infield', 'outfield', 'strength'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

/* Group a day's drills (for one tab) by category, ordered to match the app's
   canonical category order for that tab (Movement Prep → … ), unknowns last.
   Drives the per-category sub-headers + dividers in each calendar cell. */
function groupByCategory(list: SchedulePdfEvent[], tab: string): { category: string; drills: SchedulePdfEvent[] }[] {
  const order = LEGEND_CATEGORIES[tab] || [];
  const byCat = new Map<string, SchedulePdfEvent[]>();
  for (const e of list) {
    const c = e.category || 'Drills';
    const arr = byCat.get(c);
    if (arr) arr.push(e); else byCat.set(c, [e]);
  }
  return [...byCat.keys()]
    .sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    })
    .map((c) => ({ category: c, drills: byCat.get(c)! }));
}

interface Props {
  playerName: string;
  events: SchedulePdfEvent[];
  selectedTabs: string[];
  scope: ScheduleScope;
  /** "Today" — the anchor for the next-7-days strip + the calendars. */
  today: Date;
}

export function SchedulePdf({ playerName, events, selectedTabs, scope, today }: Props) {
  // Group events by date for quick lookup.
  const byDate: Record<string, SchedulePdfEvent[]> = {};
  for (const e of events) (byDate[e.date] ||= []).push(e);

  const next7 = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const tabs = SCHEDULE_TAB_ORDER.filter((t) => selectedTabs.includes(t));

  const rangeLabel =
    scope === 'day' ? `${MO[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}`
    : scope === 'week' ? `${MO[today.getMonth()]} ${today.getDate()} – ${MO[next7[6].getMonth()]} ${next7[6].getDate()}`
    : `${MO[today.getMonth()]} ${today.getFullYear()}`;

  // Days that a given type's calendar should render.
  const tabDays = (): Date[] => {
    if (scope === 'day') return [today];
    if (scope === 'week') return next7;
    // month — full weeks (Sun..Sat) covering the month containing today.
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const gridStart = addDays(first, -first.getDay());
    const out: Date[] = [];
    for (let i = 0; i < 42; i++) out.push(addDays(gridStart, i));
    // Trim trailing empty week if it's entirely in the next month.
    while (out.length > 35 && out[out.length - 1].getMonth() !== today.getMonth()
           && out[out.length - 7].getMonth() !== today.getMonth()) out.splice(-7);
    return out;
  };

  const drillsFor = (tab: string, d: Date): SchedulePdfEvent[] =>
    (byDate[ymd(d)] || []).filter((e) => e.tab === tab);

  /* Header (logo + player name + range) — repeated atop every page. */
  const renderHeader = () => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, borderBottom: `2px solid ${colors.black}`, paddingBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <Image src="/logo.png" style={{ width: 38, height: 38, marginRight: 10 }} />
        <View>
          <Text style={{ fontSize: 8, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2 }}>Training Schedule</Text>
          <Text style={{ fontSize: 18, fontFamily: 'Helvetica-Bold', color: colors.navy }}>{playerName}</Text>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: colors.navy }}>{rangeLabel}</Text>
        <Text style={{ fontSize: 7, color: colors.textMuted, marginTop: 2 }}>
          {scope === 'day' ? 'Day' : scope === 'week' ? 'Week' : 'Month'} · Generated {MO[new Date().getMonth()]} {new Date().getDate()}, {new Date().getFullYear()}
        </Text>
      </View>
    </View>
  );

  /* "Next 7 Days" drill-type strip — repeated atop every page. */
  const renderStrip = () => (
    <View>
      <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: colors.black, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>Next 7 Days</Text>
      <View style={{ flexDirection: 'row', gap: 4, marginBottom: 16 }}>
        {next7.map((d, i) => {
          const dayEvents = byDate[ymd(d)] || [];
          const dayTabs = SCHEDULE_TAB_ORDER.filter((t) => dayEvents.some((e) => e.tab === t));
          return (
            <View key={i} style={{ flex: 1, border: `1px solid ${colors.cardBorder}`, borderRadius: 5, padding: 5, minHeight: 56 }}>
              <Text style={{ fontSize: 7, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{WD[d.getDay()]}</Text>
              <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: colors.navy, marginBottom: 3 }}>{d.getDate()}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
                {dayTabs.length === 0
                  ? <Text style={{ fontSize: 6, color: colors.textMuted }}>—</Text>
                  : dayTabs.map((t) => (
                      <Text key={t} style={{ fontSize: 6, fontFamily: 'Helvetica-Bold', color: '#FFFFFF', backgroundColor: TAB_COLOR[t], borderRadius: 3, paddingHorizontal: 3, paddingVertical: 1 }}>
                        {TAB_LABEL[t]}
                      </Text>
                    ))}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );

  /* The calendar for a single type (Hitting / Pitching / …). */
  const renderTabCalendar = (tab: string) => {
    const days = tabDays();
    const weeks: Date[][] = [];
    if (scope === 'month') {
      for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
    } else {
      weeks.push(days);
    }
    return (
      <View style={{ marginBottom: 12 }}>
        <View wrap={false} style={{ backgroundColor: TAB_COLOR[tab], borderRadius: 4, paddingVertical: 4, paddingHorizontal: 8, marginBottom: 5 }}>
          <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: 0.6 }}>{TAB_LABEL[tab]}</Text>
        </View>
        {/* Weekday header (month view) */}
        {scope === 'month' && (
          <View style={{ flexDirection: 'row', gap: 3, marginBottom: 3 }}>
            {WD.map((w) => (
              <Text key={w} style={{ flex: 1, fontSize: 6, color: colors.textMuted, textTransform: 'uppercase', textAlign: 'center', letterSpacing: 0.5 }}>{w}</Text>
            ))}
          </View>
        )}
        {weeks.map((week, wi) => (
          <View key={wi} wrap={false} style={{ flexDirection: 'row', gap: 3, marginBottom: 3, alignItems: 'stretch' }}>
            {week.map((d, di) => {
              const inMonth = d.getMonth() === today.getMonth();
              const dim = scope === 'month' && !inMonth;
              const groups = groupByCategory(drillsFor(tab, d), tab);
              return (
                <View key={di} style={{
                  flex: scope === 'day' ? 0 : 1,
                  width: scope === 'day' ? 220 : undefined,
                  minHeight: scope === 'month' ? 48 : 64,
                  border: `1px solid ${colors.cardBorder}`,
                  borderRadius: 4,
                  padding: 4,
                  backgroundColor: dim ? '#F4F5F7' : '#FFFFFF',
                  opacity: dim ? 0.55 : 1,
                }}>
                  <Text style={{ fontSize: 6, color: colors.textMuted, textTransform: 'uppercase' }}>
                    {scope === 'month' ? '' : WD[d.getDay()] + ' '}{d.getDate()}
                  </Text>
                  {/* Drills grouped by category, with a divider between groups. */}
                  {groups.map((g, gi) => (
                    <View key={gi}>
                      {gi > 0 && (
                        <View style={{ height: 0.5, backgroundColor: colors.cardBorder, marginTop: 2, marginBottom: 2 }} />
                      )}
                      {g.category && g.category !== 'Drills' && (
                        <Text style={{ fontSize: 5.5, fontFamily: 'Helvetica-Bold', color: getTabCatStyle(tab, g.category).dot, textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 1 }}>
                          {g.category}
                        </Text>
                      )}
                      {g.drills.map((e, ei) => (
                        <Text key={ei} style={{ fontSize: 6.5, color: colors.textDark, marginTop: 0.5 }}>• {e.name}</Text>
                      ))}
                    </View>
                  ))}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    );
  };

  const pageStyle = { backgroundColor: '#FFFFFF', padding: 28, fontFamily: 'Helvetica', color: colors.textDark } as const;

  return (
    <Document>
      {tabs.length === 0 ? (
        // No types selected — still render the header + strip on one page.
        <Page size="A4" orientation="landscape" style={pageStyle}>
          {renderHeader()}
          {renderStrip()}
          <Text style={{ fontSize: 9, color: colors.textMuted }}>No calendar types selected.</Text>
        </Page>
      ) : (
        // One page per selected type: header + Next-7-Days strip + that calendar.
        tabs.map((tab) => (
          <Page key={tab} size="A4" orientation="landscape" style={pageStyle}>
            {renderHeader()}
            {renderStrip()}
            {renderTabCalendar(tab)}
          </Page>
        ))
      )}
    </Document>
  );
}

/** Compute the fetch date range [start, end] (YYYY-MM-DD) needed to fill
 *  both the next-7-days strip and the per-type calendars for a scope. */
export function scheduleFetchRange(today: Date, scope: ScheduleScope): { startDate: string; endDate: string } {
  const stripEnd = addDays(today, 6);
  if (scope === 'day') return { startDate: ymd(today), endDate: ymd(stripEnd) };
  if (scope === 'week') return { startDate: ymd(today), endDate: ymd(stripEnd) };
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const gridStart = addDays(first, -first.getDay());
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const gridEnd = addDays(last, 6 - last.getDay());
  const start = gridStart < today ? gridStart : today;
  const end = gridEnd > stripEnd ? gridEnd : stripEnd;
  return { startDate: ymd(start), endDate: ymd(end) };
}
