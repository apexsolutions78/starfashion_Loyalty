import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config';
import { logger } from '../utils/logger';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

function isSmtpConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_PASSWORD && env.SMTP_PASSWORD !== 'change_me');
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
        : undefined,
    });
  }
  return transporter;
}

export class MailService {
  static async send(message: MailMessage): Promise<{ delivered: boolean; mode: 'smtp' | 'log' }> {
    const from = env.MAIL_FROM || 'noreply@starfashion.local';

    if (env.NODE_ENV === 'production' && isSmtpConfigured()) {
      try {
        await getTransporter().sendMail({ from, ...message });
        logger.info('Email sent', { to: message.to, subject: message.subject });
        return { delivered: true, mode: 'smtp' };
      } catch (err) {
        logger.error('SMTP send failed', {
          to: message.to,
          subject: message.subject,
          error: err instanceof Error ? err.message : String(err),
        });
        // Do not fall through to logging the full body in production — it contains tokens
        return { delivered: false, mode: 'log' };
      }
    }

    if (env.NODE_ENV === 'production') {
      logger.warn('Email not sent (SMTP unconfigured in production)', {
        to: message.to,
        subject: message.subject,
      });
      return { delivered: false, mode: 'log' };
    }

    // Dev only: write full email to log so tokens are visible during local development
    logger.info('EMAIL (dev log mode)', {
      to: message.to,
      from,
      subject: message.subject,
      text: message.text,
    });
    // eslint-disable-next-line no-console
    console.log('\n========== EMAIL ==========');
    // eslint-disable-next-line no-console
    console.log(`To:      ${message.to}`);
    // eslint-disable-next-line no-console
    console.log(`Subject: ${message.subject}`);
    // eslint-disable-next-line no-console
    console.log(message.text);
    // eslint-disable-next-line no-console
    console.log('===========================\n');
    return { delivered: true, mode: 'log' };
  }

  static async sendVerificationEmail(
    to: string,
    fullName: string,
    token: string,
  ): Promise<{ delivered: boolean; mode: 'smtp' | 'log'; link: string }> {
    const link = `${env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
    const result = await this.send({
      to,
      subject: 'Verify your Star Fashion email',
      text: [
        `Hi ${fullName || 'there'},`,
        '',
        'Welcome to the Star Fashion Loyalty Program!',
        '',
        'Verify your email by opening this link (valid 10 minutes):',
        link,
        '',
        `Or use this token via POST /api/auth/verify-contact:`,
        token,
        '',
        'If you did not create this account, ignore this email.',
      ].join('\n'),
      html: [
        `<p>Hi ${fullName || 'there'},</p>`,
        `<p>Welcome to the <strong>Star Fashion Loyalty Program</strong>!</p>`,
        `<p><a href="${link}">Verify your email</a> (valid 10 minutes).</p>`,
        `<p>Or use token: <code>${token}</code></p>`,
      ].join('\n'),
    });
    return { ...result, link };
  }

  static async sendVerificationOtp(
    to: string,
    otp: string,
  ): Promise<{ delivered: boolean; mode: 'smtp' | 'log' }> {
    return this.send({
      to,
      subject: 'Your Star Fashion verification code',
      text: [
        'Your verification code is:',
        '',
        `  ${otp}`,
        '',
        'Valid for 10 minutes. Do not share this code.',
      ].join('\n'),
      html: `<p>Your verification code is:</p><p style="font-size:24px;letter-spacing:6px"><strong>${otp}</strong></p><p>Valid for 10 minutes.</p>`,
    });
  }

  static async sendPasswordReset(
    to: string,
    token: string,
  ): Promise<{ delivered: boolean; mode: 'smtp' | 'log'; link: string }> {
    const link = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
    const result = await this.send({
      to,
      subject: 'Reset your Star Fashion password',
      text: [
        'Reset your password by opening this link (valid 1 hour):',
        link,
        '',
        `Token: ${token}`,
        '',
        'If you did not request this, ignore this email.',
      ].join('\n'),
      html: `<p><a href="${link}">Reset your password</a> (valid 1 hour).</p><p>Token: <code>${token}</code></p>`,
    });
    return { ...result, link };
  }
}
