import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { RealtimeModule } from './realtime/realtime.module';
import { TenantMiddleware } from './common/middleware/tenant.middleware';
import { AuthModule } from './auth/auth.module';
import { TenantModule } from './tenant/tenant.module';
import { UsersModule } from './users/users.module';
import { ContactsModule } from './contacts/contacts.module';
import { ConversationsModule } from './conversations/conversations.module';
import { MessagesModule } from './messages/messages.module';
import { TemplatesModule } from './templates/templates.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { AutomationModule } from './automation/automation.module';
import { MediaModule } from './media/media.module';
import { AuditModule } from './audit/audit.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ActivityLogModule } from './activity-log/activity-log.module';
import { ChannelsModule } from './channels/channels.module';
import { CallsModule } from './calls/calls.module';
import { NotificationsModule } from './notifications/notifications.module';
import { CannedResponsesModule } from './canned-responses/canned-responses.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { ChatbotFlowsModule } from './chatbot-flows/chatbot-flows.module';
import { TagsModule } from './manage/tags/tags.module';
import { AttributesModule } from './manage/attributes/attributes.module';
import { WebhooksModule } from './manage/webhooks/webhooks.module';
import { ManageSettingsModule } from './manage/settings/manage-settings.module';
import { SegmentsModule } from './segments/segments.module';
import { BillingModule } from './billing/billing.module';
import { TeamsModule } from './teams/teams.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { PlatformAdminModule } from './platform-admin/platform-admin.module';
import { FeedbackModule } from './feedback/feedback.module';
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module';
import { DemoModule } from './demo/demo.module';
import { FeatureFlagsModule } from './feature-flags/feature-flags.module';
import { ReleaseModule } from './release/release.module';
import { WhatsAppNumbersModule } from './whatsapp-numbers/whatsapp-numbers.module';
import { PublicModule } from './public/public.module';
import { InboundModule } from './inbound/inbound.module';
import appConfig from './config/app.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: ['.env'],
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('THROTTLE_TTL', 60000),
          limit: config.get<number>('THROTTLE_LIMIT', 100),
        },
      ],
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD'),
        },
      }),
    }),
    PrismaModule,
    RealtimeModule,
    AuthModule,
    TenantModule,
    UsersModule,
    ContactsModule,
    ConversationsModule,
    MessagesModule,
    TemplatesModule,
    CampaignsModule,
    AutomationModule,
    MediaModule,
    AuditModule,
    WhatsappModule,
    DashboardModule,
    ActivityLogModule,
    ChannelsModule,
    CallsModule,
    NotificationsModule,
    CannedResponsesModule,
    ApiKeysModule,
    ChatbotFlowsModule,
    TagsModule,
    AttributesModule,
    WebhooksModule,
    ManageSettingsModule,
    SegmentsModule,
    BillingModule,
    TeamsModule,
    WorkspaceModule,
    PlatformAdminModule,
    FeedbackModule,
    KnowledgeBaseModule,
    DemoModule,
    FeatureFlagsModule,
    ReleaseModule,
    WhatsAppNumbersModule,
    PublicModule,
    InboundModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
