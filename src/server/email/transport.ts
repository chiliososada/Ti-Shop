import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

import type { EmailRuntimeEnv } from "@/server/email/config";

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type EmailSendResult = { messageId: string };

export type EmailSender = (
  env: EmailRuntimeEnv,
  email: OutgoingEmail,
) => Promise<EmailSendResult>;

let cachedTransporter: Transporter | null = null;
let cachedTransporterKey: string | null = null;

function getTransporter(env: EmailRuntimeEnv): Transporter {
  const key = `${env.host}:${env.port}:${env.secure}:${env.user}`;
  if (!cachedTransporter || cachedTransporterKey !== key) {
    cachedTransporter = nodemailer.createTransport({
      host: env.host,
      port: env.port,
      secure: env.secure,
      auth: { user: env.user, pass: env.password },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    cachedTransporterKey = key;
  }
  return cachedTransporter;
}

export const sendViaSmtp: EmailSender = async (env, email) => {
  const info = await getTransporter(env).sendMail({
    from: { name: env.fromName, address: env.fromAddress },
    to: email.to,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
  return { messageId: info.messageId };
};
