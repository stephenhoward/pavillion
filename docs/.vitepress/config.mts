import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Pavillion',
  description: 'Federated events calendar documentation',
  cleanUrls: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/pavillion-logo.svg' }],
  ],
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
            { text: 'Run a recurring event', link: '/guides/calendar-owners/recurring-events' },
            { text: 'Organize events with categories', link: '/guides/calendar-owners/categories' },
            { text: 'Reuse venues with places', link: '/guides/calendar-owners/places' },
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
            { text: 'Follow other calendars and repost their events', link: '/guides/calendar-owners/follow-and-repost' },
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
