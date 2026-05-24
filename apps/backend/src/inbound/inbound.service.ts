import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../common/email.service';

@Injectable()
export class InboundService {
  private readonly logger = new Logger(InboundService.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
  ) {}

  async handleInboundEmail(payload: Record<string, unknown>) {
    // Resend wraps email fields inside payload.data
    const data = (payload['data'] as Record<string, unknown> | undefined) ?? payload;
    const raw = (data['from'] as string) ?? '';
    const subject = (data['subject'] as string) ?? '(no subject)';
    const text = (data['text'] as string) ?? '';
    const html = (data['html'] as string) ?? '';

    // Parse "Name <email>" or plain email
    const match = /^(?:(.*?)\s*<([^>]+)>|(.+))$/.exec(raw.trim());
    const senderEmail = (match?.[2] ?? match?.[3] ?? raw).trim().toLowerCase();

    const forwardTo = this.config.get<string>('SUPPORT_FORWARD_EMAIL', 'support@verzchat.com');
    const bodyHtml = html || `<pre>${text}</pre>`;

    await this.emailService.sendRaw({
      to: forwardTo,
      subject: `[support] ${subject}`,
      html: `
        <p><strong>From:</strong> ${raw}</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <hr style="margin:16px 0" />
        ${bodyHtml}
      `,
    }).catch((err: unknown) => {
      this.logger.error('Failed to forward inbound email', (err as Error).message);
    });

    this.logger.log(`Inbound email from ${senderEmail} forwarded to ${forwardTo}`);
  }
}
