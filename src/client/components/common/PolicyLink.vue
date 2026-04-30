<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from 'i18next-vue';

/**
 * PolicyLink — shared link to the instance policy page.
 *
 * Renders a router-link to the named route 'instance-policy'. Defaults
 * its visible label to the system `navigation.view_policy` translation,
 * and accepts a custom label via the `label` prop for surface-specific
 * phrasing (e.g. signup, footer, admin card, public page).
 */

const props = withDefaults(defineProps<{
  /** Visible label override. Defaults to the system "View policy" translation. */
  label?: string;
}>(), {
  label: undefined,
});

const { t } = useTranslation('system', { keyPrefix: 'navigation' });

const resolvedLabel = computed<string>(() => props.label ?? t('view_policy'));
</script>

<template>
  <router-link :to="{ name: 'instance-policy' }">
    {{ resolvedLabel }}
  </router-link>
</template>
