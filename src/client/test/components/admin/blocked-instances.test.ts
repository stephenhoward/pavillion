import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import sinon from 'sinon';
import BlockedInstances from '@/client/components/admin/blocked-instances.vue';
import { useModerationStore } from '@/client/stores/moderation-store';
import { BlockedInstance } from '@/common/model/blocked_instance';

// Mock i18next-vue
vi.mock('i18next-vue', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, any>) => {
      if (params) {
        return `${key}:${JSON.stringify(params)}`;
      }
      return key;
    },
  }),
}));

describe('BlockedInstances', () => {
  let wrapper: VueWrapper;
  let sandbox: sinon.SinonSandbox;
  let moderationStore: ReturnType<typeof useModerationStore>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    const pinia = createPinia();

    wrapper = mount(BlockedInstances, {
      global: {
        plugins: [pinia],
        stubs: {
          LoadingMessage: {
            template: '<div class="loading-stub">{{ description }}</div>',
            props: ['description'],
          },
        },
      },
    });

    moderationStore = useModerationStore();
  });

  afterEach(() => {
    wrapper.unmount();
    sandbox.restore();
  });

  it('should render the page title and subtitle', () => {
    expect(wrapper.find('h1').text()).toBe('blocked_instances.title');
    expect(wrapper.find('.page-subtitle').text()).toBe('blocked_instances.subtitle');
  });

  it('should show loading state when fetching blocked instances', async () => {
    moderationStore.loadingBlockedInstances = true;

    await wrapper.vm.$nextTick();

    expect(wrapper.find('.loading-stub').exists()).toBe(true);
    expect(wrapper.find('.loading-stub').text()).toBe('blocked_instances.loading');
  });

  it('should show error state when loading fails', async () => {
    moderationStore.loadingBlockedInstances = false;
    moderationStore.blockingError = 'Network error';

    await wrapper.vm.$nextTick();

    expect(wrapper.find('.error-message').exists()).toBe(true);
    expect(wrapper.find('.error-message').text()).toContain('blocked_instances.load_error');
  });

  it('should render the block form', async () => {
    moderationStore.loadingBlockedInstances = false;

    await wrapper.vm.$nextTick();

    expect(wrapper.find('#domain-input').exists()).toBe(true);
    expect(wrapper.find('#reason-input').exists()).toBe(true);
    expect(wrapper.find('.block-button').exists()).toBe(true);
  });

  it('should validate domain input', async () => {
    moderationStore.loadingBlockedInstances = false;

    await wrapper.vm.$nextTick();

    const form = wrapper.find('.block-form');
    await form.trigger('submit');

    await wrapper.vm.$nextTick();

    expect(wrapper.find('#domain-error').exists()).toBe(true);
    expect(wrapper.find('#domain-error').text()).toBe('blocked_instances.error.domain_required');
  });

  it('should validate domain format', async () => {
    moderationStore.loadingBlockedInstances = false;

    await wrapper.vm.$nextTick();

    const domainInput = wrapper.find('#domain-input');
    await domainInput.setValue('invalid-domain');

    const form = wrapper.find('.block-form');
    await form.trigger('submit');

    await wrapper.vm.$nextTick();

    expect(wrapper.find('#domain-error').exists()).toBe(true);
    expect(wrapper.find('#domain-error').text()).toBe('blocked_instances.error.domain_invalid');
  });

  it('should validate reason input', async () => {
    moderationStore.loadingBlockedInstances = false;

    await wrapper.vm.$nextTick();

    const domainInput = wrapper.find('#domain-input');
    await domainInput.setValue('example.com');

    const form = wrapper.find('.block-form');
    await form.trigger('submit');

    await wrapper.vm.$nextTick();

    expect(wrapper.find('#reason-error').exists()).toBe(true);
    expect(wrapper.find('#reason-error').text()).toBe('blocked_instances.error.reason_required');
  });

  it('should call blockInstance when form is valid', async () => {
    moderationStore.loadingBlockedInstances = false;
    const blockInstanceStub = sandbox.stub(moderationStore, 'blockInstance').resolves();

    await wrapper.vm.$nextTick();

    const domainInput = wrapper.find('#domain-input');
    await domainInput.setValue('example.com');

    const reasonInput = wrapper.find('#reason-input');
    await reasonInput.setValue('Spam and abuse');

    const form = wrapper.find('.block-form');
    await form.trigger('submit');

    await wrapper.vm.$nextTick();

    expect(blockInstanceStub.calledOnce).toBe(true);
    expect(blockInstanceStub.calledWith('example.com', 'Spam and abuse')).toBe(true);
  });

  it('should display empty state when no instances are blocked', async () => {
    moderationStore.loadingBlockedInstances = false;
    moderationStore.blockedInstances = [];

    await wrapper.vm.$nextTick();

    expect(wrapper.find('.empty-state').exists()).toBe(true);
    expect(wrapper.find('.empty-state').text()).toContain('blocked_instances.list.empty');
  });

  it('should display blocked instances in a table', async () => {
    moderationStore.loadingBlockedInstances = false;

    const instance1 = new BlockedInstance('id1');
    instance1.domain = 'bad-instance.com';
    instance1.reason = 'Spam';
    instance1.blockedAt = new Date('2024-01-15');
    instance1.blockedBy = 'admin-id';

    const instance2 = new BlockedInstance('id2');
    instance2.domain = 'another-bad.com';
    instance2.reason = 'Policy violations';
    instance2.blockedAt = new Date('2024-01-20');
    instance2.blockedBy = 'admin-id';

    moderationStore.blockedInstances = [instance1, instance2];

    await wrapper.vm.$nextTick();

    expect(wrapper.find('.blocked-table').exists()).toBe(true);

    const rows = wrapper.findAll('tbody tr');
    expect(rows).toHaveLength(2);

    expect(rows[0].find('.domain-cell').text()).toBe('bad-instance.com');
    expect(rows[0].find('.reason-cell').text()).toBe('Spam');

    expect(rows[1].find('.domain-cell').text()).toBe('another-bad.com');
    expect(rows[1].find('.reason-cell').text()).toBe('Policy violations');
  });

  it('should show unblock confirmation modal', async () => {
    moderationStore.loadingBlockedInstances = false;

    const instance = new BlockedInstance('id1');
    instance.domain = 'bad-instance.com';
    instance.reason = 'Spam';
    instance.blockedAt = new Date();
    instance.blockedBy = 'admin-id';

    moderationStore.blockedInstances = [instance];

    await wrapper.vm.$nextTick();

    const unblockButton = wrapper.find('.unblock-button');
    await unblockButton.trigger('click');

    await wrapper.vm.$nextTick();

    expect(wrapper.find('.modal-overlay').exists()).toBe(true);
    expect(wrapper.find('.modal').exists()).toBe(true);
    expect(wrapper.find('#confirm-title').text()).toBe('blocked_instances.confirm.title');
  });

  it('should call unblockInstance when confirmation is accepted', async () => {
    moderationStore.loadingBlockedInstances = false;
    const unblockInstanceStub = sandbox.stub(moderationStore, 'unblockInstance').resolves();

    const instance = new BlockedInstance('id1');
    instance.domain = 'bad-instance.com';
    instance.reason = 'Spam';
    instance.blockedAt = new Date();
    instance.blockedBy = 'admin-id';

    moderationStore.blockedInstances = [instance];

    await wrapper.vm.$nextTick();

    const unblockButton = wrapper.find('.unblock-button');
    await unblockButton.trigger('click');

    await wrapper.vm.$nextTick();

    const confirmButton = wrapper.find('.confirm-button');
    await confirmButton.trigger('click');

    await wrapper.vm.$nextTick();

    expect(unblockInstanceStub.calledOnce).toBe(true);
    expect(unblockInstanceStub.calledWith('bad-instance.com')).toBe(true);
  });

  it('should cancel unblock when cancel button is clicked', async () => {
    moderationStore.loadingBlockedInstances = false;

    const instance = new BlockedInstance('id1');
    instance.domain = 'bad-instance.com';
    instance.reason = 'Spam';
    instance.blockedAt = new Date();
    instance.blockedBy = 'admin-id';

    moderationStore.blockedInstances = [instance];

    await wrapper.vm.$nextTick();

    const unblockButton = wrapper.find('.unblock-button');
    await unblockButton.trigger('click');

    await wrapper.vm.$nextTick();

    expect(wrapper.find('.modal-overlay').exists()).toBe(true);

    const cancelButton = wrapper.find('.cancel-button');
    await cancelButton.trigger('click');

    await wrapper.vm.$nextTick();

    expect(wrapper.find('.modal-overlay').exists()).toBe(false);
  });

  it('should display success message after blocking an instance', async () => {
    moderationStore.loadingBlockedInstances = false;
    sandbox.stub(moderationStore, 'blockInstance').resolves();

    await wrapper.vm.$nextTick();

    const domainInput = wrapper.find('#domain-input');
    await domainInput.setValue('example.com');

    const reasonInput = wrapper.find('#reason-input');
    await reasonInput.setValue('Bad behavior');

    const form = wrapper.find('.block-form');
    await form.trigger('submit');

    await wrapper.vm.$nextTick();

    expect(wrapper.find('.message-success').exists()).toBe(true);
  });

  it('should display error message when blocking fails', async () => {
    moderationStore.loadingBlockedInstances = false;
    sandbox.stub(moderationStore, 'blockInstance').rejects(new Error('API Error'));
    moderationStore.blockingError = 'Failed to block instance';

    await wrapper.vm.$nextTick();

    const domainInput = wrapper.find('#domain-input');
    await domainInput.setValue('example.com');

    const reasonInput = wrapper.find('#reason-input');
    await reasonInput.setValue('Bad behavior');

    const form = wrapper.find('.block-form');
    await form.trigger('submit');

    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.message-error').exists()).toBe(true);
  });

  it('should clear form after successful block', async () => {
    moderationStore.loadingBlockedInstances = false;
    sandbox.stub(moderationStore, 'blockInstance').resolves();

    await wrapper.vm.$nextTick();

    const domainInput = wrapper.find('#domain-input');
    await domainInput.setValue('example.com');

    const reasonInput = wrapper.find('#reason-input');
    await reasonInput.setValue('Bad behavior');

    const form = wrapper.find('.block-form');
    await form.trigger('submit');

    await wrapper.vm.$nextTick();

    expect((domainInput.element as HTMLInputElement).value).toBe('');
    expect((reasonInput.element as HTMLTextAreaElement).value).toBe('');
  });
});
