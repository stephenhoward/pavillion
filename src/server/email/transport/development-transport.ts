import nodemailer from 'nodemailer';
import path from 'path';
import fs from 'fs/promises';
import { MailConfig } from '@/server/email/model/types';
import { MailTransport } from '@/server/email/transport/mail-transport';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('email');

/**
 * Development transport that writes emails to the file system.
 *
 * Used for local npm development without Docker. Saves email content
 * to .eml files in a configurable output directory and logs to console.
 */
export class DevelopmentTransport extends MailTransport {

  constructor(private mailConfig: MailConfig) {
    super();

    const settings = mailConfig.settings;

    // Default to log directory in project root
    const outputDir = process.env.MAIL_OUTPUT_DIR ||
                settings.outputDir ||
                path.join(process.cwd(), 'logs', 'mail');

    // Whether to log to console (defaults to true)
    const consoleOutput = true;

    this.transport = nodemailer.createTransport({
      name: 'development',
      version: '1.0.0',
      send: async (mail, callback) => {
        try {
          // Build the email content
          const message = mail.message.createReadStream();
          let messageContent = '';
          for await (const chunk of message) {
            messageContent += chunk.toString();
          }

          // Extract email data for simpler logging
          const { from, to } = mail.message.getEnvelope();
          const subject = mail.data.subject;
          const timestamp = new Date().toISOString().replace(/[:\.]/g, '-');
          const sanitizedSubject = (subject || 'no-subject').replace(/[^a-z0-9]/gi, '-').substring(0, 30);
          const sanitizedTo = (typeof to === 'string' ? to : to.join('-')).replace(/[^a-z0-9@\.]/gi, '-');


          // Ensure the output directory exists
          try {
            await fs.mkdir(outputDir, { recursive: true });
          }
          catch (err) {
            logger.error({ err, outputDir }, 'Failed to create mail output directory');
          }

          // Generate filename with timestamp, recipient and subject
          const filename = `${timestamp}-${sanitizedTo}-${sanitizedSubject}.eml`;
          const filePath = path.join(outputDir, filename);

          // Write to file
          await fs.writeFile(filePath, messageContent, 'utf8');

          // Log to console if enabled
          if (consoleOutput) {
            logger.info({ from, to, subject, filePath }, 'Email sent (development mode)');
          }

          // Return success
          callback(null, {
            messageId: `<development-${Date.now()}@${sanitizedTo}>`,
            envelope: mail.message.getEnvelope(),
            filePath: filePath,
          });
        }
        catch (err) {
          logger.error({ err }, 'Failed to save email to file');
          callback(err as Error);
        }
      },
    });
  }
}
