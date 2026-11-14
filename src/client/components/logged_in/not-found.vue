<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';

/**
 * Dead-end page rendered inside the app shell for a client path no route
 * matches (old `/profile`, `/funding`, `/admin/*`, anything else the server
 * answers with the client shell). It is also where the bare-route redirect
 * lands, with `?error=load`, when the calendar list could not be loaded, so
 * the user gets a way forward instead of an empty shell. No redirects.
 */

const { t } = useTranslation('system', { keyPrefix: 'not_found' });
const route = useRoute();
const heading = ref<HTMLElement | null>(null);

const loadFailed = computed(() => route.query.error === 'load');

onMounted(async () => {
  await nextTick();
  heading.value?.focus();
});
</script>

<template>
  <section class="not-found">
    <h1 ref="heading" tabindex="-1">
      {{ loadFailed ? t('load_failed_title') : t('title') }}
    </h1>
    <p>{{ loadFailed ? t('load_failed_description') : t('description') }}</p>
    <a href="/calendar">{{ loadFailed ? t('try_again') : t('back_to_calendar') }}</a>
  </section>
</template>

<style scoped lang="scss">
.not-found {
  padding: var(--pav-space-6);

  h1:focus {
    outline: none;
  }

  a {
    text-decoration: underline;
  }
}
</style>
