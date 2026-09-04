import { Global, Module } from '@nestjs/common';
import { ErrorLogService } from './error-log.service';
import { WebhookEventService } from './webhook-event.service';

/**
 * Global like PrismaModule -- ErrorLogService/WebhookEventService are needed
 * from call sites that have nothing else to do with each other (the global
 * exception filter, the three separate webhook controllers, platform-admin
 * read endpoints), so requiring every consumer to import this module would
 * just be boilerplate repeated at each site.
 */
@Global()
@Module({
  providers: [ErrorLogService, WebhookEventService],
  exports: [ErrorLogService, WebhookEventService],
})
export class MonitoringModule {}
