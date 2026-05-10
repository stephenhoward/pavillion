import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';

import DoorPlus from '@/client/components/common/icons/door-plus.vue';

describe('DoorPlus icon', () => {
  it('renders an inline svg with lucide-vue-next default attributes', () => {
    const wrapper = mount(DoorPlus);
    const svg = wrapper.find('svg');

    expect(svg.exists()).toBe(true);
    expect(svg.attributes('viewBox')).toBe('0 0 24 24');
    expect(svg.attributes('fill')).toBe('none');
    expect(svg.attributes('stroke')).toBe('currentColor');
    expect(svg.attributes('stroke-width')).toBe('2');
    expect(svg.attributes('stroke-linecap')).toBe('round');
    expect(svg.attributes('stroke-linejoin')).toBe('round');
  });

  it('defaults width and height to 24', () => {
    const wrapper = mount(DoorPlus);
    const svg = wrapper.find('svg');

    expect(svg.attributes('width')).toBe('24');
    expect(svg.attributes('height')).toBe('24');
  });

  it('applies the size prop to width and height', () => {
    const wrapper = mount(DoorPlus, { props: { size: 18 } });
    const svg = wrapper.find('svg');

    expect(svg.attributes('width')).toBe('18');
    expect(svg.attributes('height')).toBe('18');
  });

  it('is decorative by default (aria-hidden="true")', () => {
    const wrapper = mount(DoorPlus);
    expect(wrapper.find('svg').attributes('aria-hidden')).toBe('true');
  });

  it('renders both door silhouette paths and a plus glyph', () => {
    const wrapper = mount(DoorPlus);
    const paths = wrapper.findAll('svg path');

    // At minimum: door body + door base + door handle dot + 2 plus strokes = 5 paths
    expect(paths.length).toBeGreaterThanOrEqual(5);
  });
});
