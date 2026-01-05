import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import sinon from 'sinon';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import axios from 'axios';
import WidgetDomains from '../widget-domains.vue';
import WidgetConfig from '../widget-config.vue';
import WidgetEmbed from '../widget-embed.vue';

describe('Widget Admin UI Components', () => {
  let sandbox: sinon.SinonSandbox;
  let axiosGetStub: sinon.SinonStub;
  let axiosPostStub: sinon.SinonStub;
  let axiosDeleteStub: sinon.SinonStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    axiosGetStub = sandbox.stub(axios, 'get');
    axiosPostStub = sandbox.stub(axios, 'post');
    axiosDeleteStub = sandbox.stub(axios, 'delete');

    // Initialize i18next for testing
    await i18next.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: {
          calendars: {
            widget: {
              domains: {
                loading: 'Loading...',
                localhost_notice: 'Localhost is automatically allowed',
                add_domain_label: 'Add Domain',
                add_domain_help: 'Enter domain without protocol',
                add_button: 'Add',
                adding: 'Adding...',
                allowed_domains_title: 'Allowed Domains',
                no_domains: 'No domains yet',
                remove_button: 'Remove',
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
                view_mode_week: 'Week View',
                view_mode_month: 'Month View',
                accent_color_label: 'Accent Color',
                accent_color_help: 'Choose color',
                color_mode_label: 'Color Mode',
                color_mode_help: 'Choose color mode',
                color_mode_auto: 'Auto',
                color_mode_light: 'Light',
                color_mode_dark: 'Dark',
                preview_title: 'Preview',
                preview_description: 'Widget preview',
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
      const mockDomains = [
        { id: '1', domain: 'example.com', createdAt: new Date().toISOString() },
        { id: '2', domain: 'test.org', createdAt: new Date().toISOString() },
      ];

      axiosGetStub.resolves({ data: mockDomains });

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
      expect(wrapper.html()).toContain('test.org');
    });

    it('should add valid domain to allowlist', async () => {
      const mockNewDomain = { id: '3', domain: 'newsite.com', createdAt: new Date().toISOString() };
      axiosGetStub.resolves({ data: [] });
      axiosPostStub.resolves({ data: mockNewDomain });

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
      const addButton = wrapper.find('button.add-domain-btn');

      await input.setValue('newsite.com');
      await addButton.trigger('click');
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(axiosPostStub.calledOnce).toBe(true);
      const callArgs = axiosPostStub.getCall(0).args;
      expect(callArgs[1]).toEqual({ domain: 'newsite.com' });
    });
  });

  describe('WidgetConfig Component', () => {
    it('should display configuration options', async () => {
      const wrapper = mount(WidgetConfig, {
        props: {
          calendarId: 'test-calendar-id',
          calendarUrlName: 'my-calendar',
        },
        global: {
          plugins: [[I18NextVue, { i18next }]],
        },
      });

      // Check for view mode selector
      const viewModeRadios = wrapper.findAll('input[name="viewMode"]');
      expect(viewModeRadios.length).toBe(3); // week, month, list

      // Check for accent color input
      const colorInput = wrapper.find('input[type="color"]');
      expect(colorInput.exists()).toBe(true);

      // Check for color mode selector
      const colorModeRadios = wrapper.findAll('input[name="colorMode"]');
      expect(colorModeRadios.length).toBe(3); // auto, light, dark
    });

    it('should update configuration state when options change', async () => {
      const wrapper = mount(WidgetConfig, {
        props: {
          calendarId: 'test-calendar-id',
          calendarUrlName: 'my-calendar',
        },
        global: {
          plugins: [[I18NextVue, { i18next }]],
        },
      });

      // Change view mode
      const weekViewRadio = wrapper.find('input[value="week"]');
      await weekViewRadio.setValue(true);

      // Change accent color
      const colorInput = wrapper.find('input[type="color"]');
      await colorInput.setValue('#ff0000');

      // Verify state updates via exposed state
      const vm = wrapper.vm as any;
      expect(vm.state.viewMode).toBe('week');
      expect(vm.state.accentColor).toBe('#ff0000');
    });

    it('should display preview iframe with current configuration', async () => {
      const wrapper = mount(WidgetConfig, {
        props: {
          calendarId: 'test-calendar-id',
          calendarUrlName: 'my-calendar',
        },
        global: {
          plugins: [[I18NextVue, { i18next }]],
        },
      });

      const iframe = wrapper.find('iframe.widget-preview');
      expect(iframe.exists()).toBe(true);

      const iframeSrc = iframe.attributes('src');
      expect(iframeSrc).toContain('/widget/my-calendar');
      expect(iframeSrc).toContain('view=list'); // default
      expect(iframeSrc).toContain('colorMode=auto'); // default
    });
  });

  describe('WidgetEmbed Component', () => {
    it('should generate correct embed code', async () => {
      const wrapper = mount(WidgetEmbed, {
        props: {
          calendarUrlName: 'my-calendar',
          viewMode: 'week',
          accentColor: '#ff9131',
          colorMode: 'auto',
        },
        global: {
          plugins: [[I18NextVue, { i18next }]],
        },
      });

      const codeBlock = wrapper.find('.embed-code');
      const codeText = codeBlock.text();

      expect(codeText).toContain('my-calendar');
      expect(codeText).toContain('week');
      expect(codeText).toContain('#ff9131');
      expect(codeText).toContain('auto');
      expect(codeText).toContain('pavillion-widget.js');
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
          viewMode: 'month',
          accentColor: '#0000ff',
          colorMode: 'light',
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
      expect(copiedText).toContain('month');
    });
  });
});
