# Translated Model Pattern

Multilingual content uses `TranslatedModel` base class with language-keyed content objects.

## Structure

```typescript
// Model with translatable content
class Calendar extends TranslatedModel<CalendarContent> {
  _content: Record<string, CalendarContent> = {}; // {en: {...}, fr: {...}}

  content(language: string): CalendarContent {
    if (!this._content[language]) {
      this._content[language] = new CalendarContent(language);
    }
    return this._content[language];
  }
}

// Content class for translatable fields
class CalendarContent extends TranslatedContentModel {
  language: string;
  title: string = '';
  description: string = '';
}
```

## Usage

```typescript
// Get or create content for a language
const content = calendar.content('fr');
content.title = 'Mon Calendrier';

// Check if content exists
if (calendar.hasContent('fr')) { ... }

// Add content from external source
calendar.addContent(CalendarContent.fromObject(data));
```

## Fallback Order

1. Requested language
2. Instance's configured primary language
3. English (`en`)

## Serialization

```typescript
// toObject() includes all language content
{
  id: '...',
  urlName: '...',
  content: {
    en: { title: 'My Calendar', description: '...' },
    fr: { title: 'Mon Calendrier', description: '...' }
  }
}
```
