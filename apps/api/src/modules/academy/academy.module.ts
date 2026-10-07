import { Global, Module } from '@nestjs/common';
import { AcademyController } from './academy.controller';
import { AcademyService } from './academy.service';

/**
 * Global: MailService (itself global) reads the academy name / logo / email
 * wording on every send, and auth + inquiries check the new-athlete switch.
 * AcademyService depends only on Prisma, so there's no cycle.
 */
@Global()
@Module({
  controllers: [AcademyController],
  providers: [AcademyService],
  exports: [AcademyService],
})
export class AcademyModule {}
