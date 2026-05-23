<template>
  <button
    v-if="guides.length > 0"
    type="button"
    class="btn btn--icon btn--ghost"
    :aria-label="t('button_label')"
    aria-haspopup="dialog"
    @click="showPanel = true"
  >
    <CircleHelp :size="20" :stroke-width="1.5" aria-hidden="true" />
  </button>

  <HelpPanel
    v-if="showPanel"
    :guides="guides"
    :audience="audience"
    @close="showPanel = false"
  />
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { CircleHelp } from 'lucide-vue-next';
import HelpPanel from './help-panel.vue';
import { guidesForRoute, audienceForRoute } from '@/client/service/docs';

const { t } = useTranslation('system', { keyPrefix: 'help' });
const route = useRoute();

const guides = computed(() => guidesForRoute(route.name));
const audience = computed(() => audienceForRoute(route.name));

const showPanel = ref(false);
</script>
