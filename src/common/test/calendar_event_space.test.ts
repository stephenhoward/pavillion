import { describe, test, expect } from 'vitest';
import { CalendarEvent } from '@/common/model/events';
import { EventLocationSpace, EventLocationSpaceContent } from '@/common/model/location';

describe('CalendarEvent Model - space property', () => {
  test('space defaults to null', () => {
    const event = new CalendarEvent('event-123', 'cal-456');

    expect(event.space).toBeNull();
  });

  test('toObject emits space:null when not set', () => {
    const event = new CalendarEvent('event-123', 'cal-456');

    const obj = event.toObject();

    expect(obj.space).toBeNull();
  });

  test('toObject emits space when present', () => {
    const event = new CalendarEvent('event-123', 'cal-456');
    const space = new EventLocationSpace('s1', 'p1');
    space.addContent(new EventLocationSpaceContent('en', 'Pacific Room', 'Hearing loop'));
    event.space = space;

    const obj = event.toObject();

    expect(obj.space).toBeDefined();
    expect(obj.space.id).toBe('s1');
    expect(obj.space.placeId).toBe('p1');
    expect(obj.space.content.en.name).toBe('Pacific Room');
    expect(obj.space.content.en.accessibilityInfo).toBe('Hearing loop');
  });

  test('fromObject reconstructs space via EventLocationSpace.fromObject', () => {
    const obj = {
      id: 'event-123',
      calendarId: 'cal-456',
      space: {
        id: 's1',
        placeId: 'p1',
        content: {
          en: { name: 'Pacific Room', accessibilityInfo: 'Hearing loop' },
        },
      },
      content: {},
      schedules: [],
    };

    const event = CalendarEvent.fromObject(obj);

    expect(event.space).toBeInstanceOf(EventLocationSpace);
    expect(event.space!.id).toBe('s1');
    expect(event.space!.placeId).toBe('p1');
    expect(event.space!.content('en').name).toBe('Pacific Room');
  });

  test('fromObject handles missing space', () => {
    const obj = {
      id: 'event-123',
      calendarId: 'cal-456',
      content: {},
      schedules: [],
    };

    const event = CalendarEvent.fromObject(obj);

    expect(event.space).toBeNull();
  });

  test('fromObject handles null space', () => {
    const obj = {
      id: 'event-123',
      calendarId: 'cal-456',
      space: null,
      content: {},
      schedules: [],
    };

    const event = CalendarEvent.fromObject(obj);

    expect(event.space).toBeNull();
  });

  test('round-trip preserves space content across multiple languages', () => {
    const original = new CalendarEvent('event-123', 'cal-456');
    const space = new EventLocationSpace('s1', 'p1');
    space.addContent(new EventLocationSpaceContent('en', 'Pacific Room', 'Hearing loop'));
    space.addContent(new EventLocationSpaceContent('fr', 'Salle Pacifique', 'Boucle auditive'));
    original.space = space;

    const restored = CalendarEvent.fromObject(original.toObject());

    expect(restored.space).not.toBeNull();
    expect(restored.space!.id).toBe('s1');
    expect(restored.space!.placeId).toBe('p1');
    expect(restored.space!.content('en').name).toBe('Pacific Room');
    expect(restored.space!.content('en').accessibilityInfo).toBe('Hearing loop');
    expect(restored.space!.content('fr').name).toBe('Salle Pacifique');
    expect(restored.space!.content('fr').accessibilityInfo).toBe('Boucle auditive');
  });
});
