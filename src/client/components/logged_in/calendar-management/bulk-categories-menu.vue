<script setup>
import { computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { ArrowRightLeft } from 'lucide-vue-next';

const { t } = useTranslation('calendars', {
  keyPrefix: 'bulk_category_operations',
});

const props = defineProps({
  selectedCount: {
    type: Number,
    required: true,
  },
});

const emit = defineEmits(['merge-categories', 'deselect-all']);

const isVisible = computed(() => props.selectedCount >= 2);

const selectionText = computed(() => {
  return `${props.selectedCount} selected`;
});

const mergeCategories = () => {
  emit('merge-categories');
};

const deselectAll = () => {
  emit('deselect-all');
};

</script>

<template>
  <Transition name="slide-up">
    <div
      v-if="isVisible"
      class="bulk-categories-menu"
      role="toolbar"
      :aria-label="t('menu_label')"
    >
      <div class="bulk-menu-container">
        <span class="selection-text">
          {{ selectionText }}
        </span>
        <div class="divider" />
        <div class="action-buttons">
          <button
            type="button"
            class="merge-button"
            data-testid="merge-categories-btn"
            @click="mergeCategories"
            :aria-label="t('merge_categories_label')"
          >
            <ArrowRightLeft :size="16" :stroke-width="2" />
            Merge
          </button>
          <button
            type="button"
            class="deselect-button"
            data-testid="deselect-all-btn"
            @click="deselectAll"
            :aria-label="t('deselect_all_label')"
          >
            Deselect
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped lang="scss">
.bulk-categories-menu {
  position: fixed;
  bottom: 1.5rem; // 24px
  left: 1rem;
  right: 1rem;
  z-index: 40;

  @media (min-width: 640px) {
    left: 50%;
    right: auto;
    transform: translateX(-50%);
  }
}

.bulk-menu-container {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background-color: var(--pav-color-stone-900);
  color: white;
  border-radius: 1rem; // rounded-2xl
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);

  @media (prefers-color-scheme: dark) {
    background-color: var(--pav-color-stone-800);
  }

  @media (min-width: 640px) {
    flex-direction: row;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1.25rem;
  }
}

.selection-text {
  font-size: 0.875rem;
  font-weight: 500;
  text-align: center;
  white-space: nowrap;

  @media (min-width: 640px) {
    text-align: left;
    flex-shrink: 0;
  }
}

.divider {
  display: none;

  @media (min-width: 640px) {
    display: block;
    width: 1px;
    height: 1.5rem;
    background-color: var(--pav-color-stone-700);
  }
}

.action-buttons {
  display: flex;
  gap: 0.5rem;
}

.merge-button,
.deselect-button {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.375rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: 9999px; // rounded-full
  border: none;
  cursor: pointer;
  transition: background-color 0.2s ease;

  @media (min-width: 640px) {
    flex: none;
  }
}

.merge-button {
  gap: 0.5rem;
  background-color: var(--pav-color-sky-500);
  color: white;

  &:hover {
    background-color: var(--pav-color-sky-600);
  }
}

.deselect-button {
  background-color: var(--pav-color-stone-700);
  color: white;

  &:hover {
    background-color: var(--pav-color-stone-600);
  }
}

// Slide up animation
.slide-up-enter-active {
  animation: slide-up 0.3s ease-out;
}

.slide-up-leave-active {
  animation: slide-up 0.3s ease-out reverse;
}

@keyframes slide-up {
  from {
    transform: translateY(100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

// Adjust for centered positioning on desktop
@media (min-width: 640px) {
  .slide-up-enter-active {
    animation: slide-up-centered 0.3s ease-out;
  }

  .slide-up-leave-active {
    animation: slide-up-centered 0.3s ease-out reverse;
  }

  @keyframes slide-up-centered {
    from {
      transform: translate(-50%, 100%);
      opacity: 0;
    }
    to {
      transform: translate(-50%, 0);
      opacity: 1;
    }
  }
}
</style>
