<script setup>
import { watch, onUnmounted } from 'vue';
import { useToast } from '@/client/composables/useToast';

const { toasts, removeToast } = useToast();

/**
 * Track auto-dismiss timers and exit-animation timers for cleanup
 */
const dismissTimers = new Map();
const exitTimers = new Map();

/**
 * Determine the correct ARIA role for a toast type.
 * Errors and warnings use role="alert" for immediate announcement.
 * Success and info use role="status" for polite announcement.
 */
function ariaRole(type) {
  return type === 'error' || type === 'warning' ? 'alert' : 'status';
}

/**
 * Determine the correct aria-live value for a toast type.
 * Errors and warnings use "assertive" to interrupt the user.
 * Success and info use "polite" to wait for a pause.
 */
function ariaLive(type) {
  return type === 'error' || type === 'warning' ? 'assertive' : 'polite';
}

/**
 * Set of toast IDs currently in exit animation
 */
const exitingIds = new Set();

/**
 * Begin the exit animation for a toast, then remove it after the animation completes.
 */
function dismissToast(id) {
  // Clear any existing dismiss timer
  if (dismissTimers.has(id)) {
    clearTimeout(dismissTimers.get(id));
    dismissTimers.delete(id);
  }

  // Add exiting class for animation
  exitingIds.add(id);

  // Remove after exit animation (200ms matches toastFadeOut in _alerts.scss)
  const exitTimer = setTimeout(() => {
    exitingIds.delete(id);
    exitTimers.delete(id);
    removeToast(id);
  }, 200);

  exitTimers.set(id, exitTimer);
}

/**
 * Schedule auto-dismiss for toasts that have a positive duration.
 * Error toasts (duration=0) require manual dismiss.
 */
function scheduleAutoDismiss(toast) {
  if (toast.duration > 0) {
    const timer = setTimeout(() => {
      dismissTimers.delete(toast.id);
      dismissToast(toast.id);
    }, toast.duration);
    dismissTimers.set(toast.id, timer);
  }
}

/**
 * Check if a toast is currently in exit animation
 */
function isExiting(id) {
  return exitingIds.has(id);
}

/**
 * Build CSS class list for a toast based on its type and exit state
 */
function toastClasses(toast) {
  return [
    'toast',
    `alert--${toast.type}`,
    { 'toast--exiting': isExiting(toast.id) },
  ];
}

// Watch for new toasts being added and schedule their auto-dismiss
watch(
  () => toasts.value.length,
  (newLen, oldLen) => {
    if (newLen > oldLen) {
      // Schedule auto-dismiss for newly added toasts
      const newToasts = toasts.value.slice(oldLen);
      for (const toast of newToasts) {
        scheduleAutoDismiss(toast);
      }
    }
  },
);

// Clean up all timers when the component is unmounted
onUnmounted(() => {
  for (const timer of dismissTimers.values()) {
    clearTimeout(timer);
  }
  dismissTimers.clear();

  for (const timer of exitTimers.values()) {
    clearTimeout(timer);
  }
  exitTimers.clear();

  exitingIds.clear();
});
</script>

<template>
  <div class="toast-container toast-container--top-right">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      :class="toastClasses(toast)"
      :role="ariaRole(toast.type)"
      :aria-live="ariaLive(toast.type)"
    >
      <div class="alert__content">
        <p
          v-if="toast.title"
          class="alert__title"
        >
          {{ toast.title }}
        </p>
        <p class="alert__message">
          {{ toast.message }}
        </p>
      </div>
      <button
        class="alert__close"
        type="button"
        aria-label="Dismiss notification"
        @click="dismissToast(toast.id)"
      >
        &times;
      </button>
      <div
        v-if="toast.duration > 0"
        class="toast__progress"
        :style="{ animationDuration: `${toast.duration}ms` }"
      />
    </div>
  </div>
</template>
