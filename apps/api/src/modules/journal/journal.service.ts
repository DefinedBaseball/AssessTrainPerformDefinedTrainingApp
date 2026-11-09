import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/* ─────────────────────────────────────────────────────────────────────────
   Athlete Journal.

   Per area (Hitting, Pitching, Catching, Infield, Outfield) the coaches set
   a list of questions (Settings → Journal). An athlete answers them from
   the Journal on their profile; every save is a dated entry, kept as
   history. Coaches read an athlete's entries for an area under "Personal
   Notes" on that area's report tab. Parents never see the journal.

   Each entry stores the question TEXT next to each answer, so editing or
   removing a question later never rewrites what an athlete already wrote.
   ───────────────────────────────────────────────────────────────────────── */

export const JOURNAL_AREAS = ['hitting', 'pitching', 'catching', 'infield', 'outfield'] as const;
export type JournalArea = (typeof JOURNAL_AREAS)[number];

const AREA_WORD: Record<JournalArea, string> = {
  hitting: 'hitting', pitching: 'pitching', catching: 'catching', infield: 'infield', outfield: 'outfield',
};

/** Starting questions for an area that has never had any. Coaches edit them. */
function defaultQuestions(area: JournalArea): string[] {
  const w = AREA_WORD[area];
  return [
    `What did you work on in today's ${w} session?`,
    'What felt good today?',
    'What was a challenge, and how did you respond to it?',
    `What do you want to focus on in your next ${w} session?`,
  ];
}

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_QUESTIONS = 20;
const MAX_QUESTION_LEN = 300;
const MAX_ANSWER_LEN = 5000;
const MAX_THOUGHTS_LEN = 10000;

export interface JournalAnswer { questionId: string | null; question: string; answer: string }

function isArea(a: unknown): a is JournalArea {
  return typeof a === 'string' && (JOURNAL_AREAS as readonly string[]).includes(a);
}

function parseAnswers(raw: string | null | undefined): JournalAnswer[] {
  try {
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

@Injectable()
export class JournalService {
  constructor(private prisma: PrismaService) {}

  // ── Questions ────────────────────────────────────────────────────────

  /** An area's active questions in order. Seeds the defaults the first time
   *  an area is asked for, so a brand-new academy has a usable journal. */
  async listQuestions(area: string) {
    if (!isArea(area)) throw new BadRequestException('Unknown journal area');
    const ever = await this.prisma.journalQuestion.count({ where: { area } });
    if (ever === 0) {
      await this.prisma.journalQuestion.createMany({
        data: defaultQuestions(area).map((text, order) => ({ area, text, order })),
      });
    }
    return this.prisma.journalQuestion.findMany({
      where: { area, active: true },
      orderBy: { order: 'asc' },
      select: { id: true, area: true, text: true, order: true },
    });
  }

  /**
   * Replace an area's question list (Settings → Journal). Listed ids are
   * kept and re-ordered; new rows are created; questions left out are
   * retired (active = false), never deleted, so old entries still read.
   */
  async saveQuestions(area: string, input: unknown) {
    if (!isArea(area)) throw new BadRequestException('Unknown journal area');
    const list = Array.isArray(input) ? input : [];
    if (list.length > MAX_QUESTIONS) throw new BadRequestException(`At most ${MAX_QUESTIONS} questions per area`);
    const clean = list.map((q: any) => ({
      id: typeof q?.id === 'string' && q.id ? q.id : null,
      text: typeof q?.text === 'string' ? q.text.trim() : '',
    }));
    if (clean.some((q) => !q.text)) throw new BadRequestException('A question cannot be blank');
    if (clean.some((q) => q.text.length > MAX_QUESTION_LEN)) throw new BadRequestException('A question is too long');

    await this.listQuestions(area); // make sure the defaults exist first
    const existing = await this.prisma.journalQuestion.findMany({ where: { area }, select: { id: true } });
    const known = new Set(existing.map((q) => q.id));
    const keep = new Set(clean.filter((q) => q.id && known.has(q.id)).map((q) => q.id as string));

    await this.prisma.$transaction([
      this.prisma.journalQuestion.updateMany({
        where: { area, id: { notIn: [...keep] } },
        data: { active: false },
      }),
      ...clean.map((q, order) => (q.id && known.has(q.id)
        ? this.prisma.journalQuestion.update({ where: { id: q.id }, data: { text: q.text, order, active: true } })
        : this.prisma.journalQuestion.create({ data: { area, text: q.text, order } }))),
    ]);
    return this.listQuestions(area);
  }

  // ── Entries ──────────────────────────────────────────────────────────

  /** An athlete's entries (one area, or all), newest first. */
  async listEntries(playerId: string, area?: string) {
    if (!playerId) throw new BadRequestException('playerId is required');
    if (area && !isArea(area)) throw new BadRequestException('Unknown journal area');
    const rows = await this.prisma.journalEntry.findMany({
      where: { playerId, ...(area ? { area } : {}) },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
    return rows.map((r) => this.present(r));
  }

  async createEntry(playerId: string, dto: any) {
    if (!playerId) throw new ForbiddenException('Only athletes write journal entries');
    const area = dto?.area;
    if (!isArea(area)) throw new BadRequestException('Unknown journal area');
    const { date, answers, thoughts } = await this.cleanEntry(area, dto);
    const row = await this.prisma.journalEntry.create({
      data: { playerId, area, date, answers: JSON.stringify(answers), thoughts },
    });
    return this.present(row);
  }

  async updateEntry(playerId: string, id: string, dto: any) {
    const row = await this.ownEntry(playerId, id);
    const { date, answers, thoughts } = await this.cleanEntry(row.area as JournalArea, dto, row);
    const saved = await this.prisma.journalEntry.update({
      where: { id },
      data: { date, answers: JSON.stringify(answers), thoughts },
    });
    return this.present(saved);
  }

  async deleteEntry(playerId: string, id: string) {
    await this.ownEntry(playerId, id);
    await this.prisma.journalEntry.delete({ where: { id } });
    return { ok: true };
  }

  private async ownEntry(playerId: string, id: string) {
    const row = await this.prisma.journalEntry.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('That journal entry no longer exists');
    if (!playerId || row.playerId !== playerId) throw new ForbiddenException('You can only change your own journal');
    return row;
  }

  /**
   * Validate an entry. Answers are matched to the area's questions by id
   * and stored WITH the question text. Answers to a question that has since
   * been retired keep the text they were written against (from `prior`).
   */
  private async cleanEntry(area: JournalArea, dto: any, prior?: { answers: string; date: string }) {
    const date = typeof dto?.date === 'string' && ISO_DAY_RE.test(dto.date) ? dto.date : prior?.date;
    if (!date) throw new BadRequestException('date must be YYYY-MM-DD');

    const questions = await this.prisma.journalQuestion.findMany({ where: { area }, select: { id: true, text: true } });
    const textOf = new Map(questions.map((q) => [q.id, q.text]));
    const priorText = new Map(parseAnswers(prior?.answers).map((a) => [a.questionId, a.question]));

    const raw = Array.isArray(dto?.answers) ? dto.answers.slice(0, MAX_QUESTIONS) : [];
    const answers: JournalAnswer[] = [];
    for (const a of raw) {
      const questionId = typeof a?.questionId === 'string' ? a.questionId : null;
      const answer = typeof a?.answer === 'string' ? a.answer.trim() : '';
      if (answer.length > MAX_ANSWER_LEN) throw new BadRequestException('An answer is too long');
      const question = (questionId && (textOf.get(questionId) ?? priorText.get(questionId))) || null;
      if (!question) continue; // not one of this area's questions
      if (answer) answers.push({ questionId, question, answer });
    }
    const thoughts = typeof dto?.thoughts === 'string' && dto.thoughts.trim() ? dto.thoughts.trim() : null;
    if (thoughts && thoughts.length > MAX_THOUGHTS_LEN) throw new BadRequestException('Your thoughts are too long');
    if (answers.length === 0 && !thoughts) throw new BadRequestException('Answer at least one question or add your thoughts');
    return { date, answers, thoughts };
  }

  private present(r: { id: string; playerId: string; area: string; date: string; answers: string; thoughts: string | null; createdAt: Date; updatedAt: Date }) {
    return {
      id: r.id,
      playerId: r.playerId,
      area: r.area,
      date: r.date,
      answers: parseAnswers(r.answers),
      thoughts: r.thoughts,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
