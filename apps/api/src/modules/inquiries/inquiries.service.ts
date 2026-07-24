import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

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
    const {
      firstName, lastName, email, phone, school, gradYear, clubTeam, positions,
      birthDate, otherSports, injuryHistory, otherHobbies, goalLevel, goals,
      message, formData,
    } = data;
    const inquiry = await this.prisma.inquiry.create({
      data: {
        firstName, lastName, email, phone, school, gradYear, clubTeam, positions,
        birthDate, otherSports, injuryHistory, otherHobbies, goalLevel, goals,
        message, formData,
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
