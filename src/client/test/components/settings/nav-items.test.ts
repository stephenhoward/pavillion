import { describe, it, expect } from 'vitest';
import {
  Calendar, Download, Globe, LayoutTemplate, LogOut, Server, Settings, Shield, ShieldCheck, Sprout, User, Users,
} from 'lucide-vue-next';
import settingsEn from '@/client/locales/en/settings.json';
import {
  rootItems,
  calendarItems,
  accountItems,
  adminItems,
  firstVisibleLeaf,
  groupItems,
  isVisibleLeaf,
  findLeafByRouteName,
  isSettingsLeafGroup,
  SETTINGS_GROUP_INDEX_ROUTES,
  SETTINGS_GROUP_TITLE_KEYS,
  type SettingsNavContext,
} from '@/client/components/logged_in/settings/nav-items';

function ctx(overrides: Partial<SettingsNavContext> = {}): SettingsNavContext {
  return {
    calendarUrlName: 'riverside',
    isOwner: true,
    isAdmin: false,
    fundingEnabled: true,
    ...overrides,
  };
}

const ids = (items: { id: string }[]) => items.map((item) => item.id);

describe('settings nav items', () => {
  describe('visibility matrix', () => {
    it.each([
      { isOwner: true, isAdmin: true, fundingEnabled: true,
        root: ['calendar', 'account', 'instance', 'logout'],
        calendar: ['general', 'editors', 'reports', 'import', 'widget'],
        account: ['profile', 'security', 'funding_plan'] },
      { isOwner: true, isAdmin: true, fundingEnabled: false,
        root: ['calendar', 'account', 'instance', 'logout'],
        calendar: ['general', 'editors', 'reports', 'import', 'widget'],
        account: ['profile', 'security'] },
      { isOwner: true, isAdmin: false, fundingEnabled: true,
        root: ['calendar', 'account', 'logout'],
        calendar: ['general', 'editors', 'reports', 'import', 'widget'],
        account: ['profile', 'security', 'funding_plan'] },
      { isOwner: true, isAdmin: false, fundingEnabled: false,
        root: ['calendar', 'account', 'logout'],
        calendar: ['general', 'editors', 'reports', 'import', 'widget'],
        account: ['profile', 'security'] },
      { isOwner: false, isAdmin: true, fundingEnabled: true,
        root: ['calendar', 'account', 'instance', 'logout'],
        calendar: ['editors', 'widget'],
        account: ['profile', 'security', 'funding_plan'] },
      { isOwner: false, isAdmin: true, fundingEnabled: false,
        root: ['calendar', 'account', 'instance', 'logout'],
        calendar: ['editors', 'widget'],
        account: ['profile', 'security'] },
      { isOwner: false, isAdmin: false, fundingEnabled: true,
        root: ['calendar', 'account', 'logout'],
        calendar: ['editors', 'widget'],
        account: ['profile', 'security', 'funding_plan'] },
      { isOwner: false, isAdmin: false, fundingEnabled: false,
        root: ['calendar', 'account', 'logout'],
        calendar: ['editors', 'widget'],
        account: ['profile', 'security'] },
    ])(
      'owner=$isOwner admin=$isAdmin funding=$fundingEnabled',
      ({ isOwner, isAdmin, fundingEnabled, root, calendar, account }) => {
        const context = ctx({ isOwner, isAdmin, fundingEnabled });

        expect(ids(rootItems(context))).toEqual(root);
        expect(ids(calendarItems(context))).toEqual(calendar);
        expect(ids(accountItems(context))).toEqual(account);
      },
    );
  });

  describe('without a calendar', () => {
    it('omits the root Calendar row and returns no calendar leaves', () => {
      const context = ctx({ calendarUrlName: null });

      expect(ids(rootItems(context))).toEqual(['account', 'logout']);
      expect(calendarItems(context)).toEqual([]);
    });
  });

  describe('item shape', () => {
    it('addresses the root Calendar row and every calendar leaf to the calendar url name', () => {
      const context = ctx();
      const calendarRow = rootItems(context).find((item) => item.id === 'calendar');

      expect(calendarRow && 'to' in calendarRow ? calendarRow.to : undefined).toEqual({
        name: 'calendar_management',
        params: { calendar: 'riverside' },
      });
      for (const item of calendarItems(context)) {
        expect(item.to).toEqual({ name: item.routeName, params: { calendar: 'riverside' } });
      }
    });

    it('addresses the root Account and Instance rows to their group indexes', () => {
      const root = rootItems(ctx({ isAdmin: true }));
      const toOf = (id: string) => {
        const item = root.find((candidate) => candidate.id === id);
        return item && 'to' in item ? item.to : undefined;
      };

      expect(toOf('account')).toEqual({ name: 'account' });
      expect(toOf('instance')).toEqual({ name: 'admin' });
    });

    it('gives each link item its route name', () => {
      expect(calendarItems(ctx()).map((item) => item.routeName)).toEqual([
        'calendar_general', 'calendar_editors', 'calendar_reports', 'calendar_import', 'calendar_widget',
      ]);
      expect(accountItems(ctx()).map((item) => item.routeName)).toEqual([
        'profile', 'security', 'funding_plan',
      ]);
      expect(adminItems().map((item) => item.routeName)).toEqual([
        'admin_settings', 'accounts', 'admin_calendars', 'moderation', 'federation', 'funding',
      ]);
    });

    it('makes log out a danger action, last in the root list', () => {
      const items = rootItems(ctx({ isAdmin: true }));
      const last = items[items.length - 1];

      expect(last).toMatchObject({ id: 'logout', action: 'logout', danger: true, labelKey: 'nav.root.log_out' });
      expect('to' in last).toBe(false);
    });

    it('uses lucide-vue-next components for icons', () => {
      const icons = (items: { icon: unknown }[]) => items.map((item) => item.icon);

      expect(icons(rootItems(ctx({ isAdmin: true })))).toEqual([Calendar, User, Server, LogOut]);
      expect(icons(calendarItems(ctx()))).toEqual([Settings, Users, ShieldCheck, Download, LayoutTemplate]);
      expect(icons(accountItems(ctx()))).toEqual([User, Shield, Sprout]);
      // The six icons of the admin pane's own navigation.
      expect(icons(adminItems())).toEqual([Settings, Users, Calendar, ShieldCheck, Globe, Sprout]);
    });

    it('gives every row a label key that resolves in the settings namespace', () => {
      const context = ctx({ isAdmin: true });
      const items = [...rootItems(context), ...calendarItems(context), ...accountItems(context), ...adminItems()];
      const resolve = (key: string): unknown => key
        .split('.')
        .reduce<unknown>((node, segment) => (node as Record<string, unknown> | undefined)?.[segment], settingsEn);

      for (const item of items) {
        expect(typeof resolve(item.labelKey), item.labelKey).toBe('string');
      }
    });
  });

  describe('firstVisibleLeaf', () => {
    it.each([
      { group: 'root', context: ctx({ isOwner: true }),
        expected: { name: 'calendar_general', params: { calendar: 'riverside' } } },
      { group: 'root', context: ctx({ isOwner: false }),
        expected: { name: 'calendar_editors', params: { calendar: 'riverside' } } },
      { group: 'root', context: ctx({ calendarUrlName: null }),
        expected: { name: 'profile' } },
      { group: 'calendar', context: ctx({ isOwner: true }),
        expected: { name: 'calendar_general', params: { calendar: 'riverside' } } },
      { group: 'calendar', context: ctx({ isOwner: false }),
        expected: { name: 'calendar_editors', params: { calendar: 'riverside' } } },
      { group: 'account', context: ctx({ fundingEnabled: false }),
        expected: { name: 'profile' } },
      { group: 'admin', context: ctx({ isAdmin: true }),
        expected: { name: 'admin_settings' } },
      { group: 'admin', context: ctx({ isAdmin: false }),
        expected: { name: 'profile' } },
    ] as const)('$group → $expected.name', ({ group, context, expected }) => {
      expect(firstVisibleLeaf(group, context)).toEqual(expected);
    });

    it('falls back to profile for an empty calendar group as a loop guard, not as unresolved-calendar handling', () => {
      expect(firstVisibleLeaf('calendar', ctx({ calendarUrlName: null }))).toEqual({ name: 'profile' });
    });

    it('returns a fresh object each call', () => {
      const first = firstVisibleLeaf('calendar', ctx());
      const second = firstVisibleLeaf('calendar', ctx());

      expect(first).not.toBe(second);
      expect(first.params).not.toBe(second.params);
    });
  });

  describe('isVisibleLeaf', () => {
    it('treats calendar_report_detail as part of Reports, owner only', () => {
      expect(isVisibleLeaf('calendar', 'calendar_report_detail', ctx({ isOwner: true }))).toBe(true);
      expect(isVisibleLeaf('calendar', 'calendar_report_detail', ctx({ isOwner: false }))).toBe(false);
    });

    it('hides owner-only leaves from an editor and keeps shared ones', () => {
      expect(isVisibleLeaf('calendar', 'calendar_general', ctx({ isOwner: false }))).toBe(false);
      expect(isVisibleLeaf('calendar', 'calendar_widget', ctx({ isOwner: false }))).toBe(true);
    });

    it('hides funding_plan when funding is disabled', () => {
      expect(isVisibleLeaf('account', 'funding_plan', ctx({ fundingEnabled: true }))).toBe(true);
      expect(isVisibleLeaf('account', 'funding_plan', ctx({ fundingEnabled: false }))).toBe(false);
    });

    it('treats moderation sub-pages as part of Moderation, admin only', () => {
      expect(isVisibleLeaf('admin', 'moderation_settings', ctx({ isAdmin: true }))).toBe(true);
      expect(isVisibleLeaf('admin', 'moderation_settings', ctx({ isAdmin: false }))).toBe(false);
    });

    it('answers root from the calendar and account leaves', () => {
      expect(isVisibleLeaf('root', 'calendar_import', ctx({ isOwner: true }))).toBe(true);
      expect(isVisibleLeaf('root', 'security', ctx({ calendarUrlName: null }))).toBe(true);
      expect(isVisibleLeaf('root', 'calendar_editors', ctx({ calendarUrlName: null }))).toBe(false);
    });
  });

  describe('groupItems', () => {
    it('gives the root list its section rows and Log out', () => {
      expect(ids(groupItems('root', ctx({ isAdmin: true })))).toEqual(['calendar', 'account', 'instance', 'logout']);
    });

    it.each([
      { group: 'calendar', context: ctx({ isOwner: false }), expected: ['editors', 'widget'] },
      { group: 'account', context: ctx({ fundingEnabled: false }), expected: ['profile', 'security'] },
      { group: 'admin', context: ctx({ isAdmin: true }),
        expected: ['general', 'accounts', 'calendars', 'moderation', 'federation', 'funding'] },
    ] as const)('gives the $group list its visible leaves', ({ group, context, expected }) => {
      expect(ids(groupItems(group, context))).toEqual(expected);
    });

    it('gates the admin group on isAdmin', () => {
      expect(groupItems('admin', ctx({ isAdmin: false }))).toEqual([]);
    });
  });

  describe('findLeafByRouteName', () => {
    it.each([
      ['calendar_general', 'calendar', 'calendar_general', 'nav.calendar.general'],
      ['calendar_report_detail', 'calendar', 'calendar_reports', 'nav.calendar.reports'],
      ['funding_plan', 'account', 'funding_plan', 'nav.account.funding_plan'],
      ['admin_settings', 'admin', 'admin_settings', 'nav.admin.general'],
      ['blocked_instances', 'admin', 'moderation', 'nav.admin.moderation'],
    ])('resolves %s to its leaf', (name, group, routeName, labelKey) => {
      expect(findLeafByRouteName(name)).toEqual({ group, routeName, labelKey });
    });

    it('finds leaves the viewer may not see, since a title is not visibility', () => {
      const editorWithoutFunding = ctx({ isOwner: false, fundingEnabled: false });
      expect(isVisibleLeaf('calendar', 'calendar_import', editorWithoutFunding)).toBe(false);
      expect(findLeafByRouteName('calendar_import')?.group).toBe('calendar');
      expect(isVisibleLeaf('account', 'funding_plan', editorWithoutFunding)).toBe(false);
      expect(findLeafByRouteName('funding_plan')?.group).toBe('account');
    });

    it.each(['settings', 'calendar_management', 'account', 'admin', 'calendar', ''])(
      'returns null for %j, which is not a leaf',
      (name) => {
        expect(findLeafByRouteName(name)).toBeNull();
      },
    );

    it('agrees with the tree for every listed leaf', () => {
      const all = [
        ...calendarItems(ctx()).map((item) => ['calendar', item] as const),
        ...accountItems(ctx()).map((item) => ['account', item] as const),
        ...adminItems().map((item) => ['admin', item] as const),
      ];
      for (const [group, item] of all) {
        expect(findLeafByRouteName(item.routeName)).toEqual({ group, routeName: item.routeName, labelKey: item.labelKey });
      }
    });
  });

  describe('group vocabulary', () => {
    it.each(['calendar', 'account', 'admin'])('recognises %s as a leaf group', (value) => {
      expect(isSettingsLeafGroup(value)).toBe(true);
    });

    it.each(['root', 'Calendar', '', undefined, null, 1])('rejects %j', (value) => {
      expect(isSettingsLeafGroup(value)).toBe(false);
    });

    it('titles every group with a key that resolves in the settings namespace', () => {
      expect(SETTINGS_GROUP_TITLE_KEYS).toEqual({
        calendar: 'titles.calendar', account: 'titles.account', admin: 'titles.instance',
      });
      for (const key of Object.values(SETTINGS_GROUP_TITLE_KEYS)) {
        const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], settingsEn);
        expect(typeof value).toBe('string');
      }
    });

    it('names each group index, and the root rows link to them', () => {
      expect(SETTINGS_GROUP_INDEX_ROUTES).toEqual({ calendar: 'calendar_management', account: 'account', admin: 'admin' });
      const rows = rootItems(ctx({ isAdmin: true })).filter((item) => !item.action) as { routeName: string }[];
      expect(rows.map((item) => item.routeName)).toEqual(Object.values(SETTINGS_GROUP_INDEX_ROUTES));
    });

    it('is not itself a leaf', () => {
      for (const name of Object.values(SETTINGS_GROUP_INDEX_ROUTES)) {
        expect(findLeafByRouteName(name)).toBeNull();
      }
    });
  });
});
