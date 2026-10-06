import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/* Sales-rep contacts for each training technology (Settings → Data &
   Integrations). One shared list for the whole academy, kept as a JSON
   value in the AppSetting key/value table. */

export const VENDOR_SOURCES = [
  { key: 'TRACKMAN', label: 'Trackman' },
  { key: 'BLAST_MOTION', label: 'Blast Motion' },
  { key: 'FULL_SWING', label: 'Full Swing' },
  { key: 'HITTRAX', label: 'HitTrax' },
  { key: 'VALD', label: 'Vald Strength' },
] as const;

export interface VendorContact {
  source: string;
  label: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
}

const SETTING_KEY = 'vendorContacts';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class VendorContactsService {
  constructor(private prisma: PrismaService) {}

  async list(): Promise<VendorContact[]> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
    let saved: Record<string, Partial<VendorContact>> = {};
    try {
      const parsed = row ? JSON.parse(row.value) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed;
    } catch { /* treat as empty */ }
    return VENDOR_SOURCES.map((s) => ({
      source: s.key,
      label: s.label,
      contactName: saved[s.key]?.contactName ?? '',
      contactEmail: saved[s.key]?.contactEmail ?? '',
      contactPhone: saved[s.key]?.contactPhone ?? '',
    }));
  }

  async save(input: unknown): Promise<VendorContact[]> {
    if (!Array.isArray(input)) throw new BadRequestException('"contacts" must be a list');
    const known = new Map<string, string>(VENDOR_SOURCES.map((s) => [s.key, s.label]));
    const out: Record<string, { contactName: string; contactEmail: string; contactPhone: string }> = {};
    for (const raw of input) {
      if (!raw || typeof raw !== 'object') throw new BadRequestException('Each contact must be an object');
      const c = raw as Record<string, unknown>;
      const source = typeof c.source === 'string' ? c.source : '';
      const label = known.get(source);
      if (!label) throw new BadRequestException(`Unknown source "${source}"`);
      const text = (v: unknown, max: number, field: string) => {
        if (v === undefined || v === null) return '';
        if (typeof v !== 'string') throw new BadRequestException(`${label} ${field} must be text`);
        const t = v.trim();
        if (t.length > max) throw new BadRequestException(`${label} ${field} is too long`);
        return t;
      };
      const contactName = text(c.contactName, 100, 'contact name');
      const contactEmail = text(c.contactEmail, 200, 'email');
      const contactPhone = text(c.contactPhone, 40, 'phone');
      if (contactEmail && !EMAIL_RE.test(contactEmail)) {
        throw new BadRequestException(`${label} email doesn't look like an email address`);
      }
      out[source] = { contactName, contactEmail, contactPhone };
    }
    const value = JSON.stringify(out);
    await this.prisma.appSetting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value },
      update: { value },
    });
    return this.list();
  }
}
