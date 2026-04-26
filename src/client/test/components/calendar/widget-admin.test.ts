import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import sinon from 'sinon';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import axios from 'axios';
import WidgetDomains from '@/client/components/logged_in/calendar-management/widget-domains.vue';
import WidgetConfig from '@/client/components/logged_in/calendar-management/widget-config.vue';
import WidgetEmbed from '@/client/components/logged_in/calendar-management/widget-embed.vue';
import WidgetTab from '@/client/components/logged_in/calendar-management/widget-tab.vue';

describe('Widget Admin UI Components', () => {
  let sandbox: sinon.SinonSandbox;
  let axiosGetStub: sinon.SinonStub;
  let axiosPostStub: sinon.SinonStub;
  let axiosPutStub: sinon.SinonStub;
  let axiosDeleteStub: sinon.SinonStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    axiosGetStub = sandbox.stub(axios, 'get');
    axiosPostStub = sandbox.stub(axios, 'post');
    axiosPutStub = sandbox.stub(axios, 'put');
    axiosDeleteStub = sandbox.stub(axios, 'delete');

    // Initialize i18next for testing
    await i18next.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: {
          calendars: {
            widget: {
              domains_section_title: 'Allowed Domains',
              domains_section_intro: 'Manage allowed domains',
              config_section_title: 'Configuration',
              config_section_intro: 'Customize widget',
              embed_section_title: 'Embed Code',
              embed_section_intro: 'Copy this code',
              domains: {
                loading: 'Loading...',
                localhost_notice: 'Localhost is automatically allowed',
                add_domain_label: 'Add Domain',
                add_domain_help: 'Enter domain without protocol',
                add_button: 'Add',
                adding: 'Adding...',
                allowed_domains_title: 'Allowed Domains',
                current_domain_title: 'Current Domain',
                no_domains: 'No domains yet',
                remove_button: 'Remove',
                change_button: 'Change',
                removing: 'Removing...',
                confirm_remove: 'Remove {{domain}}?',
                add_success: 'Added successfully',
                remove_success: 'Removed successfully',
                error_loading: 'Failed to load',
                error_adding: 'Failed to add',
                error_removing: 'Failed to remove',
                error_invalid_domain: 'Invalid domain format',
                error_duplicate: 'Domain already exists',
              },
              config: {
                configuration_title: 'Configuration',
                configuration_description: 'Customize widget',
                view_mode_label: 'View Mode',
                view_mode_help: 'Choose view mode',
                view_mode_list: 'List View',
                view_mode_list_title: 'List View',
                view_mode_list_description: 'Vertical list',
                view_mode_week: 'Week View',
                view_mode_week_title: 'Week View',
                view_mode_week_description: 'Weekly grid',
                view_mode_month: 'Month View',
                view_mode_month_title: 'Month View',
                view_mode_month_description: 'Monthly grid',
                accent_color_label: 'Accent Color',
                accent_color_help: 'Choose color',
                color_mode_label: 'Color Mode',
                color_mode_help: 'Choose color mode',
                color_mode_auto: 'Auto',
                color_mode_light: 'Light',
                color_mode_dark: 'Dark',
                preview_title: 'Preview',
                preview_description: 'Widget preview',
                save_button: 'Save Configuration',
                saving: 'Saving...',
                save_success: 'Widget configuration saved.',
                save_error: 'Failed to save widget configuration.',
                save_validation_error: 'Please correct the errors below and try again.',
                error_loading: 'Failed to load widget configuration.',
              },
              embed: {
                title: 'Embed Code',
                description: 'Copy and paste this code',
                copy_button: 'Copy',
                copied: 'Copied!',
                copy_success: 'Copied to clipboard',
                copy_error: 'Failed to copy',
              },
            },
          },
        },
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('WidgetDomains Component', () => {
    it('should load and display allowed domains', async () => {
      // API now returns a single domain object, not an array
      const mockDomain = { domain: 'example.com' };

      axiosGetStub.resolves({ data: mockDomain });

      const wrapper = mount(WidgetDomains, {
        props: {
          calendarId: 'test-calendar-id',
        },
        global: {
          plugins: [[I18NextVue, { i18next }]],
        },
      });

      // Wait for async loading
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(axiosGetStub.calledOnce).toBe(true);
      expect(wrapper.html()).toContain('example.com');
    });

    it('should add valid domain to allowlist', async () => {
      const mockNewDomain = { domain: 'newsite.com' };
      axiosGetStub.resolves({ data: { domain: null } }); // No domain initially
      axiosPutStub.resolves({ data: mockNewDomain });

      const wrapper = mount(WidgetDomains, {
        props: {
          calendarId: 'test-calendar-id',
        },
        global: {
          plugins: [[I18NextVue, { i18next }]],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      const input = wrapper.find('input[type="text"]');
      const addButton = wrapper.find('button.update-button');

      await input.setValue('newsite.com');
      await addButton.trigger('click');
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(axiosPutStub.calledOnce).toBe(true);
      const callArgs = axiosPutStub.getCall(0).args;
      expect(callArgs[1]).toEqual({ domain: 'newsite.com' });
    });
  });

  describe('WidgetConfig Component', () => {
    // Default stub: component calls GET /api/v1/calendars/:id/widget/config on mount.
    // Individual tests can override via axiosGetStub.resolves(...) before mount when needed.
    const defaultConfig = { view: 'list', accentColor: '#ff9131', colorMode: 'auto' };

    it('should display configuration options', async () => {
      axiosGetStub.resolves({ data: defaultConfig });
      const wrapper = mount(WidgetConfig, {
        props: {
          calendarId: 'test-calendar-id',
          calendarUrlName: 'my-calendar',
        },
        global: {
          plugins: [[I18NextVue, { i18next }]],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Check for view mode selector (card buttons, not select dropdown)
      const viewModeCards = wrapper.findAll('button.view-mode-card');
      expect(viewModeCards.length).toBe(3); // list, week, month

      // Check for accent color input
      const colorInput = wrapper.find('input[type="color"]');
      expect(colorInput.exists()).toBe(true);

      // Check for color mode selector (select dropdown)
      const colorModeSelect = wrapper.find('select#colorMode');
      expect(colorModeSelect.exists()).toBe(true);
      const colorModeOptions = colorModeSelect.findAll('option');
      expect(colorModeOptions.length).toBe(3); // auto, light, dark
    });

    it('should update configuration state when options change', async () => {
      axiosGetStub.resolves({ data: defaultConfig });
      const wrapper = mount(WidgetConfig, {
        props: {
          calendarId: 'test-calendar-id',
          calendarUrlName: 'my-calendar',
        },
        global: {
          plugins: [[I18NextVue, { i18next }]],
        },
      });
      await new Promise(resolve => setTimeout(resolve, 50));

      // Change view mode by clicking the week card button
      const weekCard = wrapper.findAll('button.view-mode-card')[1]; // list=0, week=1, month=2
      await weekCard.trigger('click');

      // Change accent color
      const colorInput = wrapper.find('input[type="color"]');
      await colorInput.setValue('#ff0000');

      // Verify state updates via exposed state
      const vm = wrapper.vm as any;
      expect(vm.state.viewMode).toBe('week');
      expect(vm.state.accentColor).toBe('#ff0000');
    });

    it('should display preview iframe with current configuration', async () => {
      axiosGetStub.resolves({ data: defaultConfig });
      const wrapper = mount(WidgetConfig, {
        props: {
          calendarId: 'test-calendar-id',
          calendarUrlName: 'my-calendar',
        },
        global: {
          plugins: [[I18NextVue, { i18next }]],
        },
      });
      await new Promise(resolve => setTimeout(resolve, 50));

      const iframe = wrapper.find('iframe.widget-preview');
      expect(iframe.exists()).toBe(true);

      const iframeSrc = iframe.attributes('src');
      expect(iframeSrc).toContain('/widget/my-calendar');
      expect(iframeSrc).toContain('view=list'); // default
      expect(iframeSrc).toContain('colorMode=auto'); // default
    });

    it('should load config on mount and populate form state', async () => {
      const storedConfig = { view: 'month', accentColor: '#00ff00', colorMode: 'dark' };
      axiosGetStub.resolves({ data: storedConfig });

      const wrapper = mount(WidgetConfig, {
        props: {
          calendarId: 'test-calendar-id',
          calendarUrlName: 'my-calendar',
        },
        global: {
          plugins: [[I18NextVue, { i18next }]],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify GET was called with the correct URL
      expect(axiosGetStub.calledOnce).toBe(true);
      expect(axiosGetStub.getCall(0).args[0]).toBe('/api/v1/calendars/test-calendar-id/widget/config');

      const vm = wrapper.vm as any;
      expect(vm.state.viewMode).toBe('month');
      expect(vm.state.accentColor).toBe('#00ff00');
      expect(vm.state.colorMode).toBe('dark');
    });

    it('should disable Save button when clean and enable after edit', async () => {
      axiosGetStub.resolves({ data: defaultConfig });

      const wrapper = mount(WidgetConfig, {
        props: {
          calendarId: 'test-calendar-id',
          calendarUrlName: 'my-calendar',
        },
        global: {
          plugins: [[I18NextVue, { i18next }]],
        },
      });
      await new Promise(resolve => setTimeout(resolve, 50));

      const saveButton = wrapper.find('button.save-button');
      expect(saveButton.exists()).toBe(true);
      // Clean state → disabled
      expect(saveButton.attributes('disabled')).toBeDefined();

      // Change a field
      const weekCard = wrapper.findAll('button.view-mode-card')[1];
      await weekCard.trigger('click');

      // Dirty state → enabled
      expect(saveButton.attributes('disabled')).toBeUndefined();
    });

    it('should PUT current state on Save and show success message, then disable Save again', async () => {
      axiosGetStub.resolves({ data: defaultConfig });
      const savedConfig = { view: 'week', accentColor: '#ff9131', colorMode: 'auto' };
      axiosPutStub.resolves({ data: savedConfig });

      const wrapper = mount(WidgetConfig, {
        props: {
          calendarId: 'test-calendar-id',
          calendarUrlName: 'my-calendar',
        },
        global: {
          plugins: [[I18NextVue, { i18next }]],
        },
      });
      await new Promise(resolve => setTimeout(resolve, 50));

      // Change view to week
      const weekCard = wrapper.findAll('button.view-mode-card')[1];
      await weekCard.trigger('click');

      const saveButton = wrapper.find('button.save-button');
      await saveButton.trigger('click');
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(axiosPutStub.calledOnce).toBe(true);
      const [url, body] = axiosPutStub.getCall(0).args;
      expect(url).toBe('/api/v1/calendars/test-calendar-id/widget/config');
      expect(body).toEqual({ view: 'week', accentColor: '#ff9131', colorMode: 'auto' });

      // Success alert rendered
      expect(wrapper.html()).toContain('Widget configuration saved.');
      // Save disabled again (clean snapshot)
      expect(saveButton.attributes('disabled')).toBeDefined();
    });

    it('should render field-level error from 400 fields.accentColor next to the accent-color input', async () => {
      axiosGetStub.resolves({ data: defaultConfig });
      const error: any = new Error('Validation failed');
      error.response = {
        status: 400,
        data: {
          error: 'Validation failed',
          errorName: 'ValidationError',
          fields: { accentColor: 'Invalid hex' },
        },
      };
      axiosPutStub.rejects(error);

      const wrapper = mount(WidgetConfig, {
        props: {
          calendarId: 'test-calendar-id',
          calendarUrlName: 'my-calendar',
        },
        global: {
          plugins: [[I18NextVue, { i18next }]],
        },
      });
      await new Promise(resolve => setTimeout(resolve, 50));

      // Dirty the form so Save is enabled
      const weekCard = wrapper.findAll('button.view-mode-card')[1];
      await weekCard.trigger('click');

      await wrapper.find('button.save-button').trigger('click');
      await new Promise(resolve => setTimeout(resolve, 50));

      // Inline error text rendered
      const errorEl = wrapper.find('#accentColor-error');
      expect(errorEl.exists()).toBe(true);
      expect(errorEl.text()).toBe('Invalid hex');

      // Input associated via aria-describedby (a11y)
      const colorInput = wrapper.find('input#accentColor');
      expect(colorInput.attributes('aria-describedby')).toBe('accentColor-error');
      expect(colorInput.attributes('aria-invalid')).toBe('true');

      // State holds the camelCase key, not snake_case
      const vm = wrapper.vm as any;
      expect(vm.state.fieldErrors.accentColor).toBe('Invalid hex');
    });

    it('should not include a Discard button (spec: reload is the escape hatch)', async () => {
      axiosGetStub.resolves({ data: defaultConfig });
      const wrapper = mount(WidgetConfig, {
        props: {
          calendarId: 'test-calendar-id',
          calendarUrlName: 'my-calendar',
        },
        global: {
          plugins: [[I18NextVue, { i18next }]],
        },
      });
      await new Promise(resolve => setTimeout(resolve, 50));

      const html = wrapper.html();
      expect(html).not.toContain('discard');
      expect(html).not.toContain('Discard');
    });
  });

  describe('WidgetEmbed Component', () => {
    it('should generate simplified embed code with only calendar and container keys', async () => {
      const wrapper = mount(WidgetEmbed, {
        props: {
          calendarUrlName: 'my-calendar',
        },
        global: {
          plugins: [[I18NextVue, { i18next }]],
        },
      });

      const codeBlock = wrapper.find('.embed-code');
      const codeText = codeBlock.text();

      // Required content
      expect(codeText).toContain('calendar');
      expect(codeText).toContain('container');
      expect(codeText).toContain('my-calendar');
      expect(codeText).toContain('#calendar-widget');
      expect(codeText).toContain('pavillion-widget.js');

      // Deprecated init keys must be absent from the snippet
      expect(codeText).not.toContain('view');
      expect(codeText).not.toContain('accentColor');
      expect(codeText).not.toContain('colorMode');
    });

    it('should copy embed code to clipboard', async () => {
      // Mock clipboard API properly
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: mockWriteText,
        },
        writable: true,
        configurable: true,
      });

      const wrapper = mount(WidgetEmbed, {
        props: {
          calendarUrlName: 'my-calendar',
        },
        global: {
          plugins: [[I18NextVue, { i18next }]],
        },
      });

      const copyButton = wrapper.find('button.copy-btn');
      await copyButton.trigger('click');

      expect(mockWriteText).toHaveBeenCalled();
      const copiedText = mockWriteText.mock.calls[0][0];
      expect(copiedText).toContain('my-calendar');
      expect(copiedText).toContain('container');
      expect(copiedText).not.toContain('view');
      expect(copiedText).not.toContain('accentColor');
      expect(copiedText).not.toContain('colorMode');
    });
  });

  describe('WidgetTab Component', () => {
    it('should render without ref-based plumbing between widget-config and widget-embed', async () => {
      // API stubs needed because WidgetDomains calls GET on mount
      axiosGetStub.resolves({ data: { domain: null } });

      const wrapper = mount(WidgetTab, {
        props: {
          calendarId: 'test-calendar-id',
          calendarUrlName: 'my-calendar',
        },
        global: {
          plugins: [[I18NextVue, { i18next }]],
        },
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // All three sections render
      const sections = wrapper.findAll('section.widget-section');
      expect(sections.length).toBe(3);

      // WidgetEmbed renders with simplified snippet (no view/accentColor/colorMode)
      const embedCode = wrapper.find('.embed-code');
      expect(embedCode.exists()).toBe(true);
      const embedText = embedCode.text();
      expect(embedText).toContain('my-calendar');
      expect(embedText).toContain('container');
      expect(embedText).not.toContain('view');
      expect(embedText).not.toContain('accentColor');
      expect(embedText).not.toContain('colorMode');
    });
  });
});
