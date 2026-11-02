import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { UserRole } from '@whatsapp-platform/shared-types';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { ManageSettingsController } from './manage-settings.controller';
import { ManageSettingsService } from './manage-settings.service';
import { UpdateAiSettingsDto, UpdateOffHoursDto, UpdateOptInOutDto, UpdateWelcomeDto, UpdateWidgetDto } from './dto/settings.dto';

/**
 * Regression: PATCH /manage/settings/{off-hours,opt-in-out,widget,welcome,ai} took an untyped body and spread it straight into
 * tenantSettings, so any logged-in user could set takeRatePct (the platform fee), paymentVerificationRequired, maxAgents,
 * aiTrialApprovedAt (the admin approval step), airtable credentials or even tenantId. Two layers now stop that: the DTOs reject unknown
 * fields, and the service copies only the fields each route owns.
 */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });
const validate = (metatype: new () => object, body: unknown) => pipe.transform(body, { type: 'body', metatype });

const PROTECTED = {
  takeRatePct: 0, paymentVerificationRequired: false, maxAgents: 999, commerceEnabled: true, aiTrialApprovedAt: '2020-01-01', aiTrialStartedAt: '2020-01-01',
  airtableApiKey: 'x', airtableEnabled: true, replyDeadlineMinutes: 1, tenantId: 'another-workspace', id: 'x', deliveryEnabled: true, aiRestrictedToPhone: '+1',
};

describe.each([
  ['off-hours', UpdateOffHoursDto, { offHoursEnabled: true, offHoursMessage: 'Closed', offHoursSchedule: { mon: { enabled: true, start: '09:00', end: '18:00' } } }],
  ['opt-in-out', UpdateOptInOutDto, { optOutKeywords: ['STOP'], optInKeywords: ['START'], optOutReply: 'ok', optInReply: 'ok' }],
  ['widget', UpdateWidgetDto, { widgetEnabled: true, widgetConfig: { color: '#000' } }],
  ['welcome', UpdateWelcomeDto, { welcomeEnabled: true, welcomeMessage: 'Hi' }],
  ['ai', UpdateAiSettingsDto, { aiEnabled: true, aiAlwaysOn: false, aiPersonality: 'friendly', aiMode: 'SUGGESTION', aiPilotGroup: false }],
] as const)('PATCH /manage/settings/%s', (route, Dto, good) => {
  it('accepts what its screen sends', async () => {
    await expect(validate(Dto, good)).resolves.toBeDefined();
  });

  it.each(Object.entries(PROTECTED))('rejects the protected field %s', async (field, value) => {
    await expect(validate(Dto, { ...good, [field]: value })).rejects.toThrow();
  });

  it('is limited to workspace admins', () => {
    const handler = ({ 'off-hours': 'updateOffHours', 'opt-in-out': 'updateOptInOut', widget: 'updateWidget', welcome: 'updateWelcome', ai: 'updateAi' } as const)[route];
    const roles = Reflect.getMetadata(ROLES_KEY, ManageSettingsController.prototype[handler]);
    expect(roles).toEqual([UserRole.ADMIN, UserRole.SUPER_ADMIN]);
  });
});

describe('ManageSettingsService writes only the fields a route owns, even if a caller passes more', () => {
  const build = () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = { tenantSettings: { upsert, findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new ManageSettingsService(prisma as never, {} as never, {} as never, { getJob: jest.fn(), add: jest.fn() } as never);
    return { service, upsert };
  };
  const smuggled = { ...PROTECTED };

  it.each([
    ['updateOffHours', { offHoursEnabled: true }],
    ['updateOptInOut', { optOutReply: 'bye' }],
    ['updateWidget', { widgetEnabled: true }],
    ['updateWelcome', { welcomeEnabled: true }],
  ] as const)('%s drops smuggled fields', async (method, legit) => {
    const { service, upsert } = build();
    await (service as unknown as Record<string, (t: string, d: object) => Promise<unknown>>)[method]('t1', { ...legit, ...smuggled });
    const call = upsert.mock.calls[0][0];
    expect(call.where).toEqual({ tenantId: 't1' });
    expect(call.create.tenantId).toBe('t1');
    for (const key of Object.keys(PROTECTED)) {
      expect(call.update).not.toHaveProperty(key);
      if (key !== 'tenantId') expect(call.create).not.toHaveProperty(key);
    }
    expect(call.update).toMatchObject(legit);
  });

  it('updateAi drops smuggled fields', async () => {
    const { service, upsert } = build();
    await service.updateAi('t1', { aiPersonality: 'calm', ...smuggled } as never);
    const call = upsert.mock.calls[0][0];
    for (const key of Object.keys(PROTECTED)) expect(call.update).not.toHaveProperty(key);
    expect(call.create.tenantId).toBe('t1');
    expect(call.update.aiPersonality).toBe('calm');
  });
});
