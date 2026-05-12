import { defineConfig } from 'vitepress';

const SITE_URL = 'https://docs.pavillion.social';
const SITE_NAME = 'Pavillion docs';

export default defineConfig({
  title: 'Pavillion',
  description: 'Guides for running and stewarding a Pavillion calendar — a federated, privacy-first events platform for community organizers and instance administrators.',
  cleanUrls: true,
  sitemap: {
    hostname: SITE_URL,
  },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/pavillion-logo.svg' }],
  ],
  transformHead({ pageData, siteData }) {
    const path = pageData.relativePath
      .replace(/(^|\/)index\.md$/, '$1')
      .replace(/\.md$/, '');
    const url = `${SITE_URL}/${path}`;
    const title = pageData.title || siteData.title;
    const description = pageData.description || siteData.description;
    const isHome = pageData.relativePath === 'index.md';
    return [
      ['link', { rel: 'canonical', href: url }],
      ['meta', { property: 'og:type', content: isHome ? 'website' : 'article' }],
      ['meta', { property: 'og:site_name', content: SITE_NAME }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:url', content: url }],
      ['meta', { name: 'twitter:card', content: 'summary' }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: description }],
    ];
  },
  srcExclude: [
    'CODE_OF_CONDUCT.md',
    'CONTRIBUTING.md',
    'configuration.md',
    'deployment.md',
    'email-configuration.md',
    'federation-testing.md',
    'internationalization.md',
    'secret-rotation.md',
    'upgrading.md',
  ],
  themeConfig: {
    logo: '/pavillion-logo.svg',
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Calendar owners', link: '/guides/calendar-owners/' },
    ],
    sidebar: {
      '/guides/calendar-owners/': [
        {
          text: 'For calendar owners',
          link: '/guides/calendar-owners/',
        },
        {
          text: 'Quickstart',
          items: [
            { text: 'From login to a published event', link: '/guides/calendar-owners/quickstart' },
          ],
        },
        {
          text: 'Build out your calendar',
          items: [
            { text: 'Post a recurring event', link: '/guides/calendar-owners/recurring-events' },
            { text: 'Organize events with categories', link: '/guides/calendar-owners/categories' },
            { text: 'Manage event locations', link: '/guides/calendar-owners/places' },
            { text: 'Group related events into a series', link: '/guides/calendar-owners/series' },
            { text: "Customize your calendar's identity", link: '/guides/calendar-owners/identity' },
            { text: 'Publish in multiple languages', link: '/guides/calendar-owners/multilingual' },
          ],
        },
        {
          text: 'Work with collaborators',
          items: [
            { text: 'Invite editors and manage their access', link: '/guides/calendar-owners/editors' },
          ],
        },
        {
          text: 'Connect with other calendars',
          items: [
            { text: 'Decide when to make a calendar', link: '/guides/calendar-owners/when-to-create-a-calendar' },
            { text: 'Bring in events from other calendars', link: '/guides/calendar-owners/follow-and-repost' },
            { text: 'Match categories from other calendars to yours', link: '/guides/calendar-owners/category-matching' },
            { text: 'Be a good neighbor across calendars', link: '/guides/calendar-owners/federation-etiquette' },
          ],
        },
        {
          text: 'Bring events in from elsewhere',
          items: [
            { text: 'Migrate from another calendar via ICS import', link: '/guides/calendar-owners/ics-import' },
          ],
        },
        {
          text: 'Share your calendar',
          items: [
            { text: 'Share your public calendar URL', link: '/guides/calendar-owners/public-url' },
            { text: 'Embed your calendar on your own website', link: '/guides/calendar-owners/embed' },
          ],
        },
        {
          text: 'Sustain your calendar',
          items: [
            { text: 'Set up community funding', link: '/guides/calendar-owners/funding' },
          ],
        },
        {
          text: 'Day-to-day operations',
          items: [
            { text: 'Cancel an event the right way', link: '/guides/calendar-owners/cancel-event' },
            { text: 'Handle reports and content moderation', link: '/guides/calendar-owners/moderation' },
            { text: 'Manage your account', link: '/guides/calendar-owners/account' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/stephenhoward/pavilion' },
    ],
  },
});
