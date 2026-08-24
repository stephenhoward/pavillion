import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import sinon from 'sinon';
import { dispatchAndAwait } from '@/server/common/test/helpers/emit-and-settle';
import MediaEventHandlers from '@/server/media/events/index';
import MediaInterface from '@/server/media/interface/index';
import { Media } from '@/common/model/media';

describe('MediaEventHandlers', () => {
  let sandbox: sinon.SinonSandbox;
  let eventBus: EventEmitter;
  let mockMediaInterface: sinon.SinonStubbedInstance<MediaInterface>;
  let handlers: MediaEventHandlers;

  const makePendingMedia = (id: string): Media => {
    return new Media(id, 'calendar-123', 'abc123', 'test.png', 'image/png', 1024, 'pending');
  };

  const makeApprovedMedia = (id: string): Media => {
    return new Media(id, 'calendar-123', 'abc123', 'test.png', 'image/png', 1024, 'approved');
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    mockMediaInterface = sandbox.createStubInstance(MediaInterface);
    handlers = new MediaEventHandlers(mockMediaInterface as unknown as MediaInterface);
    handlers.install(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
    eventBus.removeAllListeners();
  });

  describe('mediaAttachedToEvent', () => {
    it('should call checkFileSafety for pending media when mediaAttachedToEvent is emitted', async () => {
      mockMediaInterface.getMediaById.resolves(makePendingMedia('media-111'));
      mockMediaInterface.checkFileSafety.resolves(true);

      await dispatchAndAwait(eventBus, 'mediaAttachedToEvent', { mediaId: 'media-111', eventId: 'event-abc' });

      expect(mockMediaInterface.getMediaById.calledOnceWith('media-111')).toBe(true);
      expect(mockMediaInterface.checkFileSafety.calledOnceWith('media-111')).toBe(true);
    });

    it('should NOT call checkFileSafety when media is already approved', async () => {
      mockMediaInterface.getMediaById.resolves(makeApprovedMedia('media-222'));

      await dispatchAndAwait(eventBus, 'mediaAttachedToEvent', { mediaId: 'media-222', eventId: 'event-abc' });

      expect(mockMediaInterface.getMediaById.calledOnce).toBe(true);
      expect(mockMediaInterface.checkFileSafety.called).toBe(false);
    });

    it('should NOT call checkFileSafety when media is not found', async () => {
      mockMediaInterface.getMediaById.resolves(null);

      await dispatchAndAwait(eventBus, 'mediaAttachedToEvent', { mediaId: 'media-999', eventId: 'event-abc' });

      expect(mockMediaInterface.checkFileSafety.called).toBe(false);
    });
  });

  describe('mediaAttachedToSeries', () => {
    it('should call checkFileSafety for pending media when mediaAttachedToSeries is emitted', async () => {
      mockMediaInterface.getMediaById.resolves(makePendingMedia('media-333'));
      mockMediaInterface.checkFileSafety.resolves(true);

      await dispatchAndAwait(eventBus, 'mediaAttachedToSeries', { mediaId: 'media-333', seriesId: 'series-xyz' });

      expect(mockMediaInterface.getMediaById.calledOnceWith('media-333')).toBe(true);
      expect(mockMediaInterface.checkFileSafety.calledOnceWith('media-333')).toBe(true);
    });

    it('should NOT call checkFileSafety when series media is already approved', async () => {
      mockMediaInterface.getMediaById.resolves(makeApprovedMedia('media-444'));

      await dispatchAndAwait(eventBus, 'mediaAttachedToSeries', { mediaId: 'media-444', seriesId: 'series-xyz' });

      expect(mockMediaInterface.getMediaById.calledOnce).toBe(true);
      expect(mockMediaInterface.checkFileSafety.called).toBe(false);
    });

    it('should NOT call checkFileSafety when series media is not found', async () => {
      mockMediaInterface.getMediaById.resolves(null);

      await dispatchAndAwait(eventBus, 'mediaAttachedToSeries', { mediaId: 'media-999', seriesId: 'series-xyz' });

      expect(mockMediaInterface.checkFileSafety.called).toBe(false);
    });

    it('should not throw when checkFileSafety fails for series media', async () => {
      mockMediaInterface.getMediaById.resolves(makePendingMedia('media-555'));
      mockMediaInterface.checkFileSafety.rejects(new Error('storage error'));

      // Handler swallows the error internally, so the listener chain must settle without rejecting
      await expect(dispatchAndAwait(eventBus, 'mediaAttachedToSeries', { mediaId: 'media-555', seriesId: 'series-xyz' })).resolves.not.toThrow();
      expect(mockMediaInterface.checkFileSafety.calledOnce).toBe(true);
    });
  });

  describe('mediaAttachedToCalendar', () => {
    it('should call checkFileSafety for pending media when mediaAttachedToCalendar is emitted', async () => {
      mockMediaInterface.getMediaById.resolves(makePendingMedia('media-cal-1'));
      mockMediaInterface.checkFileSafety.resolves(true);

      await dispatchAndAwait(eventBus, 'mediaAttachedToCalendar', { mediaId: 'media-cal-1', calendarId: 'calendar-123' });

      expect(mockMediaInterface.getMediaById.calledOnceWith('media-cal-1')).toBe(true);
      expect(mockMediaInterface.checkFileSafety.calledOnceWith('media-cal-1')).toBe(true);
    });

    it('should NOT call checkFileSafety when calendar media is already approved', async () => {
      mockMediaInterface.getMediaById.resolves(makeApprovedMedia('media-cal-2'));

      await dispatchAndAwait(eventBus, 'mediaAttachedToCalendar', { mediaId: 'media-cal-2', calendarId: 'calendar-123' });

      expect(mockMediaInterface.getMediaById.calledOnce).toBe(true);
      expect(mockMediaInterface.checkFileSafety.called).toBe(false);
    });

    it('should NOT call checkFileSafety when calendar media is not found', async () => {
      mockMediaInterface.getMediaById.resolves(null);

      await dispatchAndAwait(eventBus, 'mediaAttachedToCalendar', { mediaId: 'media-cal-3', calendarId: 'calendar-123' });

      expect(mockMediaInterface.checkFileSafety.called).toBe(false);
    });

    it('should not throw when checkFileSafety fails for calendar media', async () => {
      mockMediaInterface.getMediaById.resolves(makePendingMedia('media-cal-4'));
      mockMediaInterface.checkFileSafety.rejects(new Error('storage error'));

      // Handler swallows the error internally, so the listener chain must settle without rejecting
      await expect(dispatchAndAwait(eventBus, 'mediaAttachedToCalendar', { mediaId: 'media-cal-4', calendarId: 'calendar-123' })).resolves.not.toThrow();
      expect(mockMediaInterface.checkFileSafety.calledOnce).toBe(true);
    });
  });

  describe('isolation between event types', () => {
    it('mediaAttachedToSeries should not trigger the mediaAttachedToEvent handler', async () => {
      mockMediaInterface.getMediaById.resolves(makePendingMedia('media-666'));
      mockMediaInterface.checkFileSafety.resolves(true);

      // Only dispatch the series event
      await dispatchAndAwait(eventBus, 'mediaAttachedToSeries', { mediaId: 'media-666', seriesId: 'series-xyz' });

      // checkFileSafety should be called exactly once (by the series handler)
      expect(mockMediaInterface.checkFileSafety.callCount).toBe(1);
    });

    it('mediaAttachedToEvent should not trigger the mediaAttachedToSeries handler', async () => {
      mockMediaInterface.getMediaById.resolves(makePendingMedia('media-777'));
      mockMediaInterface.checkFileSafety.resolves(true);

      // Only dispatch the event event
      await dispatchAndAwait(eventBus, 'mediaAttachedToEvent', { mediaId: 'media-777', eventId: 'event-abc' });

      // checkFileSafety should be called exactly once (by the event handler)
      expect(mockMediaInterface.checkFileSafety.callCount).toBe(1);
    });

    it('mediaAttachedToCalendar should not trigger event or series handlers', async () => {
      mockMediaInterface.getMediaById.resolves(makePendingMedia('media-888'));
      mockMediaInterface.checkFileSafety.resolves(true);

      await dispatchAndAwait(eventBus, 'mediaAttachedToCalendar', { mediaId: 'media-888', calendarId: 'calendar-123' });

      // checkFileSafety should be called exactly once (by the calendar handler)
      expect(mockMediaInterface.checkFileSafety.callCount).toBe(1);
    });
  });
});
