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
    ],
    sidebar: [],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/stephenhoward/pavilion' },
    ],
  },
});
