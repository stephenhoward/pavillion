import { describe, it, expect, beforeEach } from 'vitest';

import { Calendar } from '@/common/model/calendar';
import { InvalidDomainFormatError } from '@/common/exceptions/calendar';
import WidgetDomainService from '@/server/calendar/service/widget_domain';

describe('WidgetDomainService', () => {
  let service: WidgetDomainService;

  beforeEach(() => {
    service = new WidgetDomainService();
  });

  describe('setAllowedDomain', () => {
    it('should throw InvalidDomainFormatError for domain with protocol', async () => {
      const calendar = new Calendar('calendar-id', 'test-calendar');

      await expect(
        service.setAllowedDomain(calendar, 'https://example.com'),
      ).rejects.toThrow(InvalidDomainFormatError);
    });

    it('should throw InvalidDomainFormatError for domain with path', async () => {
      const calendar = new Calendar('calendar-id', 'test-calendar');

      await expect(
        service.setAllowedDomain(calendar, 'example.com/path'),
      ).rejects.toThrow(InvalidDomainFormatError);
    });

    it('should throw InvalidDomainFormatError for empty domain', async () => {
      const calendar = new Calendar('calendar-id', 'test-calendar');

      await expect(
        service.setAllowedDomain(calendar, ''),
      ).rejects.toThrow(InvalidDomainFormatError);
    });

    it('should throw InvalidDomainFormatError with correct error name', async () => {
      const calendar = new Calendar('calendar-id', 'test-calendar');

      try {
        await service.setAllowedDomain(calendar, 'https://example.com');
        expect.fail('Should have thrown InvalidDomainFormatError');
      }
      catch (error) {
        expect(error).toBeInstanceOf(InvalidDomainFormatError);
        expect((error as InvalidDomainFormatError).name).toBe('InvalidDomainFormatError');
      }
    });
  });
});
