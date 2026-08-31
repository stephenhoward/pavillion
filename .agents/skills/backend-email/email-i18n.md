# Email Internationalization

Email templates use Handlebars with i18next integration. Always provide both HTML and text versions.

## File Structure

Each email type has three files:

```
src/server/{domain}/
├── templates/
│   ├── {email_name}.html.hbs   # HTML template
│   └── {email_name}.text.hbs   # Plaintext template
src/server/locales/
└── en/
    └── {email_name}.json       # Translations
```

## Translation File Format

Namespace matches email name. Include `subject` key:

```json
{
  "subject": "Password Reset Request",
  "title": "Password Reset Request",
  "greeting": "Hello,",
  "instructions": "We received a request to reset your password...",
  "button": "Reset Password",
  "signature": "Thank you,",
  "team_name": "The Pavillion Team"
}
```

## Template Usage

Use `{{t 'key'}}` helper for translations:

```handlebars
<h1>{{t 'title'}}</h1>
<p>{{t 'greeting'}}</p>
<p>{{t 'instructions'}}</p>

<a href="{{resetUrl}}?code={{token}}">{{t 'button'}}</a>

<p>{{t 'signature'}}<br>{{t 'team_name'}}</p>
```

## EmailMessage Base Class

Extend `EmailMessage` for each email type:

```typescript
import { EmailMessage, compileTemplate } from '@/server/email/model/message';

class PasswordResetEmail extends EmailMessage {
  constructor() {
    super(
      'password_reset_email',  // namespace
      compileTemplate(__dirname, 'password_reset_email.text.hbs'),
      compileTemplate(__dirname, 'password_reset_email.html.hbs')
    );
  }

  buildMessage(language: string): MailData {
    return {
      subject: this.renderSubject(language, {}),
      text: this.renderPlaintext(language, { resetUrl, token }),
      html: this.renderHtml(language, { resetUrl, token }),
    };
  }
}
```

## Rules

- Always provide both `.html.hbs` and `.text.hbs` templates
- Translation namespace must match the email file name
- Include `subject` key in every translation file
- Pass `language` to `buildMessage()` for user's preferred language
