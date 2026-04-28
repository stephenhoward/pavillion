<template>
  <ul
    class="import-source-list"
    :aria-label="t('section_title')"
  >
    <ImportSourceRow
      v-for="source in sources"
      :key="source.id"
      :source="source"
      :is-removing="removingId === source.id"
      :is-syncing="syncingId === source.id"
      @remove="(s) => emit('remove', s)"
      @sync="(s) => emit('sync', s)"
      @verify="(s) => emit('verify', s)"
    />
  </ul>
</template>

<script setup lang="ts">
import { useTranslation } from 'i18next-vue';

import type { ImportSource } from '@/common/model/import_source';
import ImportSourceRow from './ImportSourceRow.vue';

defineProps<{
  sources: ImportSource[];
  removingId?: string | null;
  syncingId?: string | null;
}>();

const emit = defineEmits<{
  (event: 'remove', source: ImportSource): void;
  (event: 'sync', source: ImportSource): void;
  (event: 'verify', source: ImportSource): void;
}>();

const { t } = useTranslation('calendars', { keyPrefix: 'import' });
</script>

<style scoped lang="scss">
.import-source-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-3);
}
</style>
