/**
 * Transactional email sender for travel-module notifications.
 *
 * SMTP is configured entirely through environment variables (SMTP_HOST,
 * SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM). When SMTP_HOST is unset the
 * module throws EMAIL_NOT_CONFIGURED so the notification worker can mark the
 * delivery FAILED — visible and retryable — instead of silently dropping mail.
 * Secrets are never logged here.
 */

import nodemailer from "nodemailer";

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
}

export interface SendEmailResult {
  providerId: string;
}

export async function sendEmail({ to, subject, text }: SendEmailInput): Promise<SendEmailResult> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    throw new Error("EMAIL_NOT_CONFIGURED");
  }
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM ?? user ?? "wacontrol@localhost";

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
  });

  const info = await transporter.sendMail({ from, to, subject, text });
  return { providerId: info.messageId ?? "smtp" };
}
