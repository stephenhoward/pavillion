<template>
  <header class="admin-section-header">
    <div class="admin-section-header__row">
      <h2 class="admin-section-header__title">{{ title }}</h2>
      <div v-if="$slots.actions" class="admin-section-header__actions">
        <slot name="actions" />
      </div>
    </div>
    <p v-if="description" class="admin-section-header__description">{{ description }}</p>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
}>();
</script>

<style scoped lang="scss">
@use '../../assets/style/components/calendar-admin' as *;

.admin-section-header {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-1);
  min-width: 0;

  &__row {
    @include admin-section-header;
    align-items: center;
    gap: var(--pav-space-4);
    flex-wrap: wrap;
    margin-bottom: 0;
  }

  &__title {
    @include admin-section-title;
    margin: 0;
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: var(--pav-space-2);
  }

  &__description {
    margin: 0;
    color: var(--pav-color-stone-600);
    font-size: 0.875rem;
    max-width: 36rem;

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);
    }
  }
}
</style>
