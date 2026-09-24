/**
 * Tests for the shared EmptyState component.
 *
 * The component is the proof of the src/common/ui styling contract: one
 * compiled component mounted by the site, the widget and the client, themed by
 * whichever app's --pav-* tokens surround it. These tests cover its markup
 * contract; the colours are verified in each app, not here, because jsdom does
 * not resolve custom properties.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { readFileSync } from 'fs';
import path from 'path';

import EmptyState from '@/common/ui/components/EmptyState.vue';

const COMPONENT_PATH = path.join(process.cwd(), 'src/common/ui/components/EmptyState.vue');

describe('EmptyState', () => {
  it('renders the heading as an h2 by default', () => {
    const wrapper = mount(EmptyState, { props: { heading: 'No events' } });

    const heading = wrapper.find('h2');
    expect(heading.exists()).toBe(true);
    expect(heading.text()).toBe('No events');
  });

  it('renders the heading at the level the caller passes', () => {
    const wrapper = mount(EmptyState, { props: { heading: 'No calendars', headingLevel: 'h3' } });

    expect(wrapper.find('h3').text()).toBe('No calendars');
    expect(wrapper.find('h2').exists()).toBe(false);
  });

  it('renders no heading element when no heading is given', () => {
    const wrapper = mount(EmptyState, { slots: { default: '<p>Nothing here</p>' } });

    expect(wrapper.find('h2, h3, h4').exists()).toBe(false);
  });

  it('renders the default slot as the body', () => {
    const wrapper = mount(EmptyState, {
      props: { heading: 'No events' },
      slots: { default: '<p class="body">Try another filter</p>' },
    });

    expect(wrapper.find('p.body').text()).toBe('Try another filter');
  });

  it('renders a plain div with no landmark by default', () => {
    const wrapper = mount(EmptyState, { props: { heading: 'No events' } });

    expect(wrapper.element.tagName).toBe('DIV');
    expect(wrapper.attributes('aria-labelledby')).toBeUndefined();
    expect(wrapper.find('h2').attributes('id')).toBeUndefined();
  });

  it('renders a section labelled by its heading when region is set', () => {
    const wrapper = mount(EmptyState, { props: { heading: 'No events', region: true } });

    const headingId = wrapper.find('h2').attributes('id');
    expect(wrapper.element.tagName).toBe('SECTION');
    expect(headingId).toBeTruthy();
    expect(wrapper.attributes('aria-labelledby')).toBe(headingId);
  });

  it('gives each region instance in an app its own heading id', () => {
    // useId() is unique per app, so both instances must share one mount.
    const wrapper = mount(defineComponent({
      components: { EmptyState },
      template: '<div><EmptyState heading="A" region /><EmptyState heading="B" region /></div>',
    }));

    const [first, second] = wrapper.findAll('section.ui-empty-state');
    expect(first.attributes('aria-labelledby')).toBe(first.find('h2').attributes('id'));
    expect(second.attributes('aria-labelledby')).toBe(second.find('h2').attributes('id'));
    expect(first.find('h2').attributes('id')).not.toBe(second.find('h2').attributes('id'));
  });

  it('stays a div when region is set without a heading to label it', () => {
    const wrapper = mount(EmptyState, { props: { region: true } });

    expect(wrapper.element.tagName).toBe('DIV');
    expect(wrapper.attributes('aria-labelledby')).toBeUndefined();
  });

  it('styles itself with --pav-* custom properties and no compile-time colour', () => {
    const source = readFileSync(COMPONENT_PATH, 'utf-8');
    const style = source.slice(source.indexOf('<style'));

    expect(style).toMatch(/var\(--pav-text-secondary\)/);
    expect(style).toMatch(/var\(--pav-text-primary\)/);
    expect(style).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(style).not.toMatch(/dark-mode|prefers-color-scheme|data-theme/);
  });
});
