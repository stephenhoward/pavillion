/**
 * Email message composition utilities live in common so other domains can
 * compose messages without crossing the email domain boundary. Re-exported
 * here for the email domain's own use.
 */
export { EmailMessage, compileTemplate } from '@/server/common/email/message';
