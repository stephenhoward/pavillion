import DefaultTheme from 'vitepress/theme';
import { Lightbulb } from 'lucide-vue-next';
import './pavillion.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Lightbulb', Lightbulb);
  },
};
