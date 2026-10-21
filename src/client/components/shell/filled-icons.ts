import type { Component } from 'vue';
import {
  Bell,
  Calendar,
  Download,
  Globe,
  LayoutTemplate,
  Rss,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Sprout,
  User,
  Users,
} from 'lucide-vue-next';
import BellFilled from './icons/bell-filled.vue';
import CalendarFilled from './icons/calendar-filled.vue';
import DownloadFilled from './icons/download-filled.vue';
import GlobeFilled from './icons/globe-filled.vue';
import LayoutTemplateFilled from './icons/layout-template-filled.vue';
import RssFilled from './icons/rss-filled.vue';
import ServerFilled from './icons/server-filled.vue';
import SettingsFilled from './icons/settings-filled.vue';
import ShieldFilled from './icons/shield-filled.vue';
import ShieldCheckFilled from './icons/shield-check-filled.vue';
import SproutFilled from './icons/sprout-filled.vue';
import UserFilled from './icons/user-filled.vue';
import UsersFilled from './icons/users-filled.vue';

/**
 * The filled twin of each Lucide icon the navigation can mark current. A nav
 * item draws the twin in place of the outline while it is the current page:
 * the change of shape is the current item's non-colour cue. Lucide ships no
 * filled set, so these are drawn for Pavillion (icons/, licence beside them).
 * An icon added to the navigation needs an entry here; filled-icons.test.ts
 * checks every main and settings link.
 */
const FILLED_ICONS = new Map<Component, Component>([
  [Bell, BellFilled],
  [Calendar, CalendarFilled],
  [Download, DownloadFilled],
  [Globe, GlobeFilled],
  [LayoutTemplate, LayoutTemplateFilled],
  [Rss, RssFilled],
  [Server, ServerFilled],
  [Settings, SettingsFilled],
  [Shield, ShieldFilled],
  [ShieldCheck, ShieldCheckFilled],
  [Sprout, SproutFilled],
  [User, UserFilled],
  [Users, UsersFilled],
]);

/** The filled twin of a Lucide icon, or undefined when it has none. */
export function filledIconFor(icon: Component): Component | undefined {
  return FILLED_ICONS.get(icon);
}
