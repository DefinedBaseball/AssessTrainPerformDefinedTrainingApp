import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/* The option lists behind each per-drill drop-down on a Modular set
   (Settings → Drills: Hitting's Feed Type / Implement / Situation / Goal,
   Pitching's Reps / Tool / Intensity-Goal). One academy-wide JSON value in
   AppSetting; a list nobody has edited yet is its default below. The web
   app keeps the same defaults (apps/web/src/lib/drill-options.ts). */

const DEFAULTS: Record<string, Record<string, string[]>> = {
  hitting: {
    feed: [
      'Tee', 'Side Toss', 'Soft Toss', 'Overhead Soft Toss', 'Batting Practice', 'Machine', 'IPitch',
      '1B Angle', '3B Angle', 'Low Angle', 'High Angle', 'Close', 'Far',
      '20 ft', '30 ft', '40 ft', '50 ft', 'Slow', 'Firm', 'Extra Firm',
      '50 mph', '60 mph', '70 mph', '80 mph', '90 mph', '100 mph',
    ],
    implement: [
      'Short Bat', '1 Hand Trainer', 'End Load Trainer', 'Handle Load Trainer', 'Power Trainer', 'Bazooka',
      'Underload Trainer', 'V-Paddle', 'V-Bat', 'Smash Trainer', 'Light Skinny Bat', 'Heavy Skinny Bat', 'Cricket Bat',
      'Fat Grip', 'Black Farm Band', 'Red Farm Band', 'Decel Vest', 'Farm Board Long', 'Farm Board Short',
      'Yoga Blocks', 'Bosu Ball', 'Wedge', 'Bucket', 'Havoc', 'Vector Bands', 'Farm Sled', 'Water Ball',
      'Water Bag (Heavy)', 'Water Bag (Light)', '2x Water Ball', '3oz Ball', '200g Ball', '250g Ball',
      '7oz Tater Ball', 'Tater Ball', 'Driveline Ball', 'Wiffle Ball', 'Tennis Ball', 'Soccer Ball',
      'Mini Wiffle Ball',
    ],
    situation: [
      'Fastball', 'Carry Fastball', '2-Seam', 'Sinker', 'Slider', 'Sweeper', 'Slurve', '12-6', 'Changeup',
      'Splitter', 'Mix', '0-0', '1-1', '2-0', '0-2', '3-1', '3-2', 'Infield In', 'Infield Back',
      'Get Him Over', 'Get Him In', 'Game on the Line',
    ],
    goal: ['Line Drive', 'Ground Ball', 'Fly Ball', 'Pull', 'Middle', 'Oppo', 'Oppo Foul', 'Pull Foul'],
  },
  pitching: {
    reps: ['2', '4', '6', '8', '10', '12'],
    tool: [],
    intensity: ['30%', '40%', '50%', '60%', '70%', '80%', '90%', '100%'],
  },
};

const SETTING_KEY = 'drillOptions';
const MAX_LEN = 60;
const MAX_OPTIONS = 300;

type Lists = Record<string, Record<string, string[]>>;

@Injectable()
export class DrillOptionsService {
  constructor(private prisma: PrismaService) {}

  /** Every list: the saved one where edited, else the default. */
  async list(): Promise<Lists> {
    const saved = await this.saved();
    const out: Lists = {};
    for (const [tab, fields] of Object.entries(DEFAULTS)) {
      out[tab] = {};
      for (const [field, defaults] of Object.entries(fields)) {
        out[tab][field] = saved[tab]?.[field] ?? [...defaults];
      }
    }
    return out;
  }

  async add(tab: string, field: string, raw: unknown): Promise<Lists> {
    this.check(tab, field);
    const value = this.clean(field, raw);
    const lists = await this.list();
    const current = lists[tab][field];
    if (current.some((o) => o.toLowerCase() === value.toLowerCase())) {
      throw new BadRequestException(`"${value}" is already on this list`);
    }
    if (current.length >= MAX_OPTIONS) throw new BadRequestException('This list is full');
    return this.write(tab, field, [...current, value]);
  }

  async remove(tab: string, field: string, raw: unknown): Promise<Lists> {
    this.check(tab, field);
    const value = typeof raw === 'string' ? raw.trim() : '';
    const lists = await this.list();
    return this.write(tab, field, lists[tab][field].filter((o) => o !== value));
  }

  private check(tab: string, field: string) {
    if (!DEFAULTS[tab] || !DEFAULTS[tab][field]) throw new BadRequestException('Unknown drop-down');
  }

  private clean(field: string, raw: unknown): string {
    if (typeof raw !== 'string') throw new BadRequestException('Option must be text');
    const value = raw.trim().replace(/\s+/g, ' ');
    if (!value) throw new BadRequestException('Option is empty');
    if (value.length > MAX_LEN) throw new BadRequestException(`Options are ${MAX_LEN} characters at most`);
    if (field === 'reps' && !/^\d{1,3}$/.test(value)) throw new BadRequestException('Reps must be a number');
    return value;
  }

  private async saved(): Promise<Lists> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
    try {
      const parsed = row ? JSON.parse(row.value) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private async write(tab: string, field: string, options: string[]): Promise<Lists> {
    const saved = await this.saved();
    saved[tab] = { ...(saved[tab] || {}), [field]: options };
    const value = JSON.stringify(saved);
    await this.prisma.appSetting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value },
      update: { value },
    });
    return this.list();
  }
}
