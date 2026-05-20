import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend | null = null;
  private fromAddress: string;
  private replyToDefault: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = config.get<string>('RESEND_API_KEY');
    this.fromAddress = config.get<string>('SMTP_FROM', 'notifications@verzchat.com');
    this.replyToDefault = config.get<string>('SMTP_REPLY_TO', 'support@verzchat.com');

    if (apiKey) {
      this.resend = new Resend(apiKey);
    } else {
      this.logger.warn('RESEND_API_KEY not set — invite emails will be logged only');
    }
  }

  async sendInvite(opts: {
    to: string;
    inviteeName: string | undefined;
    inviterName: string;
    inviterEmail: string | undefined;
    workspaceName: string;
    inviteLink: string;
    expiresAt: Date;
  }): Promise<void> {
    const from = `VerzChat <${this.fromAddress}>`;
    const replyTo = opts.inviterEmail
      ? `${opts.inviterName} <${opts.inviterEmail}>`
      : `VerzChat Support <${this.replyToDefault}>`;
    const subject = `${opts.inviterName} invited you to join ${opts.workspaceName}`;

    const expiryStr = opts.expiresAt.toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
        <tr><td style="background:linear-gradient(135deg,#0d9488,#0f766e);padding:32px 40px;text-align:center">
          <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;letter-spacing:-0.3px">You&rsquo;re invited!</h1>
        </td></tr>
        <tr><td style="padding:36px 40px">
          <p style="margin:0 0 12px;color:#374151;font-size:15px">
            Hi${opts.inviteeName ? ' ' + opts.inviteeName : ''},
          </p>
          <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6">
            <strong>${opts.inviterName}</strong> has invited you to join the <strong>${opts.workspaceName}</strong> workspace on VerzChat.
            Click the button below to accept and set up your account.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px">
            <tr><td style="border-radius:8px;background:#0d9488">
              <a href="${opts.inviteLink}" target="_blank"
                style="display:inline-block;padding:13px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.1px">
                Accept Invitation
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-align:center">
            Or copy this link into your browser:
          </p>
          <p style="margin:0 0 24px;color:#0d9488;font-size:12px;word-break:break-all;text-align:center">
            ${opts.inviteLink}
          </p>
          <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center">
            This invitation expires on ${expiryStr}.
          </p>
        </td></tr>
        <tr><td style="padding:20px 40px;border-top:1px solid #f3f4f6;text-align:center">
          <p style="margin:0;color:#d1d5db;font-size:11px">
            If you didn&rsquo;t expect this invitation you can safely ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    if (!this.resend) {
      this.logger.log(`[Invite email — Resend not configured] To: ${opts.to} | Link: ${opts.inviteLink}`);
      return;
    }

    try {
      await this.resend.emails.send({ from, to: opts.to, subject, html, replyTo });
      this.logger.log(`Invite email sent to ${opts.to}`);
    } catch (err) {
      this.logger.error(`Failed to send invite email to ${opts.to}: ${String(err)}`);
    }
  }
}
