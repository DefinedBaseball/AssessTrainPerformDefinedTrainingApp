import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/* ─────────────────────────────────────────────────────────────────────────────
   POSTS — the coach dashboard feed

   Four tags, and the tag decides the audience:

     GENERAL / COACHING / ANNOUNCEMENT   staff only. Never leaves the coach
                                         dashboard, never notifies a player.
     ATHLETES_ANNOUNCEMENT               coaches PLUS the players picked by
                                         the post's audience fields.

   That split is enforced HERE, not in the UI: `findAll` filters what a player
   is allowed to see back, so a player hitting GET /posts directly still gets
   only the announcements addressed to them.
   ─────────────────────────────────────────────────────────────────────────── */

/** The one tag that can reach players. */
const ATHLETES_TAG = 'ATHLETES_ANNOUNCEMENT';

type Viewer = { id: string; role: string; playerId?: string | null };

@Injectable()
export class PostsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  /**
   * The feed, scoped to who is asking.
   *
   * Coaches get everything, each post carrying `seen` — whether THIS coach has
   * flagged it, which is what lets the dashboard keep an urgent post pinned
   * for everyone else after one coach clears it.
   *
   * Players get only ATHLETES_ANNOUNCEMENT posts addressed to them, and never
   * a `seen` flag (the pinning behaviour is a coach-dashboard thing).
   */
  async findAll(viewer: Viewer, limit = 50, offset = 0) {
    const include = {
      author: { select: { id: true, email: true, role: true } },
      taggedPlayer: { select: { id: true, firstName: true, lastName: true, positions: true, profilePhoto: true } },
    };

    if (viewer.role !== 'COACH') {
      /* Audience matching can't be expressed as a single SQL predicate (the
         INDIVIDUAL scope stores a CSV, and PROGRAM has to look at the
         player's own tags), so pull the candidate rows and filter in JS. The
         feed is small and already capped by `limit`. */
      const player = viewer.playerId
        ? await this.prisma.player.findUnique({
            where: { id: viewer.playerId },
            select: { id: true, athleteTypes: true },
          })
        : null;
      if (!player) return [];

      const candidates = await this.prisma.post.findMany({
        where: { type: ATHLETES_TAG },
        orderBy: { createdAt: 'desc' },
        include,
      });
      return candidates
        .filter((p) => this.postTargetsPlayer(p, player))
        .slice(offset, offset + limit);
    }

    const posts = await this.prisma.post.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        ...include,
        seenBy: { where: { userId: viewer.id }, select: { id: true } },
      },
    });
    return posts.map(({ seenBy, ...p }) => ({ ...p, seen: seenBy.length > 0 }));
  }

  async create(authorId: string, data: {
    type: string;
    title: string;
    body?: string;
    imageUrl?: string;
    videoUrl?: string;
    linkUrl?: string;
    urgency?: string;
    taggedPlayerId?: string;
    audienceScope?: string;
    audiencePlayerIds?: string;
    audienceProgram?: string;
  }) {
    /* A staff-only tag is always COACHES no matter what the client sent —
       the audience fields only mean anything on an Athletes Announcement. */
    const isAthletes = data.type === ATHLETES_TAG;
    const post = await this.prisma.post.create({
      data: {
        type: data.type,
        title: data.title,
        body: data.body,
        imageUrl: data.imageUrl,
        videoUrl: data.videoUrl,
        linkUrl: data.linkUrl,
        urgency: data.urgency || 'NORMAL',
        taggedPlayerId: data.taggedPlayerId,
        audienceScope: isAthletes ? (data.audienceScope || 'ALL_PLAYERS') : 'COACHES',
        audiencePlayerIds: isAthletes ? (data.audiencePlayerIds || '') : '',
        audienceProgram: isAthletes ? (data.audienceProgram ?? null) : null,
        authorId,
      },
      include: {
        author: { select: { id: true, email: true, role: true } },
        taggedPlayer: { select: { id: true, firstName: true, lastName: true, positions: true, profilePhoto: true } },
      },
    });

    /* Fan out (best-effort — NotificationsService never throws). Every post
       is staff news first, so coaches always get one. */
    await this.notifications.notifyAllCoaches(
      {
        type: 'ANNOUNCEMENT',
        title: `New post: ${post.title}`,
        linkUrl: '/',
        actorId: authorId,
        entityId: post.id,
      },
      authorId,
    );

    if (isAthletes) {
      /* Resolving the audience hits the DB, so unlike notifyMany it CAN
         throw. The post row already exists by this point — letting that
         bubble up would 500 a create that actually succeeded, which is how
         a bad query here first showed up as phantom duplicate posts. */
      try {
        const recipients = await this.resolveAudienceUserIds(post);
        if (recipients.length > 0) {
          await this.notifications.notifyMany(recipients, {
            type: 'ANNOUNCEMENT',
            title: `New announcement: ${post.title}`,
            linkUrl: '/',
            actorId: authorId,
            entityId: post.id,
          });
        }
      } catch {
        /* Swallowed on purpose: the announcement is saved and visible to its
           audience on next load; only the push notification is lost. */
      }
    }

    return post;
  }

  async update(postId: string, data: {
    type?: string;
    title?: string;
    body?: string;
    imageUrl?: string;
    videoUrl?: string;
    linkUrl?: string;
    urgency?: string;
    taggedPlayerId?: string;
    audienceScope?: string;
    audiencePlayerIds?: string;
    audienceProgram?: string;
  }) {
    /* Editing a post down to a staff-only tag has to clear the audience with
       it, or a post that no longer shows an audience picker would keep
       silently matching players in `findAll`. */
    const next = { ...data };
    if (data.type && data.type !== ATHLETES_TAG) {
      next.audienceScope = 'COACHES';
      next.audiencePlayerIds = '';
      next.audienceProgram = undefined;
    }
    return this.prisma.post.update({
      where: { id: postId },
      data: next,
      include: {
        author: { select: { id: true, email: true, role: true } },
        taggedPlayer: { select: { id: true, firstName: true, lastName: true, positions: true, profilePhoto: true } },
      },
    });
  }

  async delete(postId: string) {
    return this.prisma.post.delete({ where: { id: postId } });
  }

  /**
   * Per-coach "Flag as Seen". Idempotent: clicking twice (or two tabs racing)
   * leaves the one row the unique index allows.
   */
  async markSeen(postId: string, userId: string) {
    await this.prisma.postSeen.upsert({
      where: { postId_userId: { postId, userId } },
      create: { postId, userId },
      update: {},
    });
    return { seen: true };
  }

  /* ── Audience resolution ── */

  /** Does an Athletes Announcement reach this particular player? */
  private postTargetsPlayer(
    post: { audienceScope: string; audiencePlayerIds: string; audienceProgram: string | null },
    player: { id: string; athleteTypes: string | null },
  ): boolean {
    switch (post.audienceScope) {
      case 'ALL_PLAYERS':
        return true;
      case 'INDIVIDUAL':
        return csv(post.audiencePlayerIds).includes(player.id);
      case 'PROGRAM':
        return !!post.audienceProgram && csv(player.athleteTypes).includes(post.audienceProgram);
      default:
        /* COACHES, or anything unrecognised — treat as staff-only. Failing
           closed matters more here than being lenient. */
        return false;
    }
  }

  /** User ids (not Player ids) of the players an announcement is aimed at. */
  private async resolveAudienceUserIds(post: {
    audienceScope: string;
    audiencePlayerIds: string;
    audienceProgram: string | null;
  }): Promise<string[]> {
    if (post.audienceScope === 'ALL_PLAYERS') {
      const users = await this.prisma.user.findMany({
        where: { role: 'PLAYER', status: 'ACTIVE' },
        select: { id: true },
      });
      return users.map((u) => u.id);
    }

    if (post.audienceScope === 'INDIVIDUAL') {
      const ids = csv(post.audiencePlayerIds);
      if (ids.length === 0) return [];
      const users = await this.prisma.user.findMany({
        // The FK lives on Player.userId, so this walks the relation — there
        // is no playerId column on User to filter by.
        where: { role: 'PLAYER', status: 'ACTIVE', player: { id: { in: ids } } },
        select: { id: true },
      });
      return users.map((u) => u.id);
    }

    if (post.audienceScope === 'PROGRAM' && post.audienceProgram) {
      /* `contains` narrows the scan, but it is a substring test — the exact
         CSV-token check below is what actually decides, so a future tag that
         happens to contain another can't leak. */
      const players = await this.prisma.player.findMany({
        where: { athleteTypes: { contains: post.audienceProgram } },
        select: { id: true, athleteTypes: true },
      });
      const playerIds = players
        .filter((p) => csv(p.athleteTypes).includes(post.audienceProgram!))
        .map((p) => p.id);
      if (playerIds.length === 0) return [];
      const users = await this.prisma.user.findMany({
        where: { role: 'PLAYER', status: 'ACTIVE', player: { id: { in: playerIds } } },
        select: { id: true },
      });
      return users.map((u) => u.id);
    }

    return [];
  }
}

/** Split one of the comma-separated code/id columns into exact tokens. */
function csv(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}
