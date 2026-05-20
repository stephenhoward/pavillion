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
      { text: 'Instance administrators', link: '/guides/instance-administrators/' },
    ],
    sidebar: {
      '/guides/instance-administrators/': [
        {
          text: 'For instance administrators',
          link: '/guides/instance-administrators/',
        },
        {
          text: 'Quickstart',
          items: [
            { text: 'From clean server to federating instance', link: '/guides/instance-administrators/quickstart' },
          ],
        },
        {
          text: 'Get an instance running',
          items: [
            { text: 'Install a Pavillion instance', link: '/guides/instance-administrators/installation' },
            { text: 'Configure your instance', link: '/guides/instance-administrators/configuration' },
            { text: 'Reverse proxy and TLS', link: '/guides/instance-administrators/reverse-proxy-and-tls' },
            { text: 'Email', link: '/guides/instance-administrators/email' },
            { text: 'Media storage', link: '/guides/instance-administrators/media-storage' },
          ],
        },
        {
          text: 'Shape your instance',
          items: [
            { text: 'What your instance is for', link: '/guides/instance-administrators/what-your-instance-is-for' },
            { text: 'Who gets a calendar', link: '/guides/instance-administrators/who-gets-a-calendar' },
            { text: 'A code of conduct for your instance', link: '/guides/instance-administrators/code-of-conduct' },
          ],
        },
        {
          text: 'Operate your instance',
          items: [
            { text: 'Monitoring and logs', link: '/guides/instance-administrators/monitoring-and-logs' },
            { text: 'Backups', link: '/guides/instance-administrators/backups' },
            { text: 'Upgrading', link: '/guides/instance-administrators/upgrading' },
            { text: 'Rotating secrets', link: '/guides/instance-administrators/secret-rotation' },
            { text: 'Troubleshooting', link: '/guides/instance-administrators/troubleshooting' },
          ],
        },
        {
          text: 'Federate with the network',
          items: [
            { text: 'How federation works, for admins', link: '/guides/instance-administrators/how-federation-works-for-admins' },
            { text: 'Testing federation', link: '/guides/instance-administrators/testing-federation' },
            { text: 'Federation policy', link: '/guides/instance-administrators/federation-policy' },
            { text: 'Federation incidents', link: '/guides/instance-administrators/federation-incidents' },
          ],
        },
        {
          text: 'Moderate at the instance level',
          items: [
            { text: 'Moderation boundaries', link: '/guides/instance-administrators/moderation-boundaries' },
            { text: 'Removing a calendar', link: '/guides/instance-administrators/removing-a-calendar' },
            { text: 'Account operations', link: '/guides/instance-administrators/accounts' },
          ],
        },
        {
          text: 'Fund your instance',
          items: [
            { text: 'Setting up funding plans', link: '/guides/instance-administrators/funding-plans-setup' },
            { text: 'Asking your community for money', link: '/guides/instance-administrators/asking-your-community-for-money' },
          ],
        },
        {
          text: 'Relationship with your community',
          items: [
            { text: 'Communicating with your calendar owners', link: '/guides/instance-administrators/communicating-with-calendar-owners' },
            { text: 'Being a good admin', link: '/guides/instance-administrators/being-a-good-admin' },
          ],
        },
      ],
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
