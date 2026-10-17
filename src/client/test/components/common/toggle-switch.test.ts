// @vitest-environment jsdom
//
// jsdom rather than the default happy-dom: under happy-dom the virtual
// screen reader does not resolve `<label for>` onto a `<button>`, so the
// switch is announced without its name even though browsers name it. See
// the environment note in src/common/test-utils/screen-reader.ts.
import { describe, it, expect, afterEach } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { mountComponent } from '@/client/test/lib/vue';
import ToggleSwitch from '@/client/components/common/toggle_switch.vue';
import { screenReader, type ScreenReaderHandle } from '@/common/test-utils/screen-reader';

const createTestRouter = (): Router => createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/', component: {} }],
});

const mountToggle = (props: Record<string, unknown>) => mountComponent(ToggleSwitch, createTestRouter(), {
  props: { label: 'Notifications', id: 'notifications-toggle', ...props },
});

describe('ToggleSwitch', () => {
  describe('screen reader announcement', () => {
    let sr: ScreenReaderHandle | undefined;

    afterEach(async () => {
      if (sr) {
        await sr.stop();
        sr = undefined;
      }
    });

    const walk = async (props: Record<string, unknown>) => {
      const wrapper = mountToggle(props);
      sr = await screenReader(wrapper.element as unknown as Node);
      return sr.walk();
    };

    it('announces a named switch in the checked state', async () => {
      const phrases = await walk({ modelValue: true });

      expect(phrases).toContain('switch, Notifications, checked, not disabled');
    });

    it('announces a named switch in the unchecked state', async () => {
      const phrases = await walk({ modelValue: false });

      expect(phrases).toContain('switch, Notifications, not checked, not disabled');
    });

    it('announces the disabled state', async () => {
      const phrases = await walk({ modelValue: false, disabled: true });

      expect(phrases).toContain('switch, Notifications, not checked, disabled');
    });

    it('never announces the control as a button', async () => {
      const phrases = await walk({ modelValue: true });

      expect(phrases.filter(phrase => phrase.startsWith('button'))).toEqual([]);
    });
  });
});
