import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import sinon from 'sinon';
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

      eventBus.emit('mediaAttachedToEvent', { mediaId: 'media-111', eventId: 'event-abc' });

      // Allow async handler to run
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockMediaInterface.getMediaById.calledOnceWith('media-111')).toBe(true);
      expect(mockMediaInterface.checkFileSafety.calledOnceWith('media-111')).toBe(true);
    });

    it('should NOT call checkFileSafety when media is already approved', async () => {
      mockMediaInterface.getMediaById.resolves(makeApprovedMedia('media-222'));

      eventBus.emit('mediaAttachedToEvent', { mediaId: 'media-222', eventId: 'event-abc' });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockMediaInterface.getMediaById.calledOnce).toBe(true);
      expect(mockMediaInterface.checkFileSafety.called).toBe(false);
    });

    it('should NOT call checkFileSafety when media is not found', async () => {
      mockMediaInterface.getMediaById.resolves(null);

      eventBus.emit('mediaAttachedToEvent', { mediaId: 'media-999', eventId: 'event-abc' });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockMediaInterface.checkFileSafety.called).toBe(false);
    });
  });

  describe('mediaAttachedToSeries', () => {
    it('should call checkFileSafety for pending media when mediaAttachedToSeries is emitted', async () => {
      mockMediaInterface.getMediaById.resolves(makePendingMedia('media-333'));
      mockMediaInterface.checkFileSafety.resolves(true);

      eventBus.emit('mediaAttachedToSeries', { mediaId: 'media-333', seriesId: 'series-xyz' });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockMediaInterface.getMediaById.calledOnceWith('media-333')).toBe(true);
      expect(mockMediaInterface.checkFileSafety.calledOnceWith('media-333')).toBe(true);
    });

    it('should NOT call checkFileSafety when series media is already approved', async () => {
      mockMediaInterface.getMediaById.resolves(makeApprovedMedia('media-444'));

      eventBus.emit('mediaAttachedToSeries', { mediaId: 'media-444', seriesId: 'series-xyz' });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockMediaInterface.getMediaById.calledOnce).toBe(true);
      expect(mockMediaInterface.checkFileSafety.called).toBe(false);
    });

    it('should NOT call checkFileSafety when series media is not found', async () => {
      mockMediaInterface.getMediaById.resolves(null);

      eventBus.emit('mediaAttachedToSeries', { mediaId: 'media-999', seriesId: 'series-xyz' });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockMediaInterface.checkFileSafety.called).toBe(false);
    });

    it('should log an error and not throw when checkFileSafety fails for series media', async () => {
      mockMediaInterface.getMediaById.resolves(makePendingMedia('media-555'));
      mockMediaInterface.checkFileSafety.rejects(new Error('storage error'));

      const consoleErrorStub = sandbox.stub(console, 'error');

      eventBus.emit('mediaAttachedToSeries', { mediaId: 'media-555', seriesId: 'series-xyz' });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleErrorStub.called).toBe(true);
      expect(consoleErrorStub.args[0][0]).toContain('[MediaEvents]');
    });
  });

  describe('isolation between event types', () => {
    it('mediaAttachedToSeries should not trigger the mediaAttachedToEvent handler', async () => {
      mockMediaInterface.getMediaById.resolves(makePendingMedia('media-666'));
      mockMediaInterface.checkFileSafety.resolves(true);

      // Only emit the series event
      eventBus.emit('mediaAttachedToSeries', { mediaId: 'media-666', seriesId: 'series-xyz' });

      await new Promise(resolve => setTimeout(resolve, 10));

      // checkFileSafety should be called exactly once (by the series handler)
      expect(mockMediaInterface.checkFileSafety.callCount).toBe(1);
    });

    it('mediaAttachedToEvent should not trigger the mediaAttachedToSeries handler', async () => {
      mockMediaInterface.getMediaById.resolves(makePendingMedia('media-777'));
      mockMediaInterface.checkFileSafety.resolves(true);

      // Only emit the event event
      eventBus.emit('mediaAttachedToEvent', { mediaId: 'media-777', eventId: 'event-abc' });

      await new Promise(resolve => setTimeout(resolve, 10));

      // checkFileSafety should be called exactly once (by the event handler)
      expect(mockMediaInterface.checkFileSafety.callCount).toBe(1);
    });
  });
});
