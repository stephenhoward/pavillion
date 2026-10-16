import { describe, it, expect } from 'vitest';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';
import { resolveCurrentCalendar } from '@/client/service/current-calendar';

const owned = (id: string) => new CalendarInfo(new Calendar(id, `owned-${id}`), 'owner');
const edited = (id: string) => new CalendarInfo(new Calendar(id, `edited-${id}`), 'editor');

describe('resolveCurrentCalendar', () => {
  const cases: Array<[string, string | null, CalendarInfo[], string | null]> = [
    ['persisted null → first owned', null, [edited('e1'), owned('o1'), owned('o2')], 'o1'],
    ['persisted not in list → first owned', 'gone', [owned('o1'), owned('o2')], 'o1'],
    ['persisted edited calendar is honoured', 'e1', [owned('o1'), edited('e1')], 'e1'],
    ['edited listed before owned still resolves owned', null, [edited('e1'), owned('o1')], 'o1'],
    ['editor-only account → first edited', null, [edited('e1'), edited('e2')], 'e1'],
    ['empty list → null', 'o1', [], null],
  ];

  it.each(cases)('%s', (_label, persisted, infos, expectedId) => {
    const result = resolveCurrentCalendar(persisted, infos);
    expect(result?.calendar.id ?? null).toBe(expectedId);
  });
});
