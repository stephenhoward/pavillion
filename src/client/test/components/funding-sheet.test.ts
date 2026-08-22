import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import { initI18Next } from '@/client/service/locale';
import FundingSheet from '@/client/components/logged_in/calendar-management/funding-sheet.vue';

const FundingFormStub = {
  emits: ['plan-started'],
  template: '<button type="button" class="stub-start" @click="$emit(\'plan-started\')">Start</button>',
};

/**
 * Mirrors how FundingUpsellCard hosts the sheet: a trigger button opens it,
 * and both `close` and `plan-started` tear it down through `v-if`. The real
 * Sheet/useDialog chain runs underneath so focus restoration is exercised
 * end to end rather than stubbed away.
 */
const Host = defineComponent({
  components: { FundingSheet },
  setup() {
    const show = ref(false);
    const planStarted = vi.fn();
    return { show, planStarted };
  },
  template: `
    <button type="button" class="trigger" @click="show = true">Open</button>
    <FundingSheet
      v-if="show"
      calendarId="cal-1"
      instanceName="Test Instance"
      @close="show = false"
      @plan-started="() => { show = false; planStarted(); }"
    />
  `,
});

describe('FundingSheet', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    initI18Next();
    // happy-dom does not implement HTMLDialogElement.showModal()/close().
    // Polyfill just enough for the real Sheet/useDialog chain to run its
    // open/close lifecycle, since focus restoration lives there.
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };

    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  const openSheet = async () => {
    const wrapper = mount(Host, {
      attachTo: host,
      global: {
        plugins: [[I18NextVue, { i18next }]],
        stubs: { FundingForm: FundingFormStub },
      },
    });
    const trigger = wrapper.find('.trigger').element as HTMLButtonElement;
    trigger.focus();
    await wrapper.find('.trigger').trigger('click');
    // useDialog moves initial focus to the heading on a timer.
    vi.runAllTimers();
    expect(document.activeElement).not.toBe(trigger);
    return { wrapper, trigger };
  };

  it('restores focus to the opening element after a plan is started', async () => {
    const { wrapper, trigger } = await openSheet();

    await wrapper.find('.stub-start').trigger('click');
    await flushPromises();

    expect(wrapper.findComponent(FundingSheet).exists()).toBe(false);
    expect(wrapper.vm.planStarted).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
    wrapper.unmount();
  });

  it('restores focus when dismissed with the close button', async () => {
    const { wrapper, trigger } = await openSheet();

    await wrapper.find('.sheet-header button').trigger('click');
    await flushPromises();

    expect(wrapper.findComponent(FundingSheet).exists()).toBe(false);
    expect(wrapper.vm.planStarted).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    wrapper.unmount();
  });
});
