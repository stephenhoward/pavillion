import config from 'config';
import type ConfigurationInterface from '@/server/configuration/interface';

/**
 * The instance's display name: the site title, or the configured domain
 * when no title is set. The interface is optional because some callers
 * receive it by setter after construction.
 *
 * @param configurationInterface - Source of the instance settings
 * @returns The name to show users on behalf of this instance
 */
export async function resolveInstanceName(
  configurationInterface?: Pick<ConfigurationInterface, 'getAllSettings'>,
): Promise<string> {
  const settings = await configurationInterface?.getAllSettings();
  return settings?.siteTitle || config.get<string>('domain');
}
