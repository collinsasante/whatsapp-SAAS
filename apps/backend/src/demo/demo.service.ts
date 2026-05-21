import { Injectable, Logger, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../common/email.service';
import { ConfigService } from '@nestjs/config';
import { CreateDemoDto } from './dto/create-demo.dto';
import { Throttle } from '@nestjs/throttler';

const COMPETITORS = ['AiSensy', 'Respond.io', 'Interakt', 'WATI', 'Zoko', 'Twilio'];
const COMPANY_SIZE_SCORE: Record<string, number> = {
  '1-5': 0, '6-20': 10, '21-100': 25, '101-500': 40, '500+': 50,
};
const AVAILABLE_TIMES = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];

function calcLeadScore(dto: CreateDemoDto): { score: number; tier: string; priority: number } {
  let score = 0;
  score += COMPANY_SIZE_SCORE[dto.companySize] ?? 10;
  if (dto.currentPlatform && COMPETITORS.includes(dto.currentPlatform)) score += 30;
  else if (dto.currentPlatform === 'WhatsApp Business') score += 15;
  else if (!dto.currentPlatform || dto.currentPlatform === 'None') score += 5;
  else score += 10;
  const isPersonalEmail = /gmail|yahoo|hotmail|outlook\.com$/i.test(dto.workEmail.split('@')[1] ?? '');
  if (!isPersonalEmail) score += 15;
  if (dto.goals && dto.goals.trim().length > 10) score += 10;

  let tier = 'standard';
  let priority = 1;
  if (score >= 60) { tier = 'enterprise'; priority = 5; }
  else if (score >= 35) { tier = 'high-intent'; priority = dto.currentPlatform && COMPETITORS.includes(dto.currentPlatform) ? 4 : 3; }
  else if (score >= 20) { tier = 'warm'; priority = 2; }

  return { score, tier, priority };
}

@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  async getAvailableSlots(dateStr: string): Promise<string[]> {
    const date = new Date(dateStr);
    const day = date.getUTCDay();
    if (day === 0 || day === 6) return []; // weekend

    const booked = await this.prisma.demoRequest.findMany({
      where: {
        preferredDate: { gte: new Date(date.toISOString().split('T')[0]), lt: new Date(new Date(date.getTime() + 86400000).toISOString().split('T')[0]) },
        status: { notIn: ['lost', 'cancelled'] },
      },
      select: { preferredTime: true },
    });
    const bookedTimes = new Set(booked.map((r) => r.preferredTime));
    return AVAILABLE_TIMES.filter((t) => !bookedTimes.has(t));
  }

  async create(dto: CreateDemoDto, ip?: string): Promise<{ id: string; message: string }> {
    // Prevent duplicate bookings from same email within 7 days
    const recent = await this.prisma.demoRequest.findFirst({
      where: { workEmail: dto.workEmail, createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
    });
    if (recent) throw new ConflictException('A demo request from this email was recently submitted.');

    // Validate requested slot is still available
    const available = await this.getAvailableSlots(dto.preferredDate);
    if (!available.includes(dto.preferredTime)) {
      throw new BadRequestException('That time slot is no longer available. Please choose another.');
    }

    const { score, tier, priority } = calcLeadScore(dto);
    const preferredDate = new Date(dto.preferredDate);

    const demo = await this.prisma.demoRequest.create({
      data: {
        fullName: dto.fullName,
        workEmail: dto.workEmail,
        phoneNumber: dto.phoneNumber,
        businessName: dto.businessName,
        businessType: dto.businessType,
        companySize: dto.companySize,
        currentPlatform: dto.currentPlatform,
        preferredDate,
        preferredTime: dto.preferredTime,
        timezone: dto.timezone,
        goals: dto.goals,
        leadScore: score,
        leadTier: tier,
        priority,
        status: 'new',
        statusHistory: {
          create: { fromStatus: null, toStatus: 'new' },
        },
      },
    });

    void this.sendNotifications(demo, score, tier).catch((err) =>
      this.logger.error('Demo notification error', err),
    );

    return { id: demo.id, message: 'Demo booked successfully' };
  }

  private async sendNotifications(demo: { id: string; fullName: string; workEmail: string; businessName: string; preferredDate: Date; preferredTime: string; timezone: string; leadTier: string; leadScore: number; goals: string | null }, score: number, tier: string) {
    const adminEmail = this.config.get<string>('ADMIN_DEMO_EMAIL', 'support@verzchat.com');
    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'https://verzchat.com');
    const dateStr = demo.preferredDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const tierBadge = tier === 'enterprise' ? '🏢 Enterprise' : tier === 'high-intent' ? '🔥 High-Intent' : '⭐ Standard';

    // Customer confirmation
    await this.email.sendRaw({
      to: demo.workEmail,
      from: `VerzChat <${this.config.get('SMTP_FROM', 'notifications@verzchat.com')}>`,
      subject: `Your demo is confirmed — ${dateStr} at ${demo.preferredTime}`,
      html: `
<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
  <tr><td style="background:linear-gradient(135deg,#104a25,#196633);padding:40px;text-align:center">
    <p style="color:rgba(255,255,255,.7);margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:1px">Demo Confirmed</p>
    <h1 style="color:#fff;margin:0;font-size:28px;font-weight:800">You're all set, ${demo.fullName.split(' ')[0]}!</h1>
  </td></tr>
  <tr><td style="padding:40px">
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:28px">
      <p style="margin:0 0 4px;font-size:12px;color:#16a34a;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Your demo slot</p>
      <p style="margin:0;font-size:20px;font-weight:700;color:#111">${dateStr}</p>
      <p style="margin:4px 0 0;font-size:16px;color:#374151">${demo.preferredTime} · ${demo.timezone}</p>
    </div>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 20px">
      Our team will walk you through how VerzChat can transform how <strong>${demo.businessName}</strong> handles customer conversations on WhatsApp.
    </p>
    <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 28px">
      We'll be in touch before the session with a meeting link. In the meantime, feel free to reply to this email with any questions.
    </p>
    <p style="color:#6b7280;font-size:13px;margin:0">— The VerzChat Team</p>
  </td></tr>
  <tr><td style="padding:20px 40px;border-top:1px solid #f3f4f6;text-align:center">
    <p style="margin:0;color:#d1d5db;font-size:11px">VerzChat · verzchat.com</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`,
    });

    // Admin notification
    await this.email.sendRaw({
      to: adminEmail,
      from: `VerzChat Leads <${this.config.get('SMTP_FROM', 'notifications@verzchat.com')}>`,
      subject: `${tierBadge} New demo request — ${demo.businessName} (score: ${score})`,
      html: `
<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#f4f4f5;margin:0;padding:32px 16px">
<table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;padding:32px;margin:0 auto">
  <tr><td>
    <h2 style="margin:0 0 4px;color:#111">New Demo Request</h2>
    <p style="margin:0 0 24px;color:#6b7280;font-size:13px">${tierBadge} · Lead Score: <strong>${score}</strong></p>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${[
        ['Name', demo.fullName],
        ['Email', demo.workEmail],
        ['Company', demo.businessName],
        ['Date', `${dateStr} at ${demo.preferredTime} (${demo.timezone})`],
        ['Goals', demo.goals || '—'],
      ].map(([k, v]) => `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:100px">${k}</td><td style="padding:6px 0;color:#111;font-size:14px;font-weight:500">${v}</td></tr>`).join('')}
    </table>
    <a href="${frontendUrl}/platform-admin/demos/${demo.id}" style="display:inline-block;margin-top:24px;padding:11px 24px;background:#104a25;color:#fff;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">View in Admin →</a>
  </td></tr>
</table>
</body></html>`,
    });
  }

  async list(query: { status?: string; tier?: string; page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.tier) where.leadTier = query.tier;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.demoRequest.findMany({ where, skip, take: limit, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }], include: { notes: { orderBy: { createdAt: 'desc' } }, statusHistory: { orderBy: { createdAt: 'desc' }, take: 5 } } }),
      this.prisma.demoRequest.count({ where }),
    ]);

    return { data, meta: { total, page, limit, pages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    return this.prisma.demoRequest.findUniqueOrThrow({
      where: { id },
      include: { notes: { orderBy: { createdAt: 'desc' } }, statusHistory: { orderBy: { createdAt: 'desc' } } },
    });
  }

  async updateStatus(id: string, status: string, changedBy?: string) {
    const demo = await this.prisma.demoRequest.findUniqueOrThrow({ where: { id } });
    return this.prisma.$transaction([
      this.prisma.demoRequest.update({ where: { id }, data: { status } }),
      this.prisma.leadStatusHistory.create({ data: { demoRequestId: id, fromStatus: demo.status, toStatus: status, changedBy } }),
    ]);
  }

  async addNote(id: string, content: string, authorName?: string) {
    await this.prisma.demoRequest.findUniqueOrThrow({ where: { id } });
    return this.prisma.leadNote.create({ data: { demoRequestId: id, content, authorName } });
  }

  async getStats() {
    const [total, byStatus, byTier] = await this.prisma.$transaction([
      this.prisma.demoRequest.count(),
      this.prisma.demoRequest.groupBy({ by: ['status'], _count: { id: true }, orderBy: { _count: { id: 'desc' } } }),
      this.prisma.demoRequest.groupBy({ by: ['leadTier'], _count: { id: true }, _avg: { leadScore: true }, orderBy: { _count: { id: 'desc' } } }),
    ]);
    return { total, byStatus, byTier };
  }
}
