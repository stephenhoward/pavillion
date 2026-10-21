/**
 * The filled icon set that marks the current navigation item.
 *
 * Every icon the shell and settings navigation can mark current needs a
 * filled variant, or that item would lose its one non-colour cue.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import type { Component } from 'vue';
import { Bell, Calendar, LogOut, Rss, Settings } from 'lucide-vue-next';
import { filledIconFor } from '@/client/components/shell/filled-icons';
import {
  accountItems,
  adminItems,
  calendarItems,
  rootItems,
  type SettingsNavContext,
} from '@/client/components/logged_in/settings/nav-items';

const everyLeaf: SettingsNavContext = {
  calendarUrlName: 'pottery',
  isOwner: true,
  isAdmin: true,
  fundingEnabled: true,
};

/**
 * Every link the navigation can mark current, as [where, icon]. The main
 * navigation's icons mirror logged_in/root.vue; Log out is an action, never
 * current, so it is left out.
 */
const currentableLinks: [string, Component][] = [
  ['main nav calendar', Calendar],
  ['main nav feed', Rss],
  ['main nav inbox', Bell],
  ['main nav settings', Settings],
  ...rootItems(everyLeaf).filter((item) => !item.action).map((item): [string, Component] => [`settings root ${item.id}`, item.icon]),
  ...calendarItems(everyLeaf).map((item): [string, Component] => [`calendar ${item.id}`, item.icon]),
  ...accountItems(everyLeaf).map((item): [string, Component] => [`account ${item.id}`, item.icon]),
  ...adminItems().map((item): [string, Component] => [`admin ${item.id}`, item.icon]),
];

describe('filled navigation icons', () => {
  it.each(currentableLinks)('has a filled variant for the %s link', (_where, icon) => {
    expect(filledIconFor(icon)).toBeDefined();
  });

  it('has no filled variant for an icon the navigation never marks current', () => {
    expect(filledIconFor(LogOut)).toBeUndefined();
  });

  it.each(currentableLinks)('draws the %s icon in currentColor, hidden from assistive technology', (_where, icon) => {
    const wrapper = mount(filledIconFor(icon)!);
    const svg = wrapper.find('svg');
    const paths = wrapper.findAll('path');

    expect(svg.attributes('aria-hidden')).toBe('true');
    expect(svg.attributes('viewBox')).toBe('0 0 24 24');
    // Colour comes only from the link, so forced colours repaint the icon too
    const paints = paths.flatMap((path) => [path.attributes('fill'), path.attributes('stroke')]);
    expect(paints.filter((paint) => paint !== 'none' && paint !== 'currentColor')).toEqual([]);
    expect(paths.some((path) => path.attributes('fill') === 'currentColor')).toBe(true);
  });
});
