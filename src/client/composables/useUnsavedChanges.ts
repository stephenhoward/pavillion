import { ref, nextTick } from 'vue';
import type { Router, NavigationGuardNext, RouteLocationNormalized } from 'vue-router';
import { CalendarEvent } from '@/common/model/events';

/**
 * Composable for tracking unsaved changes and handling navigation guards
 * Manages dirty state, snapshots, and confirmation dialogs when leaving a form with unsaved data
 */
export function useUnsavedChanges() {
  const isDirty = ref(false);
  const snapshotReady = ref(false);
  const showUnsavedChangesDialog = ref(false);
  const originalEventSnapshot = ref<string | null>(null);
  const pendingNavigation = ref<(() => void) | null>(null);

  /**
   * Create a snapshot of the current event state for comparison
   * Uses _content (Record) from the TranslatedModel base class
   */
  const createEventSnapshot = (
    event: CalendarEvent | null,
    selectedCategories: string[],
    mediaId: string | null,
  ) => {
    if (!event) return null;

    // Get content from _content Record and convert to a sorted array for consistent comparison
    const contentEntries = event._content
      ? Object.entries(event._content).sort(([a], [b]) => a.localeCompare(b)).map(([lang, c]) => ({
        language: lang,
        name: c.name || '',
        description: c.description || '',
      }))
      : [];

    // Create a serializable snapshot of the event data
    return JSON.stringify({
      calendarId: event.calendarId,
      contents: contentEntries,
      location: event.location ? {
        name: event.location.name || '',
        address: event.location.address || '',
        city: event.location.city || '',
        state: event.location.state || '',
        postalCode: event.location.postalCode || '',
      } : {},
      schedules: event.schedules?.map(s => ({
        startDate: s.startDate,
        endDate: s.endDate,
        allDay: s.allDay,
        rrule: s.rrule,
      })) || [],
      categories: [...selectedCategories].sort(),
      mediaId: mediaId,
    });
  };

  /**
   * Initialize the original snapshot for dirty state tracking
   * Call this after the component has mounted and rendered
   */
  const initializeSnapshot = async (
    event: CalendarEvent | null,
    selectedCategories: string[],
    mediaId: string | null,
  ) => {
    // Wait for the next tick(s) to ensure the template has rendered
    // and any v-model bindings have initialized the content
    await nextTick();
    await nextTick();
    await nextTick();

    // Now take the snapshot - this captures the state after template rendering
    originalEventSnapshot.value = createEventSnapshot(event, selectedCategories, mediaId);
    snapshotReady.value = true;
  };

  /**
   * Reset the snapshot to current state (e.g., after save)
   */
  const resetSnapshot = (
    event: CalendarEvent | null,
    selectedCategories: string[],
    mediaId: string | null,
  ) => {
    originalEventSnapshot.value = createEventSnapshot(event, selectedCategories, mediaId);
    isDirty.value = false;
  };

  /**
   * Check if the current event state differs from the original snapshot
   */
  const checkDirtyState = (
    event: CalendarEvent | null,
    selectedCategories: string[],
    mediaId: string | null,
  ) => {
    if (!originalEventSnapshot.value || !event || !snapshotReady.value) {
      return false;
    }

    const currentSnapshot = createEventSnapshot(event, selectedCategories, mediaId);
    return currentSnapshot !== originalEventSnapshot.value;
  };

  /**
   * Handle back button navigation with unsaved changes check
   */
  const handleBack = (router: Router) => {
    if (isDirty.value) {
      // Show confirmation dialog
      showUnsavedChangesDialog.value = true;
      pendingNavigation.value = () => {
        if (window.history.length > 1) {
          router.back();
        }
        else {
          router.push({ name: 'calendars' });
        }
      };
    }
    else {
      // Navigate back directly
      if (window.history.length > 1) {
        router.back();
      }
      else {
        router.push({ name: 'calendars' });
      }
    }
  };

  /**
   * Confirm leaving with unsaved changes
   */
  const confirmLeave = () => {
    showUnsavedChangesDialog.value = false;
    isDirty.value = false; // Reset dirty state to allow navigation

    if (pendingNavigation.value) {
      pendingNavigation.value();
      pendingNavigation.value = null;
    }
  };

  /**
   * Cancel leaving and stay on the page
   */
  const cancelLeave = () => {
    showUnsavedChangesDialog.value = false;
    pendingNavigation.value = null;
  };

  /**
   * Setup navigation guard to check for unsaved changes
   * Call this function with onBeforeRouteLeave from the component
   */
  const setupNavigationGuard = (
    to: RouteLocationNormalized,
    from: RouteLocationNormalized,
    next: NavigationGuardNext,
  ) => {
    if (isDirty.value && !showUnsavedChangesDialog.value) {
      // Show confirmation dialog and block navigation
      showUnsavedChangesDialog.value = true;
      pendingNavigation.value = () => next();
      next(false);
    }
    else if (showUnsavedChangesDialog.value) {
      // Already showing dialog, block navigation
      next(false);
    }
    else {
      // No unsaved changes, allow navigation
      next();
    }
  };

  return {
    isDirty,
    snapshotReady,
    showUnsavedChangesDialog,
    initializeSnapshot,
    resetSnapshot,
    checkDirtyState,
    handleBack,
    confirmLeave,
    cancelLeave,
    setupNavigationGuard,
  };
}
