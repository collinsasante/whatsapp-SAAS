import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESClient, SendEmailCommand, SendEmailCommandInput } from '@aws-sdk/client-ses';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private ses: SESClient | null = null;
  private fromAddress: string;
  private replyToDefault: string;

  constructor(private readonly config: ConfigService) {
    this.fromAddress = config.get<string>('SMTP_FROM', 'notifications@verzchat.com');
    this.replyToDefault = config.get<string>('SMTP_REPLY_TO', 'support@verzchat.com');

    const accessKeyId = config.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = config.get<string>('AWS_SECRET_ACCESS_KEY');
    const region = config.get<string>('AWS_REGION', 'us-east-1');

    if (accessKeyId && secretAccessKey) {
      this.ses = new SESClient({
        region,
        credentials: { accessKeyId, secretAccessKey },
      });
    } else {
      this.logger.warn('AWS credentials not set — emails will be logged only');
    }
  }

  private async send(input: SendEmailCommandInput, label: string): Promise<void> {
    if (!this.ses) {
      this.logger.log(`[${label} — SES not configured] To: ${JSON.stringify(input.Destination?.ToAddresses)}`);
      return;
    }
    try {
      const result = await this.ses.send(new SendEmailCommand(input));
      this.logger.log(`${label} sent (MessageId: ${result.MessageId})`);
    } catch (err) {
      this.logger.error(`${label} failed: ${String(err)}`);
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
          <p style="margin:0 0 12px;color:#374151;font-size:15px">Hi${opts.inviteeName ? ' ' + opts.inviteeName : ''},</p>
          <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6">
            <strong>${opts.inviterName}</strong> has invited you to join <strong>${opts.workspaceName}</strong> on VerzChat.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px">
            <tr><td style="border-radius:8px;background:#0d9488">
              <a href="${opts.inviteLink}" target="_blank"
                style="display:inline-block;padding:13px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">
                Accept Invitation
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 24px;color:#0d9488;font-size:12px;word-break:break-all;text-align:center">${opts.inviteLink}</p>
          <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center">Expires ${expiryStr}.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    await this.send({
      Source: `VerzChat <${this.fromAddress}>`,
      Destination: { ToAddresses: [opts.to] },
      ReplyToAddresses: [replyTo],
      Message: {
        Subject: { Data: `${opts.inviterName} invited you to join ${opts.workspaceName}`, Charset: 'UTF-8' },
        Body: { Html: { Data: html, Charset: 'UTF-8' } },
      },
    }, `Invite email to ${opts.to}`);
  }

  async sendEmailVerification(opts: { to: string; name: string; verifyLink: string }): Promise<void> {
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
        <tr><td style="background:linear-gradient(135deg,#0d9488,#0f766e);padding:32px 40px;text-align:center">
          <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;letter-spacing:-0.3px">Verify your email</h1>
        </td></tr>
        <tr><td style="padding:36px 40px">
          <p style="margin:0 0 12px;color:#374151;font-size:15px">Hi ${opts.name},</p>
          <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6">
            Click below to verify your email and activate your VerzChat account.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px">
            <tr><td style="border-radius:8px;background:#0d9488">
              <a href="${opts.verifyLink}" target="_blank"
                style="display:inline-block;padding:13px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">
                Verify Email Address
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 24px;color:#0d9488;font-size:12px;word-break:break-all;text-align:center">${opts.verifyLink}</p>
          <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center">This link expires in 24 hours.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    await this.send({
      Source: `VerzChat <${this.fromAddress}>`,
      Destination: { ToAddresses: [opts.to] },
      Message: {
        Subject: { Data: 'Verify your VerzChat email address', Charset: 'UTF-8' },
        Body: { Html: { Data: html, Charset: 'UTF-8' } },
      },
    }, `Verification email to ${opts.to}`);
  }

  async sendOtpCode(opts: { to: string; name: string; code: string }): Promise<void> {
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
        <tr><td style="background:linear-gradient(135deg,#0d9488,#0f766e);padding:32px 40px;text-align:center">
          <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700">Your sign-in code</h1>
        </td></tr>
        <tr><td style="padding:36px 40px;text-align:center">
          <p style="margin:0 0 20px;color:#374151;font-size:15px">Hi ${opts.name}, here is your one-time sign-in code:</p>
          <div style="display:inline-block;background:#f0fdf9;border:2px solid #0d9488;border-radius:12px;padding:18px 40px;margin-bottom:20px">
            <span style="font-size:36px;font-weight:800;letter-spacing:8px;color:#0d9488;font-family:'Courier New',monospace">${opts.code}</span>
          </div>
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px">Expires in <strong>10 minutes</strong>.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    await this.send({
      Source: `VerzChat <${this.fromAddress}>`,
      Destination: { ToAddresses: [opts.to] },
      Message: {
        Subject: { Data: `${opts.code} — your VerzChat sign-in code`, Charset: 'UTF-8' },
        Body: { Html: { Data: html, Charset: 'UTF-8' } },
      },
    }, `OTP email to ${opts.to}`);
  }

  async sendPasswordReset(opts: { to: string; name: string; resetLink: string }): Promise<void> {
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
        <tr><td style="background:linear-gradient(135deg,#0d9488,#0f766e);padding:32px 40px;text-align:center">
          <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700">Reset your password</h1>
        </td></tr>
        <tr><td style="padding:36px 40px">
          <p style="margin:0 0 12px;color:#374151;font-size:15px">Hi ${opts.name},</p>
          <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6">
            Click below to reset your VerzChat password. This link expires in 1 hour.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px">
            <tr><td style="border-radius:8px;background:#0d9488">
              <a href="${opts.resetLink}" target="_blank"
                style="display:inline-block;padding:13px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">
                Reset Password
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 24px;color:#0d9488;font-size:12px;word-break:break-all;text-align:center">${opts.resetLink}</p>
          <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center">If you didn&rsquo;t request this, ignore it.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    await this.send({
      Source: `VerzChat <${this.fromAddress}>`,
      Destination: { ToAddresses: [opts.to] },
      Message: {
        Subject: { Data: 'Reset your VerzChat password', Charset: 'UTF-8' },
        Body: { Html: { Data: html, Charset: 'UTF-8' } },
      },
    }, `Password reset email to ${opts.to}`);
  }

  async sendRaw(opts: { to: string; from?: string; subject: string; html: string }): Promise<void> {
    const source = opts.from ?? `VerzChat <${this.fromAddress}>`;
    await this.send({
      Source: source,
      Destination: { ToAddresses: [opts.to] },
      Message: {
        Subject: { Data: opts.subject, Charset: 'UTF-8' },
        Body: { Html: { Data: opts.html, Charset: 'UTF-8' } },
      },
    }, `Email to ${opts.to}: ${opts.subject}`);
  }
}
