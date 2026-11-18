import { describe, it, expect } from 'vitest';
import sinon from 'sinon';
import config from 'config';

import { resolveInstanceName } from '@/server/common/helper/instance-name';

describe('resolveInstanceName', () => {
  const domain = config.get<string>('domain');
  const interfaceWith = (settings: any) => ({ getAllSettings: sinon.stub().resolves(settings) });

  it('returns the site title when set', async () => {
    expect(await resolveInstanceName(interfaceWith({ siteTitle: 'Town Events' }))).toBe('Town Events');
  });

  it('falls back to the domain when the site title is an empty string', async () => {
    expect(await resolveInstanceName(interfaceWith({ siteTitle: '' }))).toBe(domain);
  });

  it('falls back to the domain when the site title is missing', async () => {
    expect(await resolveInstanceName(interfaceWith({}))).toBe(domain);
  });

  it('falls back to the domain when settings are undefined', async () => {
    expect(await resolveInstanceName(interfaceWith(undefined))).toBe(domain);
  });

  it('falls back to the domain when no interface is given', async () => {
    expect(await resolveInstanceName()).toBe(domain);
  });
});
