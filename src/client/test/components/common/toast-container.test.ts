import { describe, it, expect, beforeEach } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import ToastContainer from '@/client/components/common/toast-container.vue';
import { useToast } from '@/client/composables/useToast';
import { mountComponent } from '@/client/test/lib/vue';
import enSystem from '@/client/locales/en/system.json';
import esSystem from '@/client/locales/es/system.json';
import frSystem from '@/client/locales/fr/system.json';

describe('ToastContainer dismiss button', () => {
  beforeEach(() => {
    const { toasts } = useToast();
    toasts.value = [];
  });

  it('labels the dismiss button with the translated string', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: {} }],
    });
    const wrapper = mountComponent(ToastContainer, router);
    useToast().success('Saved');
    await wrapper.vm.$nextTick();

    const button = wrapper.find('button.alert__close');
    expect(button.exists()).toBe(true);
    expect(button.attributes('aria-label')).toBe(enSystem.toast.dismiss);
  });

  it('ships a distinct translation in every client language', () => {
    expect(esSystem.toast.dismiss).not.toBe(enSystem.toast.dismiss);
    expect(frSystem.toast.dismiss).not.toBe(enSystem.toast.dismiss);
  });
});
