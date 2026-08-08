import { describe, it, expect } from 'vitest';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';

import { mountComponent } from '@/client/test/lib/vue';
import AddImportSourceForm from '@/client/components/logged_in/calendar-management/import-sources/AddImportSourceForm.vue';

const routes: RouteRecordRaw[] = [
  { path: '/test', component: {}, name: 'test' },
];

const mountForm = (props: Record<string, unknown> = {}, attach = false) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });
  return mountComponent(AddImportSourceForm, router, {
    props,
    // Arrow-key navigation runs through useTabNavigation, which focuses the
    // target tab via document.getElementById — only resolvable when the
    // component is attached to a live document. Detached mounts are fine for
    // everything else. Remember to unmount() attached mounts to detach.
    ...(attach ? { attachTo: document.body } : {}),
  });
};

// happy-dom does not let us assign a real FileList, so define a stand-in on
// the input element and dispatch the change event the component listens for.
const selectFile = async (wrapper: ReturnType<typeof mountForm>, file: File) => {
  const input = wrapper.find('input[type="file"]');
  Object.defineProperty(input.element, 'files', {
    value: [file],
    configurable: true,
  });
  await input.trigger('change');
};

describe('AddImportSourceForm', () => {
  describe('tabs', () => {
    it('defaults to the URL tab with the URL field visible', () => {
      const wrapper = mountForm();

      const urlTab = wrapper.find('[role="tab"][aria-controls*="url-panel"]');
      expect(urlTab.attributes('aria-selected')).toBe('true');
      expect(wrapper.find('input[type="url"]').exists()).toBe(true);
    });

    it('exposes a tablist with two tabs', () => {
      const wrapper = mountForm();

      expect(wrapper.find('[role="tablist"]').exists()).toBe(true);
      expect(wrapper.findAll('[role="tab"]')).toHaveLength(2);
      expect(wrapper.findAll('[role="tabpanel"]')).toHaveLength(2);
    });

    it('switches to the file tab when clicked', async () => {
      const wrapper = mountForm();

      const tabs = wrapper.findAll('[role="tab"]');
      await tabs[1].trigger('click');

      expect(tabs[1].attributes('aria-selected')).toBe('true');
      expect(tabs[0].attributes('aria-selected')).toBe('false');
      // File panel is now visible, URL panel hidden.
      const filePanel = wrapper.find('[role="tabpanel"][aria-labelledby*="file-tab"]');
      expect(filePanel.attributes('hidden')).toBeUndefined();
    });

    it('preserves the URL input value across tab switches', async () => {
      const wrapper = mountForm();

      const urlInput = wrapper.find('input[type="url"]');
      await urlInput.setValue('https://example.com/keep.ics');

      const tabs = wrapper.findAll('[role="tab"]');
      await tabs[1].trigger('click'); // to file
      await tabs[0].trigger('click'); // back to url

      expect((wrapper.find('input[type="url"]').element as HTMLInputElement).value)
        .toBe('https://example.com/keep.ics');
    });

    it('moves the active tab with ArrowRight/ArrowLeft (roving tabindex)', async () => {
      // Exercises the real @keydown="handleTabKeydown" binding end-to-end.
      // The composable focuses the target tab via document.getElementById, so
      // the mount must be attached to the document; unmount to detach.
      const wrapper = mountForm({}, true);

      try {
        const tabs = wrapper.findAll('[role="tab"]');
        // Active tab has tabindex 0, the other -1.
        expect(tabs[0].attributes('tabindex')).toBe('0');
        expect(tabs[1].attributes('tabindex')).toBe('-1');

        const tablist = wrapper.find('[role="tablist"]');
        await tablist.trigger('keydown', { key: 'ArrowRight' });
        expect(tabs[1].attributes('aria-selected')).toBe('true');
        expect(tabs[1].attributes('tabindex')).toBe('0');
        expect(tabs[0].attributes('tabindex')).toBe('-1');

        await tablist.trigger('keydown', { key: 'ArrowLeft' });
        expect(tabs[0].attributes('aria-selected')).toBe('true');
      }
      finally {
        wrapper.unmount();
      }
    });
  });

  describe('URL submit', () => {
    it('emits { type: "url", url } with a trimmed URL', async () => {
      const wrapper = mountForm();

      await wrapper.find('input[type="url"]').setValue('  https://example.com/a.ics  ');
      await wrapper.find('form.add-import-source-form').trigger('submit.prevent');

      const emitted = wrapper.emitted('submit');
      expect(emitted).toBeTruthy();
      expect(emitted?.[0]?.[0]).toEqual({ type: 'url', url: 'https://example.com/a.ics' });
    });

    it('shows a validation error and does not emit for a whitespace-only URL', async () => {
      const wrapper = mountForm();

      await wrapper.find('input[type="url"]').setValue('   ');
      await wrapper.find('form.add-import-source-form').trigger('submit.prevent');

      expect(wrapper.emitted('submit')).toBeUndefined();
      expect(wrapper.find('.form-group__error').exists()).toBe(true);
    });
  });

  describe('file submit', () => {
    it('shows the selected filename and size after choosing a file', async () => {
      const wrapper = mountForm();
      await wrapper.findAll('[role="tab"]')[1].trigger('click');

      const file = new File(['BEGIN:VCALENDAR\nEND:VCALENDAR'], 'events.ics', {
        type: 'text/calendar',
      });
      await selectFile(wrapper, file);

      const summary = wrapper.find('.add-import-source-form__file-summary');
      expect(summary.exists()).toBe(true);
      expect(summary.text()).toContain('events.ics');
    });

    it('emits { type: "file", file } for a valid .ics file', async () => {
      const wrapper = mountForm();
      await wrapper.findAll('[role="tab"]')[1].trigger('click');

      const file = new File(['BEGIN:VCALENDAR\nEND:VCALENDAR'], 'events.ics', {
        type: 'text/calendar',
      });
      await selectFile(wrapper, file);
      await wrapper.find('form.add-import-source-form').trigger('submit.prevent');

      const emitted = wrapper.emitted('submit');
      expect(emitted).toBeTruthy();
      const payload = emitted?.[0]?.[0] as { type: string; file: File };
      expect(payload.type).toBe('file');
      expect(payload.file).toBeInstanceOf(File);
      expect(payload.file.name).toBe('events.ics');
      expect(payload.file.type).toBe('text/calendar');
    });

    it('accepts a file by .ics extension even without a calendar MIME type', async () => {
      const wrapper = mountForm();
      await wrapper.findAll('[role="tab"]')[1].trigger('click');

      const file = new File(['x'], 'calendar.ics', { type: '' });
      await selectFile(wrapper, file);

      expect(wrapper.find('.form-group__error').exists()).toBe(false);
    });

    it('rejects an oversized file and does not emit', async () => {
      const wrapper = mountForm();
      await wrapper.findAll('[role="tab"]')[1].trigger('click');

      const file = new File(['x'], 'big.ics', { type: 'text/calendar' });
      Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024, configurable: true });
      await selectFile(wrapper, file);

      expect(wrapper.find('.form-group__error').exists()).toBe(true);

      await wrapper.find('form.add-import-source-form').trigger('submit.prevent');
      expect(wrapper.emitted('submit')).toBeUndefined();
    });

    it('rejects a non-calendar file type', async () => {
      const wrapper = mountForm();
      await wrapper.findAll('[role="tab"]')[1].trigger('click');

      const file = new File(['x'], 'photo.png', { type: 'image/png' });
      await selectFile(wrapper, file);

      expect(wrapper.find('.form-group__error').exists()).toBe(true);
    });

    it('shows the required error and does not emit when submitting the file tab with no file', async () => {
      const wrapper = mountForm();
      await wrapper.findAll('[role="tab"]')[1].trigger('click');

      // Submit the file tab without ever choosing a file.
      await wrapper.find('form.add-import-source-form').trigger('submit.prevent');

      expect(wrapper.find('.form-group__error').exists()).toBe(true);
      expect(wrapper.emitted('submit')).toBeUndefined();
    });

    it('clears the selection when Remove is clicked', async () => {
      const wrapper = mountForm();
      await wrapper.findAll('[role="tab"]')[1].trigger('click');

      const file = new File(['BEGIN:VCALENDAR'], 'events.ics', { type: 'text/calendar' });
      await selectFile(wrapper, file);
      expect(wrapper.find('.add-import-source-form__file-summary').exists()).toBe(true);

      await wrapper.find('.add-import-source-form__file-summary .btn-ghost--danger').trigger('click');

      expect(wrapper.find('.add-import-source-form__file-summary').exists()).toBe(false);
      // Submitting an empty file tab surfaces the required error, no emit.
      await wrapper.find('form.add-import-source-form').trigger('submit.prevent');
      expect(wrapper.find('.form-group__error').exists()).toBe(true);
      expect(wrapper.emitted('submit')).toBeUndefined();
    });
  });
});
