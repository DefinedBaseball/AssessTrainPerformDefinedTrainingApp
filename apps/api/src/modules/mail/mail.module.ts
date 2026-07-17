import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * Global so any module can inject MailService without re-importing (auth for
 * reset/welcome, notifications for the email channel later). MailService has
 * no dependencies of its own — just env + fetch — so there's no risk of a
 * circular import.
 */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
