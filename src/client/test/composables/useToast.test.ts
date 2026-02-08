import { describe, it, expect, beforeEach } from 'vitest';
import { useToast, resetToastState } from '@/client/composables/useToast';

describe('useToast', () => {
  beforeEach(() => {
    resetToastState();
  });

  describe('initialization', () => {
    it('should initialize with an empty toasts array', () => {
      const { toasts } = useToast();

      expect(toasts.value).toEqual([]);
    });
  });

  describe('adding and removing toasts', () => {
    it('should add a toast with addToast', () => {
      const { toasts, addToast } = useToast();

      addToast({ message: 'Test message', type: 'info' });

      expect(toasts.value).toHaveLength(1);
      expect(toasts.value[0].message).toBe('Test message');
      expect(toasts.value[0].type).toBe('info');
    });

    it('should assign auto-incrementing IDs to toasts', () => {
      const { toasts, addToast } = useToast();

      addToast({ message: 'First', type: 'info' });
      addToast({ message: 'Second', type: 'info' });

      expect(toasts.value[0].id).toBe(1);
      expect(toasts.value[1].id).toBe(2);
    });

    it('should remove a toast by ID', () => {
      const { toasts, addToast, removeToast } = useToast();

      addToast({ message: 'First', type: 'info' });
      addToast({ message: 'Second', type: 'success' });

      removeToast(1);

      expect(toasts.value).toHaveLength(1);
      expect(toasts.value[0].message).toBe('Second');
    });

    it('should handle removing a non-existent toast ID gracefully', () => {
      const { toasts, addToast, removeToast } = useToast();

      addToast({ message: 'First', type: 'info' });
      removeToast(999);

      expect(toasts.value).toHaveLength(1);
    });
  });

  describe('convenience methods', () => {
    it('should set type to success with success()', () => {
      const { toasts, success } = useToast();

      success('Operation completed');

      expect(toasts.value[0].type).toBe('success');
      expect(toasts.value[0].message).toBe('Operation completed');
    });

    it('should set type to error with error()', () => {
      const { toasts, error } = useToast();

      error('Something failed');

      expect(toasts.value[0].type).toBe('error');
      expect(toasts.value[0].message).toBe('Something failed');
    });

    it('should set type to warning with warning()', () => {
      const { toasts, warning } = useToast();

      warning('Be careful');

      expect(toasts.value[0].type).toBe('warning');
      expect(toasts.value[0].message).toBe('Be careful');
    });

    it('should set type to info with info()', () => {
      const { toasts, info } = useToast();

      info('FYI');

      expect(toasts.value[0].type).toBe('info');
      expect(toasts.value[0].message).toBe('FYI');
    });
  });

  describe('default durations', () => {
    it('should use 5000ms duration for success toasts', () => {
      const { toasts, success } = useToast();

      success('Done');

      expect(toasts.value[0].duration).toBe(5000);
    });

    it('should use 5000ms duration for info toasts', () => {
      const { toasts, info } = useToast();

      info('Note');

      expect(toasts.value[0].duration).toBe(5000);
    });

    it('should use 8000ms duration for warning toasts', () => {
      const { toasts, warning } = useToast();

      warning('Watch out');

      expect(toasts.value[0].duration).toBe(8000);
    });

    it('should use 0ms (manual dismiss) duration for error toasts', () => {
      const { toasts, error } = useToast();

      error('Failed');

      expect(toasts.value[0].duration).toBe(0);
    });
  });

  describe('custom duration override', () => {
    it('should allow overriding the default duration', () => {
      const { toasts, addToast } = useToast();

      addToast({ message: 'Custom', type: 'success', duration: 10000 });

      expect(toasts.value[0].duration).toBe(10000);
    });

    it('should allow overriding error duration to auto-dismiss', () => {
      const { toasts, error } = useToast();

      error('Auto-dismiss error', { duration: 3000 });

      expect(toasts.value[0].duration).toBe(3000);
    });
  });

  describe('shared state across multiple useToast() calls', () => {
    it('should share toasts between different useToast() instances', () => {
      const toast1 = useToast();
      const toast2 = useToast();

      toast1.addToast({ message: 'From instance 1', type: 'info' });

      expect(toast2.toasts.value).toHaveLength(1);
      expect(toast2.toasts.value[0].message).toBe('From instance 1');
    });

    it('should allow removing toasts from a different instance', () => {
      const toast1 = useToast();
      const toast2 = useToast();

      toast1.addToast({ message: 'Shared toast', type: 'success' });
      const toastId = toast1.toasts.value[0].id;

      toast2.removeToast(toastId);

      expect(toast1.toasts.value).toHaveLength(0);
      expect(toast2.toasts.value).toHaveLength(0);
    });
  });

  describe('title support', () => {
    it('should support an optional title on toasts', () => {
      const { toasts, addToast } = useToast();

      addToast({ message: 'Details here', type: 'error', title: 'Error Title' });

      expect(toasts.value[0].title).toBe('Error Title');
      expect(toasts.value[0].message).toBe('Details here');
    });

    it('should support title in convenience methods', () => {
      const { toasts, error } = useToast();

      error('Something broke', { title: 'Oops' });

      expect(toasts.value[0].title).toBe('Oops');
      expect(toasts.value[0].type).toBe('error');
    });

    it('should default title to undefined when not provided', () => {
      const { toasts, info } = useToast();

      info('No title');

      expect(toasts.value[0].title).toBeUndefined();
    });
  });
});
