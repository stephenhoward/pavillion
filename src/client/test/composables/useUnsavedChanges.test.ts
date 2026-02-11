import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';
import { useUnsavedChanges } from '@/client/composables/useUnsavedChanges';
import { CalendarEvent, CalendarEventContent, CalendarEventSchedule } from '@/common/model/events';
import { EventLocation } from '@/common/model/location';
import { DateTime } from 'luxon';
import type { Router } from 'vue-router';

describe('useUnsavedChanges', () => {
  let composable: ReturnType<typeof useUnsavedChanges>;
  let mockEvent: CalendarEvent;
  let mockRouter: Router;

  beforeEach(() => {
    composable = useUnsavedChanges();

    // Create a test event with content
    mockEvent = new CalendarEvent('event-1', 'calendar-1');
    const content = new CalendarEventContent('en', 'Test Event', 'Test Description');
    mockEvent.addContent(content);

    // Add a schedule
    const schedule = new CalendarEventSchedule(
      'schedule-1',
      DateTime.fromISO('2026-03-15T10:00:00'),
      DateTime.fromISO('2026-03-15T12:00:00'),
    );
    schedule.allDay = false;
    mockEvent.addSchedule(schedule);

    // Add a location
    mockEvent.location = new EventLocation(
      'location-1',
      'Test Venue',
      '123 Main St',
      'Springfield',
      'IL',
      '62701',
      'USA',
    );

    // Create mock router with basic methods
    mockRouter = {
      back: vi.fn(),
      push: vi.fn(),
    } as unknown as Router;

    // Mock window.history.length
    Object.defineProperty(window, 'history', {
      value: { length: 2 },
      writable: true,
    });
  });

  describe('initialization', () => {
    it('should initialize with default state', () => {
      expect(composable.isDirty.value).toBe(false);
      expect(composable.snapshotReady.value).toBe(false);
      expect(composable.showUnsavedChangesDialog.value).toBe(false);
    });
  });

  describe('snapshot creation', () => {
    it('should create snapshot with event content', async () => {
      const selectedCategories = ['cat-1', 'cat-2'];
      const mediaId = 'media-1';

      await composable.initializeSnapshot(mockEvent, selectedCategories, mediaId);

      // Wait for nextTick cycles
      await nextTick();
      await nextTick();

      expect(composable.snapshotReady.value).toBe(true);
    });

    it('should serialize event data correctly', async () => {
      const selectedCategories = ['cat-1', 'cat-2'];
      const mediaId = 'media-1';

      await composable.initializeSnapshot(mockEvent, selectedCategories, mediaId);
      await nextTick();
      await nextTick();

      // Trigger dirty check to ensure snapshot was created
      const isDirty = composable.checkDirtyState(mockEvent, selectedCategories, mediaId);
      expect(isDirty).toBe(false); // Should not be dirty immediately after snapshot
    });

    it('should handle event with multiple language content', async () => {
      const spanishContent = new CalendarEventContent('es', 'Evento de Prueba', 'Descripción de Prueba');
      mockEvent.addContent(spanishContent);

      await composable.initializeSnapshot(mockEvent, [], null);
      await nextTick();
      await nextTick();

      // Change content
      mockEvent.content('en').name = 'Changed Event';

      const isDirty = composable.checkDirtyState(mockEvent, [], null);
      expect(isDirty).toBe(true);
    });

    it('should include location data in snapshot', async () => {
      await composable.initializeSnapshot(mockEvent, [], null);
      await nextTick();
      await nextTick();

      // Change location
      mockEvent.location!.name = 'New Venue';

      const isDirty = composable.checkDirtyState(mockEvent, [], null);
      expect(isDirty).toBe(true);
    });

    it('should include schedules in snapshot', async () => {
      await composable.initializeSnapshot(mockEvent, [], null);
      await nextTick();
      await nextTick();

      // Change schedule
      mockEvent.schedules[0].allDay = true;

      const isDirty = composable.checkDirtyState(mockEvent, [], null);
      expect(isDirty).toBe(true);
    });

    it('should include categories in snapshot (sorted)', async () => {
      const selectedCategories = ['cat-3', 'cat-1', 'cat-2'];

      await composable.initializeSnapshot(mockEvent, selectedCategories, null);
      await nextTick();
      await nextTick();

      // Categories should be sorted in snapshot, so changing order shouldn't trigger dirty
      const isDirty = composable.checkDirtyState(mockEvent, ['cat-1', 'cat-2', 'cat-3'], null);
      expect(isDirty).toBe(false);
    });

    it('should include mediaId in snapshot', async () => {
      const mediaId = 'media-1';

      await composable.initializeSnapshot(mockEvent, [], mediaId);
      await nextTick();
      await nextTick();

      // Change media
      const isDirty = composable.checkDirtyState(mockEvent, [], 'media-2');
      expect(isDirty).toBe(true);
    });

    it('should handle null event gracefully', async () => {
      await composable.initializeSnapshot(null, [], null);
      await nextTick();
      await nextTick();

      expect(composable.snapshotReady.value).toBe(true);
    });

    it('should handle event without location', async () => {
      mockEvent.location = null;

      await composable.initializeSnapshot(mockEvent, [], null);
      await nextTick();
      await nextTick();

      const isDirty = composable.checkDirtyState(mockEvent, [], null);
      expect(isDirty).toBe(false);
    });
  });

  describe('dirty state detection', () => {
    beforeEach(async () => {
      await composable.initializeSnapshot(mockEvent, ['cat-1'], 'media-1');
      await nextTick();
      await nextTick();
      await nextTick();
    });

    it('should detect changes to event name', () => {
      mockEvent.content('en').name = 'Changed Event Name';

      const isDirty = composable.checkDirtyState(mockEvent, ['cat-1'], 'media-1');
      expect(isDirty).toBe(true);
    });

    it('should detect changes to event description', () => {
      mockEvent.content('en').description = 'Changed Description';

      const isDirty = composable.checkDirtyState(mockEvent, ['cat-1'], 'media-1');
      expect(isDirty).toBe(true);
    });

    it('should detect changes to categories', () => {
      const isDirty = composable.checkDirtyState(mockEvent, ['cat-1', 'cat-2'], 'media-1');
      expect(isDirty).toBe(true);
    });

    it('should detect changes to mediaId', () => {
      const isDirty = composable.checkDirtyState(mockEvent, ['cat-1'], 'media-2');
      expect(isDirty).toBe(true);
    });

    it('should detect removal of mediaId', () => {
      const isDirty = composable.checkDirtyState(mockEvent, ['cat-1'], null);
      expect(isDirty).toBe(true);
    });

    it('should detect changes to location name', () => {
      mockEvent.location!.name = 'New Venue Name';

      const isDirty = composable.checkDirtyState(mockEvent, ['cat-1'], 'media-1');
      expect(isDirty).toBe(true);
    });

    it('should detect changes to location address', () => {
      mockEvent.location!.address = '456 Oak Ave';

      const isDirty = composable.checkDirtyState(mockEvent, ['cat-1'], 'media-1');
      expect(isDirty).toBe(true);
    });

    it('should detect changes to schedule dates', () => {
      mockEvent.schedules[0].startDate = DateTime.fromISO('2026-03-16T10:00:00');

      const isDirty = composable.checkDirtyState(mockEvent, ['cat-1'], 'media-1');
      expect(isDirty).toBe(true);
    });

    it('should detect changes to schedule allDay flag', () => {
      mockEvent.schedules[0].allDay = true;

      const isDirty = composable.checkDirtyState(mockEvent, ['cat-1'], 'media-1');
      expect(isDirty).toBe(true);
    });

    it('should not be dirty when nothing changes', () => {
      const isDirty = composable.checkDirtyState(mockEvent, ['cat-1'], 'media-1');
      expect(isDirty).toBe(false);
    });

    it('should return false when snapshot not ready', async () => {
      const freshComposable = useUnsavedChanges();

      const isDirty = freshComposable.checkDirtyState(mockEvent, [], null);
      expect(isDirty).toBe(false);
    });

    it('should return false when event is null', () => {
      const isDirty = composable.checkDirtyState(null, [], null);
      expect(isDirty).toBe(false);
    });
  });

  describe('navigation guard behavior', () => {
    let mockNext: any;

    beforeEach(() => {
      mockNext = vi.fn();
    });

    it('should allow navigation when not dirty', () => {
      const to = {} as any;
      const from = {} as any;

      composable.setupNavigationGuard(to, from, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(composable.showUnsavedChangesDialog.value).toBe(false);
    });

    it('should block navigation and show dialog when dirty', () => {
      composable.isDirty.value = true;

      const to = {} as any;
      const from = {} as any;

      composable.setupNavigationGuard(to, from, mockNext);

      expect(mockNext).toHaveBeenCalledWith(false);
      expect(composable.showUnsavedChangesDialog.value).toBe(true);
    });

    it('should store pending navigation callback when blocking', () => {
      composable.isDirty.value = true;

      const to = {} as any;
      const from = {} as any;

      composable.setupNavigationGuard(to, from, mockNext);

      expect(composable.showUnsavedChangesDialog.value).toBe(true);

      // Confirm leave and check that next() is called
      composable.confirmLeave();
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should block navigation when dialog is already showing', () => {
      composable.showUnsavedChangesDialog.value = true;

      const to = {} as any;
      const from = {} as any;

      composable.setupNavigationGuard(to, from, mockNext);

      expect(mockNext).toHaveBeenCalledWith(false);
    });
  });

  describe('confirmation dialog state management', () => {
    it('should show dialog when navigating with unsaved changes', () => {
      composable.isDirty.value = true;

      composable.handleBack(mockRouter);

      expect(composable.showUnsavedChangesDialog.value).toBe(true);
    });

    it('should hide dialog on confirmLeave', () => {
      composable.showUnsavedChangesDialog.value = true;

      composable.confirmLeave();

      expect(composable.showUnsavedChangesDialog.value).toBe(false);
    });

    it('should hide dialog on cancelLeave', () => {
      composable.showUnsavedChangesDialog.value = true;

      composable.cancelLeave();

      expect(composable.showUnsavedChangesDialog.value).toBe(false);
    });
  });

  describe('leave confirmation and cancellation', () => {
    it('should reset dirty state on confirmLeave', () => {
      composable.isDirty.value = true;

      composable.confirmLeave();

      expect(composable.isDirty.value).toBe(false);
    });

    it('should execute pending navigation on confirmLeave', () => {
      composable.isDirty.value = true;
      composable.showUnsavedChangesDialog.value = true;

      // Manually set pending navigation
      composable.handleBack(mockRouter);
      expect(composable.showUnsavedChangesDialog.value).toBe(true);

      composable.confirmLeave();

      expect(mockRouter.back).toHaveBeenCalled();
    });

    it('should clear pending navigation on confirmLeave', () => {
      composable.isDirty.value = true;
      composable.handleBack(mockRouter);

      composable.confirmLeave();

      // Confirming again should not execute navigation
      vi.clearAllMocks();
      composable.confirmLeave();
      expect(mockRouter.back).not.toHaveBeenCalled();
    });

    it('should clear pending navigation on cancelLeave', () => {
      composable.isDirty.value = true;
      composable.handleBack(mockRouter);

      composable.cancelLeave();

      // After cancel, confirming should not execute original navigation
      vi.clearAllMocks();
      composable.confirmLeave();
      expect(mockRouter.back).not.toHaveBeenCalled();
    });

    it('should maintain dirty state on cancelLeave', () => {
      composable.isDirty.value = true;

      composable.cancelLeave();

      expect(composable.isDirty.value).toBe(true);
    });
  });

  describe('snapshot reset after save', () => {
    beforeEach(async () => {
      await composable.initializeSnapshot(mockEvent, ['cat-1'], 'media-1');
      await nextTick();
      await nextTick();
      await nextTick();
    });

    it('should update snapshot to current state on resetSnapshot', () => {
      // Make changes
      mockEvent.content('en').name = 'Changed Name';
      composable.isDirty.value = true;

      // Reset snapshot
      composable.resetSnapshot(mockEvent, ['cat-1'], 'media-1');

      // Should no longer be dirty
      const isDirty = composable.checkDirtyState(mockEvent, ['cat-1'], 'media-1');
      expect(isDirty).toBe(false);
    });

    it('should reset dirty flag on resetSnapshot', () => {
      composable.isDirty.value = true;

      composable.resetSnapshot(mockEvent, ['cat-1'], 'media-1');

      expect(composable.isDirty.value).toBe(false);
    });

    it('should allow new dirty detection after reset', () => {
      // Reset to current state
      composable.resetSnapshot(mockEvent, ['cat-1'], 'media-1');

      // Make new changes
      mockEvent.content('en').name = 'New Change';

      const isDirty = composable.checkDirtyState(mockEvent, ['cat-1'], 'media-1');
      expect(isDirty).toBe(true);
    });
  });

  describe('handleBack navigation', () => {
    it('should navigate back when not dirty', () => {
      composable.handleBack(mockRouter);

      expect(mockRouter.back).toHaveBeenCalled();
      expect(composable.showUnsavedChangesDialog.value).toBe(false);
    });

    it('should show dialog when dirty', () => {
      composable.isDirty.value = true;

      composable.handleBack(mockRouter);

      expect(composable.showUnsavedChangesDialog.value).toBe(true);
      expect(mockRouter.back).not.toHaveBeenCalled();
    });

    it('should navigate to calendars when history length is 1', () => {
      Object.defineProperty(window, 'history', {
        value: { length: 1 },
        writable: true,
      });

      composable.handleBack(mockRouter);

      expect(mockRouter.push).toHaveBeenCalledWith({ name: 'calendars' });
      expect(mockRouter.back).not.toHaveBeenCalled();
    });

    it('should store correct navigation callback for history.length > 1', () => {
      composable.isDirty.value = true;

      composable.handleBack(mockRouter);
      composable.confirmLeave();

      expect(mockRouter.back).toHaveBeenCalled();
    });

    it('should store correct navigation callback for history.length = 1', () => {
      Object.defineProperty(window, 'history', {
        value: { length: 1 },
        writable: true,
      });

      composable.isDirty.value = true;

      composable.handleBack(mockRouter);
      composable.confirmLeave();

      expect(mockRouter.push).toHaveBeenCalledWith({ name: 'calendars' });
    });
  });
});
