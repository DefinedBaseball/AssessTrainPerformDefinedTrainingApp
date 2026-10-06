import { Module } from '@nestjs/common';
import { VendorContactsController } from './vendor-contacts.controller';
import { VendorContactsService } from './vendor-contacts.service';

@Module({
  controllers: [VendorContactsController],
  providers: [VendorContactsService],
})
export class VendorContactsModule {}
