/**
 * Tests for the client-app EventImage preview.
 *
 * This is the owner-facing preview of an uploaded image, never a public
 * surface. Validates:
 * - The preview image is decorative: alt="" with no presentation role.
 * - The uploaded file's name never reaches the DOM, as alt text or as a
 *   visible caption.
 * - The load-error message still renders when the image fails.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';

// Mock fetch globally so the component can load images
const mockBlobUrl = 'blob:http://localhost/mock-image';
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  blob: () => Promise.resolve(new Blob(['fake-image'], { type: 'image/png' })),
});
global.URL.createObjectURL = vi.fn().mockReturnValue(mockBlobUrl);
global.URL.revokeObjectURL = vi.fn();

import EventImage from '@/client/components/common/media/event-image.vue';

const media = {
  id: 'media-1',
  originalFilename: 'DSC_0042.jpg',
};

beforeAll(async () => {
  const bundle = {
    display: {
      processing_image: 'Processing image...',
      image_load_error: 'Image could not be loaded',
    },
  };
  if (!i18next.isInitialized) {
    await i18next.init({ lng: 'en', resources: { en: { media: bundle } } });
  }
  else {
    i18next.addResourceBundle('en', 'media', bundle, true, true);
  }
});

async function mountPreview() {
  const wrapper = mount(EventImage, {
    global: { plugins: [[I18NextVue, { i18next }]] },
    props: { media },
  });
  await flushPromises();
  return wrapper;
}

describe('client EventImage preview', () => {
  it('renders the preview image as decorative', async () => {
    const wrapper = await mountPreview();

    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('alt')).toBe('');
    wrapper.unmount();
  });

  it('adds no presentation role alongside the empty alt', async () => {
    // alt="" is the entire decorative contract.
    const wrapper = await mountPreview();

    const img = wrapper.find('img');
    expect(img.attributes('role')).toBeUndefined();
    expect(img.attributes('aria-hidden')).toBeUndefined();
    wrapper.unmount();
  });

  it('never shows the uploaded file name', async () => {
    const wrapper = await mountPreview();

    expect(wrapper.html()).not.toContain('DSC_0042.jpg');
    expect(wrapper.find('.image-caption').exists()).toBe(false);
    wrapper.unmount();
  });

  it('still reports a load error', async () => {
    const wrapper = await mountPreview();

    await wrapper.find('img').trigger('error');
    await flushPromises();

    const error = wrapper.find('.error-message');
    expect(error.exists()).toBe(true);
    expect(error.text()).toBe('Image could not be loaded');
    wrapper.unmount();
  });
});
