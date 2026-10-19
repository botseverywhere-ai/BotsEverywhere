import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'

export interface OutboundMail {
  to: string
  subject: string
  text: string
  /** Present for sign-in codes so the dev mailer can print it. Never log this when using SES or Resend. */
  code?: string
}

export interface Mailer {
  send(mail: OutboundMail): Promise<void>
}

export function createMailer(env: NodeJS.ProcessEnv = process.env): Mailer {
  const provider = (env.MAIL_PROVIDER || 'console').toLowerCase()
  if (provider === 'ses') return sesMailer(env)
  if (provider === 'resend') return resendMailer(env)
  return consoleMailer()
}

export function consoleMailer(): Mailer {
  return {
    async send(mail) {
      const code = mail.code ? ` code=${mail.code}` : ''
      console.info(`[botseverywhere] mail to=${mail.to} subject="${mail.subject}"${code}`)
      if (mail.code) console.info(`[botseverywhere] sign-in code for ${mail.to}: ${mail.code}`)
    },
  }
}

function sesMailer(env: NodeJS.ProcessEnv): Mailer {
  const from = env.SES_FROM
  if (!from) throw new Error('SES_FROM is required when MAIL_PROVIDER=ses')
  const client = new SESClient({ region: env.AWS_REGION || 'us-east-1' })
  return {
    async send(mail) {
      await client.send(
        new SendEmailCommand({
          Source: from,
          Destination: { ToAddresses: [mail.to] },
          Message: {
            Subject: { Data: mail.subject, Charset: 'UTF-8' },
            Body: { Text: { Data: mail.text, Charset: 'UTF-8' } },
          },
        }),
      )
    },
  }
}

function resendMailer(env: NodeJS.ProcessEnv): Mailer {
  const key = env.RESEND_API_KEY
  const from = env.RESEND_FROM
  if (!key || !from) throw new Error('RESEND_API_KEY and RESEND_FROM are required when MAIL_PROVIDER=resend')
  return {
    async send(mail) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
        }),
      })
      if (!response.ok) {
        const detail = await response.text()
        throw new Error(`Resend failed (${response.status}): ${detail.slice(0, 200)}`)
      }
    },
  }
}

export function signInMessage(code: string): { subject: string; text: string } {
  return {
    subject: 'Your BotsEverywhere sign-in code',
    text: `Your BotsEverywhere sign-in code is ${code}.\n\nIt expires in 10 minutes. If you did not ask for this, you can ignore this email.\n`,
  }
}

export function inviteMessage(input: { teamName: string; url: string; role: string }): { subject: string; text: string } {
  return {
    subject: `Join ${input.teamName} on BotsEverywhere`,
    text: `You are invited to ${input.teamName} as ${input.role}.\n\nOpen this link and sign in with this email address:\n${input.url}\n\nThe link expires in 7 days.\n`,
  }
}
