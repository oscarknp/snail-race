import { config } from "../config.ts";

interface Mail {
  to: string;
  subject: string;
  text: string;
}

// Sends through SMTP when SMTP_HOST is configured; otherwise prints the message to the
// server log so password reset links still work in local development.
export async function sendMail(mail: Mail): Promise<void> {
  const { smtpHost, smtpPort, smtpUser, smtpPass, from } = config.mail;
  if (!smtpHost) {
    if (config.isProd) console.warn("[mail] SMTP_HOST not configured; email not sent");
    console.log(`\n[mail] To: ${mail.to}\n[mail] Subject: ${mail.subject}\n${mail.text}\n`);
    return;
  }
  const nodemailer = await import("npm:nodemailer@6.9.16");
  const transport = nodemailer.default.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: smtpUser ? { user: smtpUser, pass: smtpPass } : undefined,
  });
  await transport.sendMail({ from, ...mail });
}
