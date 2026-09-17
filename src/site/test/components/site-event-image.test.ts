/**
 * Tests for the EventImage component.
 *
 * Validates:
 * - Default focal point and zoom produce centered object-position.
 * - Custom focalPointX/focalPointY compute correct object-position.
 * - Zoom > 1 applies transform: scale and transform-origin.
 * - Zoom <= 1 does not apply transform.
 * - Component renders nothing when media is null.
 * - alt renders the supplied alt text, and alt="" when none is supplied.
 * - A media filename is never emitted as alt text.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

// Mock fetch globally so the component can load images
const mockBlobUrl = 'blob:http://localhost/mock-image';
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  blob: () => Promise.resolve(new Blob(['fake-image'], { type: 'image/png' })),
});
global.URL.createObjectURL = vi.fn().mockReturnValue(mockBlobUrl);
global.URL.revokeObjectURL = vi.fn();

import EventImage from '@/site/components/event-image.vue';

describe('EventImage', () => {
  const defaultMedia = { id: 'test-media-id', originalFilename: 'photo.jpg' };

  const mountComponent = async (props: Record<string, unknown> = {}) => {
    const wrapper = mount(EventImage, {
      props: {
        media: defaultMedia,
        context: 'hero' as const,
        ...props,
      },
    });
    await flushPromises();
    return wrapper;
  };

  it('should not render when media is null', () => {
    const wrapper = mount(EventImage, {
      props: { media: null },
    });
    expect(wrapper.find('.event-image').exists()).toBe(false);
  });

  it('should apply default centered object-position when no focal point props given', async () => {
    const wrapper = await mountComponent();
    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('style')).toContain('object-position: 50% 50%');
  });

  it('should compute object-position from custom focal point values', async () => {
    const wrapper = await mountComponent({
      focalPointX: 0.25,
      focalPointY: 0.75,
    });
    const img = wrapper.find('img');
    expect(img.attributes('style')).toContain('object-position: 25% 75%');
  });

  it('should not apply transform when zoom is default (1.0)', async () => {
    const wrapper = await mountComponent();
    const img = wrapper.find('img');
    const style = img.attributes('style') || '';
    expect(style).not.toContain('transform:');
  });

  it('should apply transform: scale when zoom > 1', async () => {
    const wrapper = await mountComponent({ zoom: 1.5 });
    const img = wrapper.find('img');
    const style = img.attributes('style') || '';
    expect(style).toContain('transform: scale(1.5)');
    expect(style).toContain('transform-origin: 50% 50%');
  });

  it('should apply transform-origin matching custom focal point when zoomed', async () => {
    const wrapper = await mountComponent({
      focalPointX: 0.3,
      focalPointY: 0.8,
      zoom: 2.0,
    });
    const img = wrapper.find('img');
    const style = img.attributes('style') || '';
    expect(style).toContain('transform: scale(2)');
    expect(style).toContain('transform-origin: 30% 80%');
  });

  it('should not apply transform when zoom is exactly 1', async () => {
    const wrapper = await mountComponent({ zoom: 1.0 });
    const img = wrapper.find('img');
    const style = img.attributes('style') || '';
    expect(style).not.toContain('transform:');
  });

  it('should set --image-zoom custom property when zoom > 1', async () => {
    const wrapper = await mountComponent({ zoom: 1.5 });
    const img = wrapper.find('img');
    const style = img.attributes('style') || '';
    expect(style).toContain('--image-zoom: 1.5');
  });

  it('should render the supplied alt text', async () => {
    const wrapper = await mountComponent({ alt: 'A crowd dancing at dusk' });
    const img = wrapper.find('img');
    expect(img.attributes('alt')).toBe('A crowd dancing at dusk');
  });

  it('should render an empty alt when no alt is supplied', async () => {
    const wrapper = await mountComponent();
    const img = wrapper.find('img');
    expect(img.attributes('alt')).toBe('');
  });

  it('should render an empty alt when the supplied alt is empty', async () => {
    const wrapper = await mountComponent({ alt: '' });
    const img = wrapper.find('img');
    expect(img.attributes('alt')).toBe('');
  });

  it('should never fall back to the media filename for alt text', async () => {
    // defaultMedia carries originalFilename; a filename describes the file,
    // not the picture, and must never reach a screen reader.
    const wrapper = await mountComponent();
    const img = wrapper.find('img');
    expect(img.attributes('alt')).toBe('');
    expect(img.attributes('alt')).not.toContain('photo.jpg');
  });

  it('should not add presentation roles alongside an empty alt', async () => {
    // alt="" is the entire decorative contract.
    const wrapper = await mountComponent();
    const img = wrapper.find('img');
    expect(img.attributes('role')).toBeUndefined();
    expect(img.attributes('aria-hidden')).toBeUndefined();
  });
});
