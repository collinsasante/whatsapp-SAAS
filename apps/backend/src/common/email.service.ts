import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;
  private fromAddress: string;
  private replyToDefault: string;

  constructor(private readonly config: ConfigService) {
    this.fromAddress = config.get<string>('SMTP_FROM', 'notifications@verzchat.com');
    this.replyToDefault = config.get<string>('SMTP_REPLY_TO', 'support@verzchat.com');

    const host = config.get<string>('SMTP_HOST');
    const user = config.get<string>('SMTP_USER');
    const pass = config.get<string>('SMTP_PASS');

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port: config.get<number>('SMTP_PORT', 587),
        secure: config.get<boolean>('SMTP_SECURE', false),
        auth: { user, pass },
      });
      this.logger.log(`Email service ready (SMTP: ${host})`);
    } else {
      this.logger.warn('SMTP credentials not set (SMTP_HOST, SMTP_USER, SMTP_PASS) — emails will be logged only');
    }
  }

  private async send(opts: {
    to: string;
    subject: string;
    html: string;
    replyTo?: string;
  }): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[Email not sent — SMTP not configured] To: ${opts.to} | Subject: ${opts.subject}`);
      return;
    }
    try {
      const info = await this.transporter.sendMail({
        from: `VerzChat <${this.fromAddress}>`,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        replyTo: opts.replyTo,
      });
      this.logger.log(`Email sent to ${opts.to} (id: ${info.messageId})`);
    } catch (err) {
      this.logger.error(`Failed to send email to ${opts.to}: ${String(err)}`);
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
    const replyTo = opts.inviterEmail
      ? `${opts.inviterName} <${opts.inviterEmail}>`
      : `VerzChat Support <${this.replyToDefault}>`;

    const expiryStr = opts.expiresAt.toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
        <tr><td style="background:linear-gradient(135deg,#0d9488,#0f766e);padding:32px 40px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">You&rsquo;re invited!</h1>
        </td></tr>
        <tr><td style="padding:36px 40px">
          <p style="margin:0 0 12px;color:#374151;font-size:15px">Hi${opts.inviteeName ? ' ' + opts.inviteeName : ''},</p>
          <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6">
            <strong>${opts.inviterName}</strong> has invited you to join <strong>${opts.workspaceName}</strong> on VerzChat.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px">
            <tr><td style="border-radius:8px;background:#0d9488">
              <a href="${opts.inviteLink}" style="display:inline-block;padding:13px 32px;color:#fff;font-size:15px;font-weight:600;text-decoration:none">Accept Invitation</a>
            </td></tr>
          </table>
          <p style="margin:0 0 24px;color:#0d9488;font-size:12px;word-break:break-all;text-align:center">${opts.inviteLink}</p>
          <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center">Expires ${expiryStr}.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    await this.send({
      to: opts.to,
      subject: `${opts.inviterName} invited you to join ${opts.workspaceName}`,
      html,
      replyTo,
    });
  }

  async sendEmailVerification(opts: { to: string; name: string; verifyLink: string }): Promise<void> {
    const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
        <tr><td style="background:linear-gradient(135deg,#0d9488,#0f766e);padding:32px 40px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">Verify your email</h1>
        </td></tr>
        <tr><td style="padding:36px 40px">
          <p style="margin:0 0 12px;color:#374151;font-size:15px">Hi ${opts.name},</p>
          <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6">Click below to verify your email and activate your account.</p>
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px">
            <tr><td style="border-radius:8px;background:#0d9488">
              <a href="${opts.verifyLink}" style="display:inline-block;padding:13px 32px;color:#fff;font-size:15px;font-weight:600;text-decoration:none">Verify Email Address</a>
            </td></tr>
          </table>
          <p style="margin:0 0 24px;color:#0d9488;font-size:12px;word-break:break-all;text-align:center">${opts.verifyLink}</p>
          <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center">This link expires in 24 hours.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    await this.send({ to: opts.to, subject: 'Verify your VerzChat email address', html });
  }

  async sendOtpCode(opts: { to: string; name: string; code: string }): Promise<void> {
    const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
        <tr><td style="background:linear-gradient(135deg,#0d9488,#0f766e);padding:32px 40px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">Your sign-in code</h1>
        </td></tr>
        <tr><td style="padding:36px 40px;text-align:center">
          <p style="margin:0 0 20px;color:#374151;font-size:15px">Hi ${opts.name}, here is your one-time sign-in code:</p>
          <div style="display:inline-block;background:#f0fdf9;border:2px solid #0d9488;border-radius:12px;padding:18px 40px;margin-bottom:20px">
            <span style="font-size:36px;font-weight:800;letter-spacing:8px;color:#0d9488;font-family:'Courier New',monospace">${opts.code}</span>
          </div>
          <p style="margin:0;color:#6b7280;font-size:13px">Expires in <strong>10 minutes</strong>.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    await this.send({ to: opts.to, subject: `${opts.code} — your VerzChat sign-in code`, html });
  }

  async sendPasswordReset(opts: { to: string; name: string; resetLink: string }): Promise<void> {
    const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
        <tr><td style="background:linear-gradient(135deg,#0d9488,#0f766e);padding:32px 40px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">Reset your password</h1>
        </td></tr>
        <tr><td style="padding:36px 40px">
          <p style="margin:0 0 12px;color:#374151;font-size:15px">Hi ${opts.name},</p>
          <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6">Click below to reset your password. This link expires in 1 hour.</p>
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px">
            <tr><td style="border-radius:8px;background:#0d9488">
              <a href="${opts.resetLink}" style="display:inline-block;padding:13px 32px;color:#fff;font-size:15px;font-weight:600;text-decoration:none">Reset Password</a>
            </td></tr>
          </table>
          <p style="margin:0 0 24px;color:#0d9488;font-size:12px;word-break:break-all;text-align:center">${opts.resetLink}</p>
          <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center">If you didn&rsquo;t request this, ignore it.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    await this.send({ to: opts.to, subject: 'Reset your VerzChat password', html });
  }

  async sendRaw(opts: { to: string; from?: string; subject: string; html: string }): Promise<void> {
    await this.send({ to: opts.to, subject: opts.subject, html: opts.html });
  }
}
