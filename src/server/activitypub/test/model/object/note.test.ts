import { describe, it, expect } from 'vitest';
import config from 'config';
import he from 'he';
import { DateTime } from 'luxon';

import { Calendar } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventContent, CalendarEventSchedule } from '@/common/model/events';
import { EventLocation } from '@/common/model/location';
import { NoteObject } from '@/server/activitypub/model/object/note';

const domain = config.get<string>('domain');

describe('NoteObject', () => {

  describe('static noteUrl', () => {

    it('produces /calendars/{urlName}/events/{event.id}/note', () => {
      const calendar = new Calendar('cal-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'cal-uuid');

      const url = NoteObject.noteUrl(calendar, event);

      expect(url).toBe(`https://${domain}/calendars/mycal/events/event-uuid/note`);
    });

    it('accepts a string event id', () => {
      const calendar = new Calendar('cal-uuid', 'mycal');

      const url = NoteObject.noteUrl(calendar, 'some-event-id');

      expect(url).toBe(`https://${domain}/calendars/mycal/events/some-event-id/note`);
    });

  });

  describe('AP id and attributedTo', () => {

    it('sets id to the canonical note URL', () => {
      const calendar = new Calendar('cal-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'cal-uuid');

      const note = new NoteObject(calendar, event);

      expect(note.id).toBe(`https://${domain}/calendars/mycal/events/event-uuid/note`);
    });

    it('sets attributedTo to the calendar actor URL, never an account IRI', () => {
      const calendar = new Calendar('cal-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'cal-uuid');

      const note = new NoteObject(calendar, event);

      expect(note.attributedTo).toBe(`https://${domain}/calendars/mycal`);
      // Defense against future regressions: must not include the
      // /accounts/ or /users/ path that account IRIs use elsewhere.
      expect(note.attributedTo).not.toContain('/accounts/');
      expect(note.attributedTo).not.toContain('/users/');
    });

  });

  describe('toActivityPubObject() — single-language event with location', () => {

    it('emits name, content with title/time/location, and addressing without nameMap/contentMap', () => {
      const calendar = new Calendar('cal-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'cal-uuid');
      event.addContent(new CalendarEventContent('en', 'Coffee Meetup', ''));
      const startDt = DateTime.fromISO('2026-06-15T18:30:00.000Z');
      const schedule = new CalendarEventSchedule('s1', startDt);
      event.schedules = [schedule];
      event.location = new EventLocation('loc-uuid', 'Riverside Park');

      const note = new NoteObject(calendar, event);
      const result = note.toActivityPubObject();

      expect(result.type).toBe('Note');
      expect(result.id).toBe(`https://${domain}/calendars/mycal/events/event-uuid/note`);
      expect(result.attributedTo).toBe(`https://${domain}/calendars/mycal`);
      expect(result.name).toBe('Coffee Meetup');
      // Content: contains anchor + title, the schedule's ISO start time
      // (preserves offset via Luxon), and location segment.
      expect(result.content).toContain('<a href=');
      expect(result.content).toContain('Coffee Meetup');
      expect(result.content).toContain(startDt.toISO()!);
      expect(result.content).toContain(' · Riverside Park');
      // Addressing
      expect(result.to).toEqual(['https://www.w3.org/ns/activitystreams#Public']);
      expect(result.cc).toEqual([`https://${domain}/calendars/mycal/followers`]);
      // Single-language: no nameMap/contentMap
      expect(result).not.toHaveProperty('nameMap');
      expect(result).not.toHaveProperty('contentMap');
    });

    it('omits the location segment when the event has no location', () => {
      const calendar = new Calendar('cal-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'cal-uuid');
      event.addContent(new CalendarEventContent('en', 'Online Workshop', ''));
      const startDt = DateTime.fromISO('2026-07-01T15:00:00.000Z');
      event.schedules = [new CalendarEventSchedule('s1', startDt)];

      const note = new NoteObject(calendar, event);
      const result = note.toActivityPubObject();

      expect(result.content).toContain('Online Workshop');
      expect(result.content).toContain(startDt.toISO()!);
      // The location separator " · " appears once (between title and time),
      // not twice (no trailing location segment).
      expect((result.content.match(/ · /g) ?? []).length).toBe(1);
    });

  });

  describe('toActivityPubObject() — multilingual event', () => {

    it('emits nameMap and contentMap with per-language renderings; primary content stays in primary language', () => {
      const calendar = new Calendar('cal-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'cal-uuid');
      event.addContent(new CalendarEventContent('en', 'English Title', 'English desc'));
      event.addContent(new CalendarEventContent('es', 'Spanish Title', 'Spanish desc'));
      const startDt = DateTime.fromISO('2026-06-15T18:30:00.000Z');
      event.schedules = [new CalendarEventSchedule('s1', startDt)];

      const note = new NoteObject(calendar, event);
      const result = note.toActivityPubObject();

      // Primary content: English (per 'en' preference rule)
      expect(result.name).toBe('English Title');
      expect(result.content).toContain('English Title');

      // Multilingual maps present and cover both languages
      expect(result.nameMap).toEqual({
        en: 'English Title',
        es: 'Spanish Title',
      });
      expect(result.contentMap).toHaveProperty('en');
      expect(result.contentMap).toHaveProperty('es');
      expect(result.contentMap.en).toContain('English Title');
      expect(result.contentMap.es).toContain('Spanish Title');
    });

    it('falls back to first non-en language when en has no name', () => {
      const calendar = new Calendar('cal-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'cal-uuid');
      event.addContent(new CalendarEventContent('es', 'Solo Espanol', ''));
      event.addContent(new CalendarEventContent('fr', 'Aussi Francais', ''));

      const note = new NoteObject(calendar, event);
      const result = note.toActivityPubObject();

      // Primary picks the first language with a name (es here).
      // Names are ASCII so he.encode is identity.
      expect(['Solo Espanol', 'Aussi Francais']).toContain(result.name);
    });

  });

  describe('toActivityPubObject() — minimal data', () => {

    it('degrades gracefully when the event has no content, no schedules, and no location', () => {
      const calendar = new Calendar('cal-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'cal-uuid');

      const note = new NoteObject(calendar, event);
      const result = note.toActivityPubObject();

      expect(result.type).toBe('Note');
      expect(result.id).toBe(`https://${domain}/calendars/mycal/events/event-uuid/note`);
      expect(result.attributedTo).toBe(`https://${domain}/calendars/mycal`);
      // Falls back to the default title and still emits content
      expect(result.name).toBe('Untitled Event');
      expect(typeof result.content).toBe('string');
      expect(result.content).toContain('Untitled Event');
    });

    it('omits published when the event has no createdAt', () => {
      const calendar = new Calendar('cal-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'cal-uuid');
      event.addContent(new CalendarEventContent('en', 'Hello', ''));

      const note = new NoteObject(calendar, event);
      const result = note.toActivityPubObject();

      expect(result).not.toHaveProperty('published');
    });

    it('emits published as ISO when createdAt is set', () => {
      const calendar = new Calendar('cal-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'cal-uuid');
      event.addContent(new CalendarEventContent('en', 'Hello', ''));
      event.createdAt = new Date('2026-03-01T12:00:00.000Z');

      const note = new NoteObject(calendar, event);
      const result = note.toActivityPubObject();

      expect(result.published).toBe('2026-03-01T12:00:00.000Z');
    });

  });

  describe('HTML escaping', () => {

    it('entity-encodes a hostile title in both name and content', () => {
      const calendar = new Calendar('cal-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'cal-uuid');
      const hostile = '</a><script>alert(1)</script>';
      event.addContent(new CalendarEventContent('en', hostile, ''));
      event.schedules = [new CalendarEventSchedule('s1', DateTime.fromISO('2026-06-15T18:30:00.000Z'))];

      const note = new NoteObject(calendar, event);
      const result = note.toActivityPubObject();

      // name: fully encoded — the raw tag fragment must not appear
      expect(result.name).not.toContain('<script>');
      expect(result.name).not.toContain('</a>');
      expect(result.name).toBe(he.encode(hostile));

      // content: the only `<a>` / `</a>` / `<p>` tags allowed are the ones
      // Pavillion itself wrote into the template. The hostile title's tags
      // must be entity-encoded.
      expect(result.content).not.toContain('<script>');
      expect(result.content).toContain('&#x3C;script&#x3E;');
      // The injected </a> tag must be encoded, not literal. There is exactly
      // one literal </a> in the result (the wrapper anchor's closing tag).
      expect((result.content.match(/<\/a>/g) ?? []).length).toBe(1);
    });

    it('entity-encodes a hostile location name in content', () => {
      const calendar = new Calendar('cal-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'cal-uuid');
      event.addContent(new CalendarEventContent('en', 'Safe Title', ''));
      event.schedules = [new CalendarEventSchedule('s1', DateTime.fromISO('2026-06-15T18:30:00.000Z'))];
      event.location = new EventLocation('loc-uuid', '<img src=x onerror=alert(1)>');

      const note = new NoteObject(calendar, event);
      const result = note.toActivityPubObject();

      // Tag delimiters MUST be entity-encoded so no new HTML element opens.
      // The literal `onerror=` token remains visible inside the encoded text
      // (it is benign without `<`/`>`), but no `<img` tag can fire.
      expect(result.content).not.toContain('<img');
      expect(result.content).toContain(he.encode('<img src=x onerror=alert(1)>'));
    });

  });

  describe('urlOverride option', () => {

    it('uses urlOverride for both the url field and the content anchor href', () => {
      const calendar = new Calendar('cal-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'cal-uuid');
      event.addContent(new CalendarEventContent('en', 'Reposted Event', ''));
      event.schedules = [new CalendarEventSchedule('s1', DateTime.fromISO('2026-06-15T18:30:00.000Z'))];

      const remoteIri = 'https://remote.instance/events/abc-123';
      const note = new NoteObject(calendar, event, { urlOverride: remoteIri });
      const result = note.toActivityPubObject();

      expect(result.url).toBe(remoteIri);
      // Anchor href in content is the override too (HTML-encoded inside the
      // href attribute — `he.encode` is identity for plain http(s) IRIs).
      expect(result.content).toContain(`<a href="${remoteIri}">`);
      // The Pavillion-local event page IRI must NOT appear in the content
      // when an override is in effect.
      expect(result.content).not.toContain(`https://${domain}/calendars/mycal/events/event-uuid"`);
    });

    it('omits url and falls back to local event page in the anchor when override has an invalid scheme', () => {
      const calendar = new Calendar('cal-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'cal-uuid');
      event.addContent(new CalendarEventContent('en', 'Reposted Event', ''));
      event.schedules = [new CalendarEventSchedule('s1', DateTime.fromISO('2026-06-15T18:30:00.000Z'))];

      const note = new NoteObject(calendar, event, { urlOverride: 'javascript:alert(1)' });
      const result = note.toActivityPubObject();

      // url is omitted when override validation fails
      expect(result).not.toHaveProperty('url');
      // Note still serializes with a working local anchor href
      expect(result.type).toBe('Note');
      expect(result.content).toContain(`<a href="https://${domain}/calendars/mycal/events/event-uuid">`);
    });

    it('omits url when override is a non-http(s) URL', () => {
      const calendar = new Calendar('cal-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'cal-uuid');
      event.addContent(new CalendarEventContent('en', 'Reposted Event', ''));

      const note = new NoteObject(calendar, event, { urlOverride: 'data:text/html,<script>alert(1)</script>' });
      const result = note.toActivityPubObject();

      expect(result).not.toHaveProperty('url');
    });

  });

  describe('no fromActivityPubObject', () => {

    it('does not expose a fromActivityPubObject method', () => {
      // Pavillion never ingests remote Notes — they are minted on-the-wire by
      // each instance to wrap its own canonical Event.
      expect((NoteObject as any).fromActivityPubObject).toBeUndefined();
    });

  });

  describe('no pavillion:* extensions', () => {

    it('does not emit any pavillion:* keys', () => {
      const calendar = new Calendar('cal-uuid', 'mycal');
      const event = new CalendarEvent('event-uuid', 'cal-uuid');
      event.addContent(new CalendarEventContent('en', 'Test', ''));

      const note = new NoteObject(calendar, event);
      const result = note.toActivityPubObject();

      const pavillionKeys = Object.keys(result).filter(k => k.startsWith('pavillion:'));
      expect(pavillionKeys).toEqual([]);
    });

  });

});
