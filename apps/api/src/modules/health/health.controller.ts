import { Controller, Get, HttpCode, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../auth/jwt.guard';

@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  /**
   * Liveness + readiness probe. Returns 200 only when the DB responds —
   * that's what ECS / Fargate / k8s need to take an unhealthy task out of
   * rotation. The previous version returned 200 on a degraded DB which
   * silently kept broken containers in the load balancer pool.
   */
  @Public()
  @Get()
  @HttpCode(200)
  async check() {
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return {
        status: 'ok',
        database: 'connected',
        uptimeSec: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new HttpException(
        {
          status: 'degraded',
          database: 'disconnected',
          timestamp: new Date().toISOString(),
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
