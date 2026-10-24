import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';

import { Calendar } from '@/common/model/calendar';
import { InvalidDomainFormatError } from '@/common/exceptions/calendar';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import CalendarService from '@/server/calendar/service/calendar';
import WidgetDomainService, { FRAME_ANCESTORS_CACHE_MAX_ENTRIES } from '@/server/calendar/service/widget_domain';

/** The localhost sources every widget-shell policy carries (the dev exception). */
const LOCALHOST_SOURCES = 'http://localhost:* http://127.0.0.1:* http://*.localhost:*';
const UNCONFIGURED_POLICY = `frame-ancestors 'self' ${LOCALHOST_SOURCES}`;

function calendarWithDomain(urlName: string, domain: string | null): Calendar {
  const calendar = new Calendar(`${urlName}-id`, urlName);
  calendar.widgetAllowedDomain = domain;
  return calendar;
}

describe('WidgetDomainService', () => {
  let service: WidgetDomainService;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new WidgetDomainService();
  });

  afterEach(() => {
    sandbox.restore();
    vi.useRealTimers();
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

    it('should store the domain lowercased with any trailing dot removed', async () => {
      const calendar = new Calendar('calendar-id', 'test-calendar');
      const update = sandbox.stub().resolves();
      sandbox.stub(CalendarEntity, 'findByPk').resolves({ update } as any);

      await service.setAllowedDomain(calendar, 'WWW.Example.COM.:8080');

      expect(update.calledOnceWith({ widget_allowed_domain: 'www.example.com:8080' })).toBe(true);
      expect(calendar.widgetAllowedDomain).toBe('www.example.com:8080');
    });
  });

  describe('isValidDomain', () => {
    it.each([
      'example.com',
      'www.example.com.',
      'blog.example.org:8080',
      '192.168.1.5:3000',
      'xn--bcher-kva.example',
    ])('should accept %s', (domain) => {
      expect(service.isValidDomain(domain)).toBe(true);
    });

    it.each([
      '..',
      '.example.com',
      '-a.com',
      'a..b',
      'example-.com',
      'example',
      'a'.repeat(64) + '.com',
      'example.com:0',
      'example.com:70000',
      '*.example.com',
      'example.com\r\n',
    ])('should reject %j', (domain) => {
      expect(service.isValidDomain(domain)).toBe(false);
    });
  });

  describe('matchesAllowedDomain', () => {
    it.each([
      ['identical hosts', 'example.com', 'example.com'],
      ['apex entry, www request', 'example.com', 'www.example.com'],
      ['www entry, apex request', 'www.example.com', 'example.com'],
      ['case differences on either side', 'Example.COM', 'WWW.example.com'],
      ['trailing dot on the entry', 'example.com.', 'example.com'],
      ['trailing dot on the request', 'example.com', 'www.example.com.'],
      ['no port entered, request on another port', 'example.com', 'example.com:8443'],
      ['entered port, same port on the www twin', 'example.com:8080', 'www.example.com:8080'],
    ])('should match: %s', (_label, allowed, requested) => {
      expect(service.matchesAllowedDomain(allowed, requested)).toBe(true);
    });

    it.each([
      ['a different subdomain of the entry', 'example.com', 'blog.example.com'],
      ['a different subdomain of a www entry', 'www.example.com', 'blog.example.com'],
      ['a lookalike suffix', 'example.com', 'notexample.com'],
      ['the entry as a prefix of another host', 'example.com', 'example.com.evil.net'],
      ['entered port, request without it', 'example.com:8080', 'example.com'],
      ['entered port, request on another port', 'example.com:8080', 'example.com:9090'],
      ['a www entry whose remainder is a bare TLD', 'www.com', 'com'],
    ])('should not match: %s', (_label, allowed, requested) => {
      expect(service.matchesAllowedDomain(allowed, requested)).toBe(false);
    });
  });

  describe('isOriginAllowed', () => {
    it('should allow the www twin of a configured apex domain', () => {
      const calendar = calendarWithDomain('cal', 'example.com');

      expect(service.isOriginAllowed(calendar, 'https://www.example.com')).toBe(true);
    });

    it('should refuse an origin on an unrelated domain', () => {
      const calendar = calendarWithDomain('cal', 'example.com');

      expect(service.isOriginAllowed(calendar, 'https://evil.example.net')).toBe(false);
    });

    it('should refuse every non-localhost origin when no domain is configured', () => {
      const calendar = calendarWithDomain('cal', null);

      expect(service.isOriginAllowed(calendar, 'https://example.com')).toBe(false);
    });

    it('should allow localhost regardless of configuration', () => {
      const calendar = calendarWithDomain('cal', null);

      expect(service.isOriginAllowed(calendar, 'http://localhost:8080')).toBe(true);
    });

    it('should admit a configured domain over https', () => {
      const calendar = calendarWithDomain('cal', 'example.com');

      expect(service.isOriginAllowed(calendar, 'https://example.com')).toBe(true);
    });

    it('should refuse a configured domain over http, as the shell policy does', () => {
      const calendar = calendarWithDomain('cal', 'example.com');

      expect(service.isOriginAllowed(calendar, 'http://example.com')).toBe(false);
    });

    it.each([
      'http://localhost:8080',
      'http://127.0.0.1:3000',
      'http://[::1]:3000',
      'http://app.localhost',
    ])('should allow the loopback origin %s over http', (origin) => {
      const calendar = calendarWithDomain('cal', 'example.com');

      expect(service.isOriginAllowed(calendar, origin)).toBe(true);
    });

    it.each([
      'not a url',
      'null',
    ])('should refuse the unparseable origin %j', (origin) => {
      const calendar = calendarWithDomain('cal', 'example.com');

      expect(service.isOriginAllowed(calendar, origin)).toBe(false);
    });
  });

  describe('frameAncestorsFor', () => {
    it('should permit only self and localhost when no domain is configured', () => {
      expect(service.frameAncestorsFor(null)).toBe(UNCONFIGURED_POLICY);
    });

    it('should permit the configured apex and its www twin over https on any port', () => {
      expect(service.frameAncestorsFor('example.com')).toBe(
        `frame-ancestors 'self' https://example.com:* https://www.example.com:* ${LOCALHOST_SOURCES}`,
      );
    });

    it('should derive the apex twin from a www entry', () => {
      const policy = service.frameAncestorsFor('www.example.com');

      expect(policy).toContain('https://www.example.com:*');
      expect(policy).toContain('https://example.com:*');
    });

    it('should pin the port when the owner entered one', () => {
      const policy = service.frameAncestorsFor('example.com:8443');

      expect(policy).toContain('https://example.com:8443');
      expect(policy).toContain('https://www.example.com:8443');
      expect(policy).not.toContain('example.com:*');
    });

    it('should normalize case and a trailing dot in a stored value', () => {
      const policy = service.frameAncestorsFor('Example.COM.');

      expect(policy).toContain('https://example.com:*');
      expect(policy).toContain('https://www.example.com:*');
    });

    it('should treat a stored value that fails validation as unconfigured', () => {
      expect(service.frameAncestorsFor('evil.com; script-src *')).toBe(UNCONFIGURED_POLICY);
    });

    it.each([
      'example.com\r\nX-Injected: 1',
      '*.example.com',
    ])('should treat the stored value %j as unconfigured', (domain) => {
      expect(service.frameAncestorsFor(domain)).toBe(service.frameAncestorsFor(null));
    });

    it('should never emit a bare wildcard source', () => {
      for (const domain of [null, 'example.com', 'www.example.com:8080']) {
        const sources = service.frameAncestorsFor(domain).split(' ');
        expect(sources).not.toContain('*');
      }
    });
  });

  describe('getFrameAncestors', () => {
    let calendarService: CalendarService;
    let getCalendarByName: sinon.SinonStub;

    beforeEach(() => {
      calendarService = new CalendarService();
      getCalendarByName = sandbox.stub(calendarService, 'getCalendarByName');
      service = new WidgetDomainService(calendarService);
    });

    it('should build the policy from the calendar\'s configured domain', async () => {
      getCalendarByName.withArgs('cal').resolves(calendarWithDomain('cal', 'example.com'));

      const policy = await service.getFrameAncestors('cal');

      expect(policy).toBe(service.frameAncestorsFor('example.com'));
    });

    it('should answer an unknown calendar exactly as an unconfigured one', async () => {
      getCalendarByName.resolves(null);

      expect(await service.getFrameAncestors('missing')).toBe(UNCONFIGURED_POLICY);
    });

    it('should serve repeat lookups from the cache within the TTL', async () => {
      vi.useFakeTimers();
      getCalendarByName.resolves(calendarWithDomain('cal', 'example.com'));

      await service.getFrameAncestors('cal');
      vi.advanceTimersByTime(59_000);
      await service.getFrameAncestors('cal');

      expect(getCalendarByName.callCount).toBe(1);
    });

    it('should look the calendar up again once the TTL has passed', async () => {
      vi.useFakeTimers();
      getCalendarByName.onFirstCall().resolves(calendarWithDomain('cal', 'example.com'));
      getCalendarByName.onSecondCall().resolves(calendarWithDomain('cal', 'other.org'));

      await service.getFrameAncestors('cal');
      vi.advanceTimersByTime(61_000);
      const policy = await service.getFrameAncestors('cal');

      expect(getCalendarByName.callCount).toBe(2);
      expect(policy).toContain('https://other.org:*');
    });

    it.each(['..', 'a'])('should answer the shape-invalid name %j as unconfigured without a lookup or a cache entry', async (name) => {
      const cache = (service as any).frameAncestorsCache as Map<string, unknown>;

      expect(await service.getFrameAncestors(name)).toBe(UNCONFIGURED_POLICY);
      expect(getCalendarByName.called).toBe(false);
      expect(cache.size).toBe(0);
    });

    it('should evict only the oldest entry when the cache is full', async () => {
      getCalendarByName.resolves(null);
      const cache = (service as any).frameAncestorsCache as Map<string, unknown>;

      for (let i = 0; i < FRAME_ANCESTORS_CACHE_MAX_ENTRIES; i++) {
        await service.getFrameAncestors(`cal${i}`);
      }
      await service.getFrameAncestors('overflow');

      expect(cache.size).toBe(FRAME_ANCESTORS_CACHE_MAX_ENTRIES);
      expect(cache.has('cal0')).toBe(false);
      expect(cache.has('cal1')).toBe(true);
      expect(cache.has('overflow')).toBe(true);
    });

    it('should not evict next an entry refreshed after its TTL expired', async () => {
      vi.useFakeTimers();
      getCalendarByName.resolves(null);
      const cache = (service as any).frameAncestorsCache as Map<string, unknown>;

      for (let i = 0; i < FRAME_ANCESTORS_CACHE_MAX_ENTRIES; i++) {
        await service.getFrameAncestors(`cal${i}`);
      }
      vi.advanceTimersByTime(61_000);
      await service.getFrameAncestors('cal0');
      await service.getFrameAncestors('overflow');

      expect(cache.has('cal0')).toBe(true);
      expect(cache.has('cal1')).toBe(false);
      expect(cache.size).toBe(FRAME_ANCESTORS_CACHE_MAX_ENTRIES);
    });

    it('should drop the cached policy when the calendar\'s domain changes', async () => {
      const calendar = calendarWithDomain('cal', null);
      getCalendarByName.resolves(calendar);
      sandbox.stub(CalendarEntity, 'findByPk').resolves({ update: sandbox.stub().resolves() } as any);

      expect(await service.getFrameAncestors('cal')).toBe(UNCONFIGURED_POLICY);

      await service.setAllowedDomain(calendar, 'example.com');

      expect(await service.getFrameAncestors('cal')).toContain('https://example.com:*');
      expect(getCalendarByName.callCount).toBe(2);
    });
  });
});
