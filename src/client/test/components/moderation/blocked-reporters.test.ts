import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { mountComponent } from '@/client/test/lib/vue';
import BlockedReporters from '@/client/components/moderation/blocked-reporters.vue';
import BlockedReportersService from '@/client/service/blocked-reporters';
import { BlockedReporter } from '@/common/model/blocked_reporter';

// Mock the blocked reporters service
vi.mock('@/client/service/blocked-reporters');

const routes = [
  { path: '/', component: {} },
];

describe('BlockedReporters.vue', () => {
  let mockService: any;
  let router: any;

  beforeEach(() => {
    setActivePinia(createPinia());
    router = createRouter({
      history: createMemoryHistory(),
      routes: routes,
    });
    mockService = vi.mocked(BlockedReportersService).prototype;
  });

  /**
   * Helper to create a mock blocked reporter.
   */
  const createMockBlockedReporter = (
    id: string,
    emailHash: string,
    blockedBy: string,
    reason: string,
    createdAt: Date = new Date('2024-01-15'),
  ): BlockedReporter => {
    const reporter = new BlockedReporter(id);
    reporter.emailHash = emailHash;
    reporter.blockedBy = blockedBy;
    reporter.reason = reason;
    reporter.createdAt = createdAt;
    return reporter;
  };

  describe('Initial Load', () => {
    it('displays loading state while fetching data', async () => {
      let resolvePromise: any;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      mockService.listBlockedReporters = vi.fn(() => pendingPromise);

      const wrapper = mountComponent(BlockedReporters, router);
      await wrapper.vm.$nextTick();

      // Should show loading while promise is pending
      expect(wrapper.text()).toContain('Loading');

      // Clean up - resolve the promise
      resolvePromise([]);
      await flushPromises();
    });

    it('fetches and displays blocked reporters list on mount', async () => {
      const mockReporters = [
        createMockBlockedReporter(
          'reporter-1',
          'abc123hash',
          'admin-user-id',
          'Repeated spam reports',
        ),
        createMockBlockedReporter(
          'reporter-2',
          'def456hash',
          'admin-user-id',
          'Abusive behavior',
        ),
      ];

      mockService.listBlockedReporters = vi.fn().mockResolvedValue(mockReporters);

      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      // Check table headers
      expect(wrapper.text()).toContain('Email Hash');
      expect(wrapper.text()).toContain('Reason');
      expect(wrapper.text()).toContain('Blocked By');
      expect(wrapper.text()).toContain('Date Blocked');

      // Check data is displayed
      expect(wrapper.text()).toContain('abc123hash');
      expect(wrapper.text()).toContain('Repeated spam reports');
      expect(wrapper.text()).toContain('def456hash');
      expect(wrapper.text()).toContain('Abusive behavior');
    });
  });

  describe('Empty State', () => {
    it('displays empty state when no blocked reporters exist', async () => {
      mockService.listBlockedReporters = vi.fn().mockResolvedValue([]);

      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      expect(wrapper.text()).toContain('No blocked reporters');
    });
  });

  describe('Error State', () => {
    it('displays error message when fetch fails', async () => {
      mockService.listBlockedReporters = vi.fn().mockRejectedValue(new Error('Network error'));

      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      expect(wrapper.text()).toContain('Failed to load blocked reporters');
    });
  });

  describe('Data Display', () => {
    it('formats dates correctly', async () => {
      const mockReporters = [
        createMockBlockedReporter(
          'reporter-1',
          'abc123hash',
          'admin-user-id',
          'Test reason',
          new Date('2024-03-15T10:30:00Z'),
        ),
      ];

      mockService.listBlockedReporters = vi.fn().mockResolvedValue(mockReporters);

      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      // Date should be formatted (exact format depends on locale)
      const tableText = wrapper.text();
      expect(tableText).toMatch(/Mar|March/i);
    });

    it('truncates long email hashes for display', async () => {
      const longHash = 'a'.repeat(100);
      const mockReporters = [
        createMockBlockedReporter(
          'reporter-1',
          longHash,
          'admin-user-id',
          'Test reason',
        ),
      ];

      mockService.listBlockedReporters = vi.fn().mockResolvedValue(mockReporters);

      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      // Should display truncated version
      const emailHashElements = wrapper.findAll('.blocked-reporters__email-hash');
      expect(emailHashElements).toHaveLength(1);
      expect(emailHashElements[0].text().length).toBeLessThan(longHash.length);
    });
  });

  describe('Block Reporter Modal', () => {
    beforeEach(() => {
      mockService.listBlockedReporters = vi.fn().mockResolvedValue([]);
    });

    it('opens modal when block button is clicked', async () => {
      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      // Modal should not be visible initially
      expect(wrapper.find('.modal-overlay').exists()).toBe(false);

      // Click block button
      await wrapper.find('.block-reporter-button').trigger('click');
      await wrapper.vm.$nextTick();

      // Modal should now be visible
      expect(wrapper.find('.modal-overlay').exists()).toBe(true);
      expect(wrapper.text()).toContain('Block Reporter');
    });

    it('closes modal when cancel button is clicked', async () => {
      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      // Open modal
      await wrapper.find('.block-reporter-button').trigger('click');
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.modal-overlay').exists()).toBe(true);

      // Click cancel
      await wrapper.find('.cancel-button').trigger('click');
      await wrapper.vm.$nextTick();

      // Modal should be closed
      expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    });

    it('closes modal when clicking overlay', async () => {
      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      // Open modal
      await wrapper.find('.block-reporter-button').trigger('click');
      await wrapper.vm.$nextTick();

      // Click overlay
      await wrapper.find('.modal-overlay').trigger('click');
      await wrapper.vm.$nextTick();

      // Modal should be closed
      expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    });

    it('validates email is required', async () => {
      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      // Open modal
      await wrapper.find('.block-reporter-button').trigger('click');
      await wrapper.vm.$nextTick();

      // Try to submit without email
      await wrapper.find('.confirm-button').trigger('click');
      await wrapper.vm.$nextTick();

      // Should show validation error
      expect(wrapper.text()).toContain('Email is required');
      expect(mockService.blockReporter).not.toHaveBeenCalled();
    });

    it('validates reason is required', async () => {
      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      // Open modal
      await wrapper.find('.block-reporter-button').trigger('click');
      await wrapper.vm.$nextTick();

      // Fill email but not reason
      const emailInput = wrapper.find('#block-email-input');
      await emailInput.setValue('spam@example.com');

      // Try to submit
      await wrapper.find('.confirm-button').trigger('click');
      await wrapper.vm.$nextTick();

      // Should show validation error
      expect(wrapper.text()).toContain('Reason is required');
      expect(mockService.blockReporter).not.toHaveBeenCalled();
    });

    it('validates email format', async () => {
      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      // Open modal
      await wrapper.find('.block-reporter-button').trigger('click');
      await wrapper.vm.$nextTick();

      // Fill with invalid email
      const emailInput = wrapper.find('#block-email-input');
      await emailInput.setValue('not-an-email');

      const reasonInput = wrapper.find('#block-reason-input');
      await reasonInput.setValue('Some reason');

      // Try to submit
      await wrapper.find('.confirm-button').trigger('click');
      await wrapper.vm.$nextTick();

      // Should show validation error
      expect(wrapper.text()).toContain('Invalid email format');
      expect(mockService.blockReporter).not.toHaveBeenCalled();
    });

    it('blocks reporter when form is valid', async () => {
      const newBlockedReporter = createMockBlockedReporter(
        'new-id',
        'hashed-email',
        'admin-user-id',
        'Spam reports',
      );

      mockService.blockReporter = vi.fn().mockResolvedValue(newBlockedReporter);
      mockService.listBlockedReporters = vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([newBlockedReporter]);

      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      // Open modal
      await wrapper.find('.block-reporter-button').trigger('click');
      await wrapper.vm.$nextTick();

      // Fill form
      const emailInput = wrapper.find('#block-email-input');
      await emailInput.setValue('spam@example.com');

      const reasonInput = wrapper.find('#block-reason-input');
      await reasonInput.setValue('Repeated spam reports');

      // Submit
      await wrapper.find('.confirm-button').trigger('click');
      await flushPromises();

      // Should call blockReporter API
      expect(mockService.blockReporter).toHaveBeenCalledWith(
        'spam@example.com',
        'Repeated spam reports',
      );

      // Modal should be closed
      expect(wrapper.find('.modal-overlay').exists()).toBe(false);
    });

    it('shows loading state while blocking', async () => {
      let resolveBlock: any;
      const blockPromise = new Promise((resolve) => {
        resolveBlock = resolve;
      });

      mockService.blockReporter = vi.fn(() => blockPromise);

      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      // Open modal and fill form
      await wrapper.find('.block-reporter-button').trigger('click');
      await wrapper.vm.$nextTick();

      const emailInput = wrapper.find('#block-email-input');
      await emailInput.setValue('test@example.com');

      const reasonInput = wrapper.find('#block-reason-input');
      await reasonInput.setValue('Test reason');

      // Submit
      await wrapper.find('.confirm-button').trigger('click');
      await wrapper.vm.$nextTick();

      // Should show loading state
      const submitButton = wrapper.find('.confirm-button');
      expect(submitButton.attributes('disabled')).toBeDefined();
      expect(submitButton.text()).toContain('Blocking');

      // Clean up
      resolveBlock(createMockBlockedReporter('id', 'hash', 'admin', 'reason'));
      await flushPromises();
    });

    it('displays error message on block failure', async () => {
      mockService.blockReporter = vi.fn().mockRejectedValue(new Error('Block failed'));

      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      // Open modal and fill form
      await wrapper.find('.block-reporter-button').trigger('click');
      await wrapper.vm.$nextTick();

      const emailInput = wrapper.find('#block-email-input');
      await emailInput.setValue('test@example.com');

      const reasonInput = wrapper.find('#block-reason-input');
      await reasonInput.setValue('Test reason');

      // Submit
      await wrapper.find('.confirm-button').trigger('click');
      await flushPromises();

      // Should display error message
      expect(wrapper.text()).toContain('Failed to block reporter');
    });

    it('displays success message after successful block', async () => {
      const newBlockedReporter = createMockBlockedReporter(
        'new-id',
        'hashed-email',
        'admin-user-id',
        'Spam reports',
      );

      mockService.blockReporter = vi.fn().mockResolvedValue(newBlockedReporter);
      mockService.listBlockedReporters = vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([newBlockedReporter]);

      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      // Open modal and submit
      await wrapper.find('.block-reporter-button').trigger('click');
      await wrapper.vm.$nextTick();

      const emailInput = wrapper.find('#block-email-input');
      await emailInput.setValue('spam@example.com');

      const reasonInput = wrapper.find('#block-reason-input');
      await reasonInput.setValue('Test reason');

      await wrapper.find('.confirm-button').trigger('click');
      await flushPromises();

      // Should show success message
      expect(wrapper.text()).toContain('Reporter blocked successfully');
    });

    it('clears form after successful block', async () => {
      const newBlockedReporter = createMockBlockedReporter(
        'new-id',
        'hashed-email',
        'admin-user-id',
        'Spam reports',
      );

      mockService.blockReporter = vi.fn().mockResolvedValue(newBlockedReporter);
      mockService.listBlockedReporters = vi.fn()
        .mockResolvedValue([])
        .mockResolvedValue([newBlockedReporter]);

      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      // Open modal and submit
      await wrapper.find('.block-reporter-button').trigger('click');
      await wrapper.vm.$nextTick();

      const emailInput = wrapper.find('#block-email-input');
      await emailInput.setValue('spam@example.com');

      const reasonInput = wrapper.find('#block-reason-input');
      await reasonInput.setValue('Test reason');

      await wrapper.find('.confirm-button').trigger('click');
      await flushPromises();

      // Open modal again
      await wrapper.find('.block-reporter-button').trigger('click');
      await wrapper.vm.$nextTick();

      // Form should be cleared
      expect(wrapper.find('#block-email-input').element.value).toBe('');
      expect(wrapper.find('#block-reason-input').element.value).toBe('');
    });
  });

  describe('Unblock Functionality', () => {
    it('displays unblock button for each blocked reporter', async () => {
      const mockReporters = [
        createMockBlockedReporter(
          'reporter-1',
          'abc123hash',
          'admin-user-id',
          'Test reason',
        ),
      ];

      mockService.listBlockedReporters = vi.fn().mockResolvedValue(mockReporters);

      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      const unblockButtons = wrapper.findAll('[data-test="unblock-button"]');
      expect(unblockButtons).toHaveLength(1);
    });

    it('shows confirmation dialog when unblock button is clicked', async () => {
      const mockReporters = [
        createMockBlockedReporter(
          'reporter-1',
          'abc123hash',
          'admin-user-id',
          'Test reason',
        ),
      ];

      mockService.listBlockedReporters = vi.fn().mockResolvedValue(mockReporters);

      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      // Click the unblock button
      const unblockButton = wrapper.find('[data-test="unblock-button"]');
      await unblockButton.trigger('click');
      await wrapper.vm.$nextTick();

      // Should show confirmation dialog
      expect(wrapper.text()).toContain('Unblock Reporter');
      expect(wrapper.text()).toContain('abc123hash');
      expect(wrapper.text()).toContain('Test reason');
    });

    it('calls unblockReporter service when confirmation is submitted', async () => {
      const mockReporters = [
        createMockBlockedReporter(
          'reporter-1',
          'abc123hash',
          'admin-user-id',
          'Test reason',
        ),
      ];

      mockService.listBlockedReporters = vi.fn().mockResolvedValue(mockReporters);
      mockService.unblockReporter = vi.fn().mockResolvedValue(undefined);

      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      // Click unblock button
      const unblockButton = wrapper.find('[data-test="unblock-button"]');
      await unblockButton.trigger('click');
      await wrapper.vm.$nextTick();

      // Submit the confirmation
      const confirmButton = wrapper.find('[data-test="confirm-unblock"]');
      await confirmButton.trigger('click');
      await flushPromises();

      // Should call the service with the email hash
      expect(mockService.unblockReporter).toHaveBeenCalledWith('abc123hash');
    });

    it('displays loading state while unblocking', async () => {
      const mockReporters = [
        createMockBlockedReporter(
          'reporter-1',
          'abc123hash',
          'admin-user-id',
          'Test reason',
        ),
      ];

      let resolveUnblock: any;
      const unblockPromise = new Promise((resolve) => {
        resolveUnblock = resolve;
      });

      mockService.listBlockedReporters = vi.fn().mockResolvedValue(mockReporters);
      mockService.unblockReporter = vi.fn(() => unblockPromise);

      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      // Click unblock button
      const unblockButton = wrapper.find('[data-test="unblock-button"]');
      await unblockButton.trigger('click');
      await wrapper.vm.$nextTick();

      // Submit the confirmation
      const confirmButton = wrapper.find('[data-test="confirm-unblock"]');
      await confirmButton.trigger('click');
      await wrapper.vm.$nextTick();

      // Should show loading text on button
      expect(confirmButton.text()).toContain('Unblocking');

      // Clean up
      resolveUnblock();
      await flushPromises();
    });

    it('refreshes list after successful unblock', async () => {
      const mockReporters = [
        createMockBlockedReporter(
          'reporter-1',
          'abc123hash',
          'admin-user-id',
          'Test reason',
        ),
      ];

      mockService.listBlockedReporters = vi.fn()
        .mockResolvedValueOnce(mockReporters)
        .mockResolvedValueOnce([]);
      mockService.unblockReporter = vi.fn().mockResolvedValue(undefined);

      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      // Click unblock button
      const unblockButton = wrapper.find('[data-test="unblock-button"]');
      await unblockButton.trigger('click');
      await wrapper.vm.$nextTick();

      // Submit the confirmation
      const confirmButton = wrapper.find('[data-test="confirm-unblock"]');
      await confirmButton.trigger('click');
      await flushPromises();

      // Should show empty state after refresh
      expect(wrapper.text()).toContain('No blocked reporters');
    });

    it('displays success message after unblocking', async () => {
      const mockReporters = [
        createMockBlockedReporter(
          'reporter-1',
          'abc123hash',
          'admin-user-id',
          'Test reason',
        ),
      ];

      mockService.listBlockedReporters = vi.fn().mockResolvedValue(mockReporters);
      mockService.unblockReporter = vi.fn().mockResolvedValue(undefined);

      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      // Click unblock button
      const unblockButton = wrapper.find('[data-test="unblock-button"]');
      await unblockButton.trigger('click');
      await wrapper.vm.$nextTick();

      // Submit the confirmation
      const confirmButton = wrapper.find('[data-test="confirm-unblock"]');
      await confirmButton.trigger('click');
      await flushPromises();

      // Should show success message
      expect(wrapper.text()).toContain('Reporter has been unblocked');
    });

    it('displays error message when unblock fails', async () => {
      const mockReporters = [
        createMockBlockedReporter(
          'reporter-1',
          'abc123hash',
          'admin-user-id',
          'Test reason',
        ),
      ];

      mockService.listBlockedReporters = vi.fn().mockResolvedValue(mockReporters);
      mockService.unblockReporter = vi.fn().mockRejectedValue(new Error('Network error'));

      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      // Click unblock button
      const unblockButton = wrapper.find('[data-test="unblock-button"]');
      await unblockButton.trigger('click');
      await wrapper.vm.$nextTick();

      // Submit the confirmation
      const confirmButton = wrapper.find('[data-test="confirm-unblock"]');
      await confirmButton.trigger('click');
      await flushPromises();

      // Should show error message
      expect(wrapper.text()).toContain('Failed to unblock reporter');
    });

    it('closes confirmation dialog when cancel button is clicked', async () => {
      const mockReporters = [
        createMockBlockedReporter(
          'reporter-1',
          'abc123hash',
          'admin-user-id',
          'Test reason',
        ),
      ];

      mockService.listBlockedReporters = vi.fn().mockResolvedValue(mockReporters);

      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      // Click unblock button
      const unblockButton = wrapper.find('[data-test="unblock-button"]');
      await unblockButton.trigger('click');
      await wrapper.vm.$nextTick();

      // Dialog should be visible
      expect(wrapper.text()).toContain('Unblock Reporter');

      // Click cancel
      const cancelButton = wrapper.find('[data-test="cancel-unblock"]');
      await cancelButton.trigger('click');
      await wrapper.vm.$nextTick();

      // Dialog should be closed (no longer showing modal content)
      expect(wrapper.find('[data-test="confirm-unblock"]').exists()).toBe(false);
    });
  });

  describe('Accessibility', () => {
    it('has proper ARIA labels on the table', async () => {
      const mockReporters = [
        createMockBlockedReporter(
          'reporter-1',
          'abc123hash',
          'admin-user-id',
          'Test reason',
        ),
      ];

      mockService.listBlockedReporters = vi.fn().mockResolvedValue(mockReporters);

      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      const table = wrapper.find('table');
      expect(table.attributes('role')).toBe('grid');
      expect(table.attributes('aria-label')).toBeTruthy();
    });

    it('uses semantic HTML for table structure', async () => {
      const mockReporters = [
        createMockBlockedReporter(
          'reporter-1',
          'abc123hash',
          'admin-user-id',
          'Test reason',
        ),
      ];

      mockService.listBlockedReporters = vi.fn().mockResolvedValue(mockReporters);

      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      expect(wrapper.find('table').exists()).toBe(true);
      expect(wrapper.find('thead').exists()).toBe(true);
      expect(wrapper.find('tbody').exists()).toBe(true);
      expect(wrapper.findAll('th').length).toBeGreaterThan(0);
    });

    it('modal has proper ARIA attributes', async () => {
      mockService.listBlockedReporters = vi.fn().mockResolvedValue([]);

      const wrapper = mountComponent(BlockedReporters, router);
      await flushPromises();

      // Open modal
      await wrapper.find('.block-reporter-button').trigger('click');
      await wrapper.vm.$nextTick();

      const modal = wrapper.find('.modal');
      expect(modal.attributes('role')).toBe('dialog');
      expect(modal.attributes('aria-modal')).toBe('true');
      expect(modal.attributes('aria-labelledby')).toBeTruthy();
    });
  });
});
