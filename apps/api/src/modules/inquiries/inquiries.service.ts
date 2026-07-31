import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/* ── Input caps for the PUBLIC inquiry form ──
   `POST /inquiries` is the only unauthenticated write in the API. The global
   body parser allows 25 MB (sized for report saves), and the global
   ValidationPipe runs `transform` only — no whitelist, and this DTO carries
   no class-validator decorators — so without these caps a bot could store
   megabytes per submission. Throttling (5 per 10 min per IP) slows that but
   doesn't bound it, and the rows are never pruned. Lengths are generous
   against a real athlete's answers and tiny against an abuse payload. */
const MAX_SHORT = 200;    // names, email, phone, school, club, positions, dates
const MAX_LONG = 5_000;   // free-text answers a prospect actually types
const MAX_FORM_DATA = 20_000; // the future-proofing JSON blob

/** Trim + enforce a ceiling. Rejects rather than silently truncating, so a
 *  legitimate long answer surfaces as an error instead of being quietly cut. */
function capped(value: string | null | undefined, max: number, field: string): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) {
    throw new BadRequestException(`${field} is too long (max ${max} characters).`);
  }
  return trimmed;
}

@Injectable()
export class InquiriesService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  /** All inquiries, newest first — the coach roster. */
  findAll() {
    return this.prisma.inquiry.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string) {
    const inquiry = await this.prisma.inquiry.findUnique({ where: { id } });
    if (!inquiry) throw new NotFoundException('Inquiry not found');
    return inquiry;
  }

  /**
   * Create an inquiry from the public form (built later). Named-field
   * destructure — never spread the request body — so a crafted payload can't
   * set id / status / createdAt.
   */
  async create(data: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | null;
    school?: string | null;
    gradYear?: number | null;
    clubTeam?: string | null;
    positions?: string | null;
    birthDate?: string | null;
    otherSports?: string | null;
    injuryHistory?: string | null;
    otherHobbies?: string | null;
    goalLevel?: string | null;
    goals?: string | null;
    message?: string | null;
    formData?: string | null;
  }) {
    /* Every field is trimmed and length-capped before it reaches the DB — see
       the note on MAX_SHORT above for why this endpoint needs it. */
    const firstName = capped(data.firstName, MAX_SHORT, 'First name');
    const lastName = capped(data.lastName, MAX_SHORT, 'Last name');
    const email = capped(data.email, MAX_SHORT, 'Email');

    if (!firstName || !lastName || !email) {
      throw new BadRequestException('First name, last name and email are required.');
    }
    /* Deliberately permissive — just enough to reject junk, not a full RFC
       5322 parse, which would bounce valid addresses and gain nothing here. */
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Please enter a valid email address.');
    }
    /* Grad year is the one numeric field — clamp it to a sane window so the
       roster can't be filled with Number.MAX_SAFE_INTEGER rows. */
    const gradYear =
      data.gradYear === null || data.gradYear === undefined
        ? null
        : Number.isInteger(data.gradYear) && data.gradYear >= 1900 && data.gradYear <= 2100
          ? data.gradYear
          : (() => { throw new BadRequestException('Grad year looks invalid.'); })();

    const inquiry = await this.prisma.inquiry.create({
      data: {
        firstName,
        lastName,
        email,
        gradYear,
        phone: capped(data.phone, MAX_SHORT, 'Phone'),
        school: capped(data.school, MAX_SHORT, 'High school'),
        clubTeam: capped(data.clubTeam, MAX_SHORT, 'Club team'),
        positions: capped(data.positions, MAX_SHORT, 'Positions'),
        birthDate: capped(data.birthDate, MAX_SHORT, 'Birthday'),
        goalLevel: capped(data.goalLevel, MAX_SHORT, 'Goal level'),
        otherSports: capped(data.otherSports, MAX_LONG, 'Other sports'),
        injuryHistory: capped(data.injuryHistory, MAX_LONG, 'Injury history'),
        otherHobbies: capped(data.otherHobbies, MAX_LONG, 'Other hobbies'),
        goals: capped(data.goals, MAX_LONG, 'Goals'),
        message: capped(data.message, MAX_LONG, 'Message'),
        formData: capped(data.formData, MAX_FORM_DATA, 'Form data'),
      },
    });
    // Ping every coach's bell so a new inquiry doesn't sit unseen in the roster.
    // Fire-and-forget — a notification hiccup must not fail the public submit.
    void this.notifications.notifyAllCoaches({
      type: 'INQUIRY',
      title: 'New athlete inquiry',
      body: `${inquiry.firstName} ${inquiry.lastName} submitted an inquiry form.`,
      linkUrl: '/inquiries',
      entityId: inquiry.id,
    });
    return inquiry;
  }

  /** Coach marks an inquiry NEW → REVIEWED → ARCHIVED. */
  async updateStatus(id: string, status: string) {
    await this.findOne(id);
    return this.prisma.inquiry.update({ where: { id }, data: { status } });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.inquiry.delete({ where: { id } });
    return { id, deleted: true };
  }
}
