import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';
import sinon from 'sinon';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import ReportEvent from '@/client/components/report-event.vue';
import { ReportCategory } from '@/common/model/report';
import { DuplicateReportError, ReportValidationError } from '@/common/exceptions/report';
import { EventNotFoundError } from '@/common/exceptions/calendar';
import { UnknownError } from '@/common/exceptions/base';

// Mock the report service module
vi.mock('@/client/service/report', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      submitReport: vi.fn(),
    })),
  };
});

import ReportService from '@/client/service/report';

const TEST_EVENT_ID = 'event-abc-123';
const TEST_USER_EMAIL = 'user@example.com';

/**
 * i18next requires initialization to return key paths for missing keys.
 * Without init, t() returns undefined which breaks reactive state.
 * Keys are mapped to themselves so assertions can check for key paths.
 */
const reportTranslations: Record<string, string> = {
  'report.form_title': 'report.form_title',
  'report.close_dialog': 'report.close_dialog',
  'report.category_label': 'report.category_label',
  'report.category_spam': 'report.category_spam',
  'report.category_inappropriate': 'report.category_inappropriate',
  'report.category_misleading': 'report.category_misleading',
  'report.category_harassment': 'report.category_harassment',
  'report.category_other': 'report.category_other',
  'report.description_label': 'report.description_label',
  'report.description_placeholder': 'report.description_placeholder',
  'report.email_label': 'report.email_label',
  'report.submit_button': 'report.submit_button',
  'report.cancel_button': 'report.cancel_button',
  'report.submitting_button': 'report.submitting_button',
  'report.success_title': 'report.success_title',
  'report.success_message': 'report.success_message',
  'report.error_duplicate': 'report.error_duplicate',
  'report.error_not_found': 'report.error_not_found',
  'report.error_generic': 'report.error_generic',
  'report.error_validation': 'report.error_validation',
};

/** Helper to get the mocked submitReport from the most recent ReportService instance. */
function getMockSubmitReport(): ReturnType<typeof vi.fn> {
  const MockedService = vi.mocked(ReportService);
  const lastInstance = MockedService.mock.results[MockedService.mock.results.length - 1];
  return lastInstance.value.submitReport;
}

/** Mock authn service that provides userEmail(). */
const mockAuthn = {
  userEmail: () => TEST_USER_EMAIL,
  isLoggedIn: () => true,
  isAdmin: () => false,
};

/**
 * Mount the ReportEvent component with standard test configuration.
 */
const mountReportEvent = (props: Record<string, any> = {}): VueWrapper => {
  return mount(ReportEvent, {
    global: {
      plugins: [[I18NextVue, { i18next }]],
      provide: {
        authn: mockAuthn,
      },
    },
    props: {
      eventId: TEST_EVENT_ID,
      ...props,
    },
  });
};

/**
 * Mount with a custom error handler that suppresses happy-dom v-if/v-else
 * rendering errors. Happy-dom's dialog implementation doesn't handle
 * fragment removal correctly during v-if/v-else DOM patching, producing
 * a nextSibling error. This wrapper is needed for any test that triggers
 * the form-to-success state transition (state.isSuccess = true).
 */
const mountReportEventSuppressRenderErrors = (props: Record<string, any> = {}): VueWrapper => {
  return mount(ReportEvent, {
    global: {
      plugins: [[I18NextVue, { i18next }]],
      provide: {
        authn: mockAuthn,
      },
      config: {
        errorHandler: () => {
          // Suppress happy-dom nextSibling errors during v-if/v-else patch
        },
      },
    },
    props: {
      eventId: TEST_EVENT_ID,
      ...props,
    },
  });
};

/**
 * Fills the form with valid data and submits it.
 * Note: No email field for authenticated users.
 */
const fillAndSubmitForm = async (
  wrapper: VueWrapper,
  overrides: { category?: string; description?: string } = {},
) => {
  const category = overrides.category ?? ReportCategory.SPAM;
  const description = overrides.description ?? 'This is a report description';

  await wrapper.find('select').setValue(category);
  await wrapper.find('textarea').setValue(description);

  await wrapper.find('form').trigger('submit');
  await flushPromises();
};

describe('ReportEvent Component (Client)', () => {
  const sandbox = sinon.createSandbox();

  beforeAll(async () => {
    await i18next.init({
      lng: 'en',
      resources: {
        en: {
          system: reportTranslations,
        },
      },
    });
  });

  beforeEach(() => {
    vi.mocked(ReportService).mockClear();
  });

  afterEach(() => {
    sandbox.restore();
    document.body.classList.remove('modal-open');
  });

  describe('Form Rendering', () => {
    it('should render a dialog element', () => {
      const wrapper = mountReportEvent();

      expect(wrapper.find('dialog').exists()).toBe(true);
      wrapper.unmount();
    });

    it('should render the form title', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      const heading = wrapper.find('h2');
      expect(heading.exists()).toBe(true);
      expect(heading.text()).toBe('report.form_title');
      wrapper.unmount();
    });

    it('should render a category dropdown with all report categories', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      const select = wrapper.find('select');
      expect(select.exists()).toBe(true);

      const options = select.findAll('option');
      // 1 disabled placeholder + 5 category options
      expect(options.length).toBe(6);

      const values = options.map(o => o.element.value);
      expect(values).toContain(ReportCategory.SPAM);
      expect(values).toContain(ReportCategory.INAPPROPRIATE);
      expect(values).toContain(ReportCategory.MISLEADING);
      expect(values).toContain(ReportCategory.HARASSMENT);
      expect(values).toContain(ReportCategory.OTHER);
      wrapper.unmount();
    });

    it('should render a description textarea', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      const textarea = wrapper.find('textarea');
      expect(textarea.exists()).toBe(true);
      expect(textarea.attributes('required')).toBeDefined();
      wrapper.unmount();
    });

    it('should display account email as read-only text instead of an input', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      // Should NOT have an email input field
      const emailInput = wrapper.find('input[type="email"]');
      expect(emailInput.exists()).toBe(false);

      // Should display the user's email as text
      const emailDisplay = wrapper.find('.report-dialog__email-display');
      expect(emailDisplay.exists()).toBe(true);
      expect(emailDisplay.text()).toContain(TEST_USER_EMAIL);
      wrapper.unmount();
    });

    it('should render submit and cancel buttons', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      const submitButton = wrapper.find('button[type="submit"]');
      expect(submitButton.exists()).toBe(true);
      expect(submitButton.text()).toBe('report.submit_button');

      // Cancel button uses design system .btn--secondary class
      const cancelButtons = wrapper.findAll('.btn--secondary');
      expect(cancelButtons.length).toBeGreaterThan(0);
      wrapper.unmount();
    });

    it('should render a close button in the header', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      const closeButton = wrapper.find('.report-dialog__close');
      expect(closeButton.exists()).toBe(true);
      wrapper.unmount();
    });

    it('should have accessible label associations on form fields', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      const select = wrapper.find('select');
      const textarea = wrapper.find('textarea');

      expect(select.attributes('id')).toBeTruthy();
      expect(textarea.attributes('id')).toBeTruthy();

      const labels = wrapper.findAll('label');
      const labelForValues = labels.map(l => l.attributes('for'));
      expect(labelForValues).toContain(select.attributes('id'));
      expect(labelForValues).toContain(textarea.attributes('id'));
      wrapper.unmount();
    });
  });

  describe('Client-Side Validation', () => {
    it('should show error when submitting with empty fields', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      await wrapper.find('form').trigger('submit');
      await flushPromises();

      const errorDiv = wrapper.find('.alert--error');
      expect(errorDiv.exists()).toBe(true);
      expect(errorDiv.text()).toBe('report.error_validation');
      wrapper.unmount();
    });

    it('should show error when category is not selected', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      await wrapper.find('textarea').setValue('This event is problematic');

      await wrapper.find('form').trigger('submit');
      await flushPromises();

      const errorDiv = wrapper.find('.alert--error');
      expect(errorDiv.exists()).toBe(true);
      expect(errorDiv.text()).toBe('report.error_validation');
      wrapper.unmount();
    });

    it('should show error when description is empty', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      await wrapper.find('select').setValue(ReportCategory.SPAM);

      await wrapper.find('form').trigger('submit');
      await flushPromises();

      const errorDiv = wrapper.find('.alert--error');
      expect(errorDiv.exists()).toBe(true);
      wrapper.unmount();
    });

    it('should not show error when all fields are valid', async () => {
      const wrapper = mountReportEventSuppressRenderErrors();
      await flushPromises();

      getMockSubmitReport().mockResolvedValueOnce(undefined);

      await fillAndSubmitForm(wrapper);

      expect(wrapper.find('.alert--error').exists()).toBe(false);
      wrapper.unmount();
    });
  });

  describe('Form Submission', () => {
    it('should call the service with correct data on valid submission (no email)', async () => {
      const wrapper = mountReportEventSuppressRenderErrors();
      await flushPromises();

      const mockSubmit = getMockSubmitReport();
      mockSubmit.mockResolvedValueOnce(undefined);

      await fillAndSubmitForm(wrapper, {
        category: ReportCategory.INAPPROPRIATE,
        description: '  Inappropriate content here  ',
      });

      expect(mockSubmit).toHaveBeenCalledOnce();
      expect(mockSubmit).toHaveBeenCalledWith(
        TEST_EVENT_ID,
        ReportCategory.INAPPROPRIATE,
        'Inappropriate content here',
      );
      wrapper.unmount();
    });

    it('should disable form fields while submitting', async () => {
      const wrapper = mountReportEventSuppressRenderErrors();
      await flushPromises();

      let resolveSubmit!: (value: any) => void;
      const pendingSubmit = new Promise((resolve) => {
        resolveSubmit = resolve;
      });
      getMockSubmitReport().mockReturnValueOnce(pendingSubmit);

      await wrapper.find('select').setValue(ReportCategory.SPAM);
      await wrapper.find('textarea').setValue('Spam content');

      // Submit but do not resolve yet
      wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.find('select').attributes('disabled')).toBeDefined();
      expect(wrapper.find('textarea').attributes('disabled')).toBeDefined();

      const submitButton = wrapper.find('button[type="submit"]');
      expect(submitButton.text()).toBe('report.submitting_button');
      expect(submitButton.attributes('disabled')).toBeDefined();

      resolveSubmit(undefined);
      await flushPromises();
      wrapper.unmount();
    });
  });

  describe('Success State', () => {
    /**
     * Happy-dom has a known issue with Vue's v-if/v-else DOM patching
     * inside <dialog> elements (nextSibling error on fragment removal).
     * Success state tests verify component reactive state directly
     * and use the error-suppressing mount helper.
     */

    it('should set success state and hide form after successful submission', async () => {
      const wrapper = mountReportEventSuppressRenderErrors();
      await flushPromises();

      getMockSubmitReport().mockResolvedValueOnce(undefined);

      await fillAndSubmitForm(wrapper);

      const vm = wrapper.vm as any;
      expect(vm.state.isSuccess).toBe(true);
      expect(vm.state.isSubmitting).toBe(false);
      expect(vm.state.error).toBe('');

      // The form should be removed from the DOM (v-if="!state.isSuccess")
      expect(wrapper.find('form').exists()).toBe(false);
      wrapper.unmount();
    });

    it('should clear submitting flag after success', async () => {
      const wrapper = mountReportEventSuppressRenderErrors();
      await flushPromises();

      getMockSubmitReport().mockResolvedValueOnce(undefined);

      await fillAndSubmitForm(wrapper);

      const vm = wrapper.vm as any;
      expect(vm.state.isSubmitting).toBe(false);
      wrapper.unmount();
    });

    it('should not display any error on successful submission', async () => {
      const wrapper = mountReportEventSuppressRenderErrors();
      await flushPromises();

      getMockSubmitReport().mockResolvedValueOnce(undefined);

      await fillAndSubmitForm(wrapper);

      const vm = wrapper.vm as any;
      expect(vm.state.error).toBe('');
      expect(wrapper.find('.alert--error').exists()).toBe(false);
      wrapper.unmount();
    });
  });

  describe('Error State Display', () => {
    it('should display duplicate error when service throws DuplicateReportError', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      getMockSubmitReport().mockRejectedValueOnce(new DuplicateReportError());

      await fillAndSubmitForm(wrapper);

      const errorDiv = wrapper.find('.alert--error');
      expect(errorDiv.exists()).toBe(true);
      expect(errorDiv.text()).toBe('report.error_duplicate');
      wrapper.unmount();
    });

    it('should display not found error when service throws EventNotFoundError', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      getMockSubmitReport().mockRejectedValueOnce(new EventNotFoundError());

      await fillAndSubmitForm(wrapper);

      const errorDiv = wrapper.find('.alert--error');
      expect(errorDiv.exists()).toBe(true);
      expect(errorDiv.text()).toBe('report.error_not_found');
      wrapper.unmount();
    });

    it('should display generic error when service throws UnknownError', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      getMockSubmitReport().mockRejectedValueOnce(new UnknownError());

      await fillAndSubmitForm(wrapper);

      const errorDiv = wrapper.find('.alert--error');
      expect(errorDiv.exists()).toBe(true);
      expect(errorDiv.text()).toBe('report.error_generic');
      wrapper.unmount();
    });

    it('should display generic error on unexpected errors', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      getMockSubmitReport().mockRejectedValueOnce(new Error('Network Error'));

      await fillAndSubmitForm(wrapper);

      const errorDiv = wrapper.find('.alert--error');
      expect(errorDiv.exists()).toBe(true);
      expect(errorDiv.text()).toBe('report.error_generic');
      wrapper.unmount();
    });

    it('should display server error message when service throws ReportValidationError with custom message', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      getMockSubmitReport().mockRejectedValueOnce(new ReportValidationError('Invalid category value'));

      await fillAndSubmitForm(wrapper);

      const errorDiv = wrapper.find('.alert--error');
      expect(errorDiv.exists()).toBe(true);
      expect(errorDiv.text()).toBe('Invalid category value');
      wrapper.unmount();
    });

    it('should display validation translation when service throws ReportValidationError with default message', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      getMockSubmitReport().mockRejectedValueOnce(new ReportValidationError());

      await fillAndSubmitForm(wrapper);

      const errorDiv = wrapper.find('.alert--error');
      expect(errorDiv.exists()).toBe(true);
      expect(errorDiv.text()).toBe('report.error_validation');
      wrapper.unmount();
    });

    it('should have an alert role on error messages for screen readers', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      // Submit empty form to trigger validation error
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      const errorDiv = wrapper.find('.alert--error');
      expect(errorDiv.exists()).toBe(true);
      expect(errorDiv.attributes('role')).toBe('alert');
      expect(errorDiv.attributes('aria-live')).toBe('polite');
      wrapper.unmount();
    });

    it('should clear previous error state on successful re-submit', async () => {
      const wrapper = mountReportEventSuppressRenderErrors();
      await flushPromises();

      const mockSubmit = getMockSubmitReport();
      mockSubmit.mockRejectedValueOnce(new UnknownError());

      await fillAndSubmitForm(wrapper);

      // Verify error state is set
      const vm = wrapper.vm as any;
      expect(vm.state.error).toBe('report.error_generic');
      expect(vm.state.isSuccess).toBe(false);

      // Second submission succeeds
      mockSubmit.mockResolvedValueOnce(undefined);

      await wrapper.find('form').trigger('submit');
      await flushPromises();

      // Error should be cleared, success should be set
      expect(vm.state.error).toBe('');
      expect(vm.state.isSuccess).toBe(true);
      wrapper.unmount();
    });
  });

  describe('Modal Open/Close Behavior', () => {
    it('should emit close event when close button is clicked', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      await wrapper.find('.report-dialog__close').trigger('click');
      await flushPromises();

      expect(wrapper.emitted('close')).toBeTruthy();
      wrapper.unmount();
    });

    it('should emit close event when cancel button is clicked', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      // Cancel button uses design system .btn--secondary class
      const cancelButtons = wrapper.findAll('.btn--secondary');
      const cancelButton = cancelButtons.find(b => b.attributes('type') === 'button');
      expect(cancelButton).toBeTruthy();

      await cancelButton!.trigger('click');
      await flushPromises();

      expect(wrapper.emitted('close')).toBeTruthy();
      wrapper.unmount();
    });

    it('should emit close event on Escape key', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      await wrapper.find('dialog').trigger('keydown', { key: 'Escape' });
      await flushPromises();

      expect(wrapper.emitted('close')).toBeTruthy();
      wrapper.unmount();
    });

    it('should reset form fields after closing and reopening', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      // Fill in form fields
      await wrapper.find('select').setValue(ReportCategory.SPAM);
      await wrapper.find('textarea').setValue('Some description');

      // Close the modal
      await wrapper.find('.report-dialog__close').trigger('click');
      await flushPromises();

      // Re-open by calling exposed open method
      const vm = wrapper.vm as any;
      vm.open();
      await flushPromises();

      // Fields should be reset
      expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('');
      expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('');
      wrapper.unmount();
    });

    it('should remove modal-open class from body on close', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      await wrapper.find('.report-dialog__close').trigger('click');
      await flushPromises();

      expect(document.body.classList.contains('modal-open')).toBe(false);
      wrapper.unmount();
    });

    it('should have aria-modal attribute on dialog', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      const dialog = wrapper.find('dialog');
      expect(dialog.attributes('aria-modal')).toBe('true');
      wrapper.unmount();
    });

    it('should have aria-labelledby referencing the title', async () => {
      const wrapper = mountReportEvent();
      await flushPromises();

      const dialog = wrapper.find('dialog');
      const heading = wrapper.find('h2');
      expect(dialog.attributes('aria-labelledby')).toBe(heading.attributes('id'));
      wrapper.unmount();
    });
  });
});
