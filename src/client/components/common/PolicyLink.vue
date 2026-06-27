<script setup lang="ts">
import { computed, inject } from 'vue';
import { useTranslation } from 'i18next-vue';

/**
 * PolicyLink — shared link to the instance policy page.
 *
 * When no `label` prop is provided, renders the system
 * `navigation.view_policy` phrase with only the "Read the rules"
 * portion as a router-link, the rest as plain text (interpolated
 * with the instance domain from site_config). When `label` is
 * provided, renders the entire label as a single router-link.
 *
 * The optional `source` prop is forwarded as a `?from=<source>` query
 * parameter so the policy page can render a contextual back link.
 */

const props = withDefaults(defineProps<{
  /** Visible label override. Renders the entire label as a single link. */
  label?: string;
  /** Origin surface used by the policy page to render a contextual back link. */
  source?: string;
}>(), {
  label: undefined,
  source: undefined,
});

const site_config = inject('site_config') as { settings?: () => { domain?: string } } | undefined;

const { t } = useTranslation('system', { keyPrefix: 'navigation' });

const domain = computed<string>(() => site_config?.settings?.()?.domain ?? '');

const phrase = computed<string>(() => t('view_policy', { domain: domain.value }));

const target = computed(() => {
  return props.source
    ? { name: 'instance-policy', query: { from: props.source } }
    : { name: 'instance-policy' };
});
</script>

<template>
  <p class="policy-link">
    <router-link v-if="props.label !== undefined"
                 :to="target">
      {{ props.label }}
    </router-link>
    <i18next v-else
             :translation="phrase">
      <template #1>
        <router-link :to="target">
          {{ t('view_policy_link_text') }}
        </router-link>
      </template>
    </i18next>
  </p>
</template>

<style scoped lang="scss">
.policy-link {
  margin-block: var(--pav-space-4) 0;
  font-size: var(--pav-font-size-small);
}
</style>
