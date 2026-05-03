import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Pavillion',
  description: 'Federated events calendar documentation',
  cleanUrls: true,
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
    nav: [
      { text: 'Home', link: '/' },
    ],
    sidebar: [],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/stephenhoward/pavilion' },
    ],
  },
});
