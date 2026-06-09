import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AirtableService {
  private readonly logger = new Logger(AirtableService.name);

  constructor(private readonly prisma: PrismaService) {}

  async pushNewLead(tenantId: string, contact: { name: string | null; phone: string }, firstMessage?: string | null) {
    const raw = await this.prisma.tenantSettings.findUnique({ where: { tenantId } });
    const settings = raw as typeof raw & { airtableEnabled?: boolean; airtableApiKey?: string | null; airtableBaseId?: string | null; airtableTableName?: string | null };
    if (!settings?.airtableEnabled || !settings.airtableApiKey || !settings.airtableBaseId || !settings.airtableTableName) return;

    const url = `https://api.airtable.com/v0/${settings.airtableBaseId}/${encodeURIComponent(settings.airtableTableName)}`;

    const fields: Record<string, string> = {
      Name: contact.name ?? contact.phone,
      Phone: contact.phone,
      Source: 'VerzChat',
      Date: new Date().toISOString(),
      Status: 'New Lead',
    };
    if (firstMessage) fields['First Message'] = firstMessage;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.airtableApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ records: [{ fields }] }),
      });
      if (!res.ok) {
        const body = await res.text();
        this.logger.warn(`Airtable push failed [${res.status}]: ${body}`);
      }
    } catch (err) {
      this.logger.warn(`Airtable push error: ${String(err)}`);
    }
  }
}
