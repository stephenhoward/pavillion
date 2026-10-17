import { describe, it, expect, afterEach } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { mountComponent } from '@/client/test/lib/vue';
import ToggleChip from '@/client/components/common/toggle-chip.vue';
import { screenReader, type ScreenReaderHandle } from '@/common/test-utils/screen-reader';

const createTestRouter = (): Router => createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/', component: {} }],
});

const mountChip = (props: Record<string, unknown>) => mountComponent(ToggleChip, createTestRouter(), {
  props: { label: 'Music', ...props },
});

describe('ToggleChip', () => {
  describe('screen reader announcement', () => {
    let sr: ScreenReaderHandle | undefined;

    afterEach(async () => {
      if (sr) {
        await sr.stop();
        sr = undefined;
      }
    });

    const walk = async (props: Record<string, unknown>) => {
      const wrapper = mountChip(props);
      sr = await screenReader(wrapper.element as unknown as Node);
      return sr.walk();
    };

    it('announces a named switch when selected', async () => {
      const phrases = await walk({ modelValue: true });

      expect(phrases).toContain('switch, Music, checked');
    });

    it('announces a named switch when not selected', async () => {
      const phrases = await walk({ modelValue: false });

      expect(phrases).toContain('switch, Music, not checked');
    });

    it('announces the disabled state', async () => {
      const phrases = await walk({ modelValue: false, disabled: true });

      expect(phrases).toContain('switch, Music, not checked, disabled');
    });

    it('never announces the chip as a button', async () => {
      const phrases = await walk({ modelValue: true });

      expect(phrases.filter(phrase => phrase.startsWith('button'))).toEqual([]);
    });
  });
});
