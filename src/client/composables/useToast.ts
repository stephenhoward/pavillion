import { ref } from 'vue';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
  title?: string;
  duration: number;
}

export interface ToastOptions {
  message: string;
  type: ToastType;
  title?: string;
  duration?: number;
}

interface ConvenienceOptions {
  title?: string;
  duration?: number;
}

const DEFAULT_DURATIONS: Record<ToastType, number> = {
  success: 5000,
  info: 5000,
  warning: 8000,
  error: 0,
};

/**
 * Module-level reactive state shared across all useToast() callers
 */
const toasts = ref<Toast[]>([]);
let nextId = 1;

/**
 * Reset toast state. Exported for testing purposes only.
 */
export function resetToastState(): void {
  toasts.value = [];
  nextId = 1;
}

/**
 * Composable for managing toast notifications.
 *
 * Uses module-level reactive state so all components share
 * the same toast list. Adding a toast from any component
 * makes it visible to the ToastContainer.
 */
export function useToast() {

  /**
   * Add a toast notification
   */
  const addToast = (options: ToastOptions): Toast => {
    const toast: Toast = {
      id: nextId++,
      type: options.type,
      message: options.message,
      title: options.title,
      duration: options.duration ?? DEFAULT_DURATIONS[options.type],
    };

    toasts.value.push(toast);
    return toast;
  };

  /**
   * Remove a toast by ID
   */
  const removeToast = (id: number): void => {
    const index = toasts.value.findIndex(t => t.id === id);
    if (index >= 0) {
      toasts.value.splice(index, 1);
    }
  };

  /**
   * Show a success toast
   */
  const success = (message: string, options?: ConvenienceOptions): Toast => {
    return addToast({ message, type: 'success', ...options });
  };

  /**
   * Show an error toast
   */
  const error = (message: string, options?: ConvenienceOptions): Toast => {
    return addToast({ message, type: 'error', ...options });
  };

  /**
   * Show a warning toast
   */
  const warning = (message: string, options?: ConvenienceOptions): Toast => {
    return addToast({ message, type: 'warning', ...options });
  };

  /**
   * Show an info toast
   */
  const info = (message: string, options?: ConvenienceOptions): Toast => {
    return addToast({ message, type: 'info', ...options });
  };

  return {
    toasts,
    addToast,
    removeToast,
    success,
    error,
    warning,
    info,
  };
}
