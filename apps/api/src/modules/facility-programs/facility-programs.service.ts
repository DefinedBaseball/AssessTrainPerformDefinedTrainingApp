import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/* Facility programs (Settings → Programs): one per workout type -- Hitting,
   Pitching, Lifting, Catching to start, plus any types a coach adds
   (Infield, Outfield, ...). Each holds the season's start / end dates and
   the start times offered on each weekday. An athlete's facility schedule
   picks a program, its days and one of those times per day; the program's
   dates define Week 1, Week 2, ... (Mon–Sun weeks, Week 1 = the week the
   program starts in).

   One shared list for the academy, kept as JSON in the AppSetting table (like
   the vendor contacts). Mirrored on the web by lib/facility-schedule.ts. */

export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export interface FacilityProgram {
  key: string;
  label: string;
  color: string;
  startDate: string | null;
  endDate: string | null;
  /** Weekday → start times offered ("HH:MM", sorted). */
  hours: Partial<Record<WeekdayKey, string[]>>;
  /** The four defaults can be renamed and recoloured but not removed. */
  builtIn: boolean;
}

/** Built-in defaults, in display order. Colours match the muted palette. */
const DEFAULTS: FacilityProgram[] = [
  { key: 'HITTING_PROGRAM',  label: 'Hitting Program',  color: '#5789da', startDate: null, endDate: null, hours: {}, builtIn: true },
  { key: 'PITCHING_PROGRAM', label: 'Pitching Program', color: '#d55e5e', startDate: null, endDate: null, hours: {}, builtIn: true },
  { key: 'LIFTING_PROGRAM',  label: 'Lifting Program',  color: '#d77938', startDate: null, endDate: null, hours: {}, builtIn: true },
  { key: 'CATCHING_PROGRAM', label: 'Catching Program', color: '#3aad64', startDate: null, endDate: null, hours: {}, builtIn: true },
];

/** Not a program: one-on-one, with its own dates and any time. Still a valid
 *  facility-schedule entry. */
export const LESSON_KEY = 'LESSON';

const SETTING_KEY = 'facilityPrograms';
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

@Injectable()
export class FacilityProgramsService {
  constructor(private prisma: PrismaService) {}

  async list(): Promise<FacilityProgram[]> {
    let row = await this.prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) row = await this.seedFromSchedules();
    let saved: FacilityProgram[] = [];
    try {
      const parsed = row ? JSON.parse(row.value) : [];
      if (Array.isArray(parsed)) saved = parsed;
    } catch { /* treat as empty */ }
    /* Built-ins always present (saved edits win); custom types follow. */
    const out: FacilityProgram[] = DEFAULTS.map((d) => {
      const s = saved.find((p) => p.key === d.key);
      return s ? { ...d, ...s, builtIn: true } : { ...d };
    });
    for (const s of saved) {
      if (!out.some((p) => p.key === s.key)) out.push({ ...s, builtIn: false });
    }
    return out;
  }

  /**
   * First run only (no saved list yet): build each built-in program from the
   * facility schedules coaches already entered before Settings → Programs
   * existed (2026-11). Every start time any athlete has on a weekday becomes
   * one of that program's times for the day, and the program runs from the
   * earliest start date to the latest end date on those schedules -- so the
   * existing schedules stay valid choices. Saved straight away, so it never
   * runs again (later edits in Settings win).
   */
  private async seedFromSchedules() {
    const players = await this.prisma.player.findMany({
      where: { facilitySchedule: { not: null } },
      select: { facilitySchedule: true },
    });
    const seeded = DEFAULTS.map((d) => ({ ...d, hours: {} as Partial<Record<WeekdayKey, string[]>> }));
    for (const pl of players) {
      let entries: any[] = [];
      try { const v = JSON.parse(pl.facilitySchedule || '[]'); if (Array.isArray(v)) entries = v; } catch { /* skip */ }
      for (const e of entries) {
        const prog = seeded.find((p) => p.key === e?.program);
        if (!prog || !e.days || typeof e.days !== 'object') continue;
        for (const d of WEEKDAY_KEYS) {
          const t = e.days[d];
          if (typeof t !== 'string' || !HHMM.test(t)) continue;
          prog.hours[d] = [...new Set([...(prog.hours[d] ?? []), t])].sort();
        }
        if (typeof e.startDate === 'string' && ISO_DAY.test(e.startDate) && (!prog.startDate || e.startDate < prog.startDate)) prog.startDate = e.startDate;
        if (typeof e.endDate === 'string' && ISO_DAY.test(e.endDate) && (!prog.endDate || e.endDate > prog.endDate)) prog.endDate = e.endDate;
      }
    }
    const value = JSON.stringify(seeded);
    /* upsert, not create: two first requests racing must not both fail. */
    return this.prisma.appSetting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value },
      update: {},
    });
  }

  /** Replace the whole list. A custom type without a key gets one made from
   *  its name; built-ins missing from the input are kept as they were. */
  async save(input: unknown): Promise<FacilityProgram[]> {
    if (!Array.isArray(input)) throw new BadRequestException('"programs" must be a list');
    if (input.length > 30) throw new BadRequestException('Too many programs');
    const current = await this.list();
    const out: FacilityProgram[] = [];
    const seen = new Set<string>();
    for (const raw of input) {
      if (!raw || typeof raw !== 'object') throw new BadRequestException('Bad program');
      const p = raw as Record<string, any>;
      const label = typeof p.label === 'string' ? p.label.trim().slice(0, 40) : '';
      if (!label) throw new BadRequestException('Every program needs a name');
      let key = typeof p.key === 'string' && p.key ? p.key : '';
      if (!key) {
        key = 'CUSTOM_' + label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
        if (key === 'CUSTOM_') throw new BadRequestException(`"${label}" needs letters or numbers in its name`);
      }
      if (key === LESSON_KEY) throw new BadRequestException('"Lesson" is reserved');
      if (seen.has(key)) throw new BadRequestException(`Two programs are both called "${label}"`);
      seen.add(key);
      const color = typeof p.color === 'string' && HEX.test(p.color) ? p.color : '#64748b';
      const startDate = typeof p.startDate === 'string' && ISO_DAY.test(p.startDate) ? p.startDate : null;
      const endDate = typeof p.endDate === 'string' && ISO_DAY.test(p.endDate) ? p.endDate : null;
      if (startDate && endDate && startDate > endDate) {
        throw new BadRequestException(`${label}: the end date is before the start date`);
      }
      const hours: Partial<Record<WeekdayKey, string[]>> = {};
      for (const d of WEEKDAY_KEYS) {
        const list = p.hours?.[d];
        if (!Array.isArray(list)) continue;
        const times = [...new Set(list.filter((t: unknown): t is string => typeof t === 'string' && HHMM.test(t)))].sort();
        if (times.length) hours[d] = times.slice(0, 24);
      }
      const builtIn = DEFAULTS.some((d) => d.key === key);
      out.push({ key, label, color, startDate, endDate, hours, builtIn });
    }
    for (const b of current.filter((c) => c.builtIn)) {
      if (!seen.has(b.key)) out.unshift(b);
    }
    await this.prisma.appSetting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: JSON.stringify(out) },
      update: { value: JSON.stringify(out) },
    });
    const removed = current.filter((c) => !c.builtIn && !seen.has(c.key)).map((c) => c.key);
    if (removed.length) await this.removeFromSchedules(new Set(removed));
    return this.list();
  }

  /** Take removed program types off every athlete's facility schedule, so
   *  nobody is left on a program that no longer exists (it has no days or
   *  colour, and the schedule editor can't show it). */
  private async removeFromSchedules(keys: Set<string>) {
    const players = await this.prisma.player.findMany({
      where: { facilitySchedule: { not: null } },
      select: { id: true, facilitySchedule: true },
    });
    for (const pl of players) {
      let entries: any[] = [];
      try { const v = JSON.parse(pl.facilitySchedule || '[]'); if (Array.isArray(v)) entries = v; } catch { continue; }
      const kept = entries.filter((e) => !keys.has(e?.program));
      if (kept.length === entries.length) continue;
      await this.prisma.player.update({
        where: { id: pl.id },
        data: { facilitySchedule: kept.length ? JSON.stringify(kept) : null },
      });
    }
  }
}

/* ── Program-day maths (shared by the apply-calendar mapping) ── */

/** Local-date helpers on YYYY-MM-DD strings, timezone-free. */
export function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}
/** Monday of the Mon–Sun week containing `iso`. */
export function mondayOf(iso: string): string {
  const dow = parseIso(iso).getUTCDay(); // 0 = Sun
  return addDays(iso, -((dow + 6) % 7));
}
export function weekdayKeyOf(iso: string): WeekdayKey {
  return WEEKDAY_KEYS[(parseIso(iso).getUTCDay() + 6) % 7];
}

/** An athlete's picked weekdays for a program, Monday-first: index 0 is
 *  their Day 1 of the week. */
export function programDaysOf(scheduleRaw: string | null | undefined, programKey: string): WeekdayKey[] {
  let entries: any[] = [];
  try { const v = scheduleRaw ? JSON.parse(scheduleRaw) : []; if (Array.isArray(v)) entries = v; } catch { /* none */ }
  const days = new Set<WeekdayKey>();
  for (const e of entries) {
    if (e?.program !== programKey || !e.days) continue;
    for (const d of WEEKDAY_KEYS) if (e.days[d]) days.add(d);
  }
  return WEEKDAY_KEYS.filter((d) => days.has(d));
}
