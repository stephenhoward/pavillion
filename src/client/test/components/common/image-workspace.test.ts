import { describe, it, expect } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import ImageWorkspace from '@/client/components/common/media/image-workspace.vue';
import { mountComponent } from '@/client/test/lib/vue';

const defaultImage = {
  url: 'https://example.com/photo.jpg',
  mediaFocalPointX: 0.3,
  mediaFocalPointY: 0.7,
  mediaZoom: 1.4,
};

const mountWorkspace = (imageOverrides: Partial<typeof defaultImage> = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [],
  });

  const image = { ...defaultImage, ...imageOverrides };

  const wrapper = mountComponent(ImageWorkspace, router, {
    props: { image },
  });

  return { wrapper, image };
};

describe('ImageWorkspace', () => {

  it('renders the image at the provided url', () => {
    const { wrapper } = mountWorkspace();
    const img = wrapper.find('.workspace-image');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('https://example.com/photo.jpg');
  });

  it('positions the focal point marker at correct CSS percentages', () => {
    const { wrapper } = mountWorkspace({ mediaFocalPointX: 0.3, mediaFocalPointY: 0.7 });
    const marker = wrapper.find('.focal-point-marker');
    expect(marker.exists()).toBe(true);
    expect(marker.attributes('style')).toContain('left: 30%');
    expect(marker.attributes('style')).toContain('top: 70%');
  });

  it('reflects the mediaZoom prop value on the zoom slider', () => {
    const { wrapper } = mountWorkspace({ mediaZoom: 1.4 });
    const slider = wrapper.find('.zoom-slider');
    expect(slider.exists()).toBe(true);
    expect((slider.element as HTMLInputElement).value).toBe('1.4');
  });

  it('emits replace when the Replace button is clicked', async () => {
    const { wrapper } = mountWorkspace();
    const replaceBtn = wrapper.findAll('button').find(
      (btn) => btn.text().includes('Replace'),
    );
    expect(replaceBtn).toBeDefined();
    await replaceBtn!.trigger('click');
    expect(wrapper.emitted('replace')).toHaveLength(1);
  });

  it('emits remove when the Remove button is clicked', async () => {
    const { wrapper } = mountWorkspace();
    const removeBtn = wrapper.findAll('button').find(
      (btn) => btn.text().includes('Remove'),
    );
    expect(removeBtn).toBeDefined();
    await removeBtn!.trigger('click');
    expect(wrapper.emitted('remove')).toHaveLength(1);
  });

  it('emits adjust with current focal point and new zoom value on zoom input', async () => {
    const { wrapper } = mountWorkspace({ mediaFocalPointX: 0.3, mediaFocalPointY: 0.7, mediaZoom: 1.0 });
    const slider = wrapper.find('.zoom-slider');

    // Simulate changing the slider value
    await slider.setValue('1.6');

    const adjustEvents = wrapper.emitted('adjust') as Array<[{ mediaFocalPointX: number; mediaFocalPointY: number; mediaZoom: number }]>;
    expect(adjustEvents).toBeDefined();
    expect(adjustEvents.length).toBeGreaterThanOrEqual(1);

    const lastPayload = adjustEvents[adjustEvents.length - 1][0];
    expect(lastPayload.mediaFocalPointX).toBe(0.3);
    expect(lastPayload.mediaFocalPointY).toBe(0.7);
    expect(lastPayload.mediaZoom).toBe(1.6);
  });

  it('clamps focal point values outside 0-1 range', () => {
    // Test with boundary values at 0 and 1
    const { wrapper: wrapperMin } = mountWorkspace({ mediaFocalPointX: 0, mediaFocalPointY: 0 });
    const markerMin = wrapperMin.find('.focal-point-marker');
    expect(markerMin.attributes('style')).toContain('left: 0%');
    expect(markerMin.attributes('style')).toContain('top: 0%');

    const { wrapper: wrapperMax } = mountWorkspace({ mediaFocalPointX: 1, mediaFocalPointY: 1 });
    const markerMax = wrapperMax.find('.focal-point-marker');
    expect(markerMax.attributes('style')).toContain('left: 100%');
    expect(markerMax.attributes('style')).toContain('top: 100%');
  });

  it('uses design system button classes on action buttons', () => {
    const { wrapper } = mountWorkspace();
    const buttons = wrapper.findAll('.action-buttons button');
    expect(buttons.length).toBe(2);

    const replaceBtn = buttons.find((btn) => btn.text().includes('Replace'));
    expect(replaceBtn!.classes()).toContain('btn');
    expect(replaceBtn!.classes()).toContain('btn--pill');
    expect(replaceBtn!.classes()).toContain('btn--secondary');

    const removeBtn = buttons.find((btn) => btn.text().includes('Remove'));
    expect(removeBtn!.classes()).toContain('btn');
    expect(removeBtn!.classes()).toContain('btn--pill');
    expect(removeBtn!.classes()).toContain('btn--ghost');
  });
});
