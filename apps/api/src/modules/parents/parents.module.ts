import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ParentsController } from './parents.controller';
import { ParentsService } from './parents.service';

@Module({
  imports: [AuthModule],
  controllers: [ParentsController],
  providers: [ParentsService],
})
export class ParentsModule {}
