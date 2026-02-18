<script setup lang="ts">
import { ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import Modal from '@/client/components/common/modal.vue';

interface Category {
  id: string;
  name: string;
}

const props = defineProps<{
  eventTitle: string;
  preSelectedCategories: Category[];
  allLocalCategories: Category[];
}>();

const emit = defineEmits<{
  confirm: [categoryIds: string[]];
  cancel: [];
}>();

const { t } = useTranslation('feed');

const selectedIds = ref<string[]>(props.preSelectedCategories.map(c => c.id));

function toggle(id: string) {
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter(i => i !== id);
  }
  else {
    selectedIds.value = [...selectedIds.value, id];
  }
}

function handleConfirm() {
  emit('confirm', [...selectedIds.value]);
}

function handleCancel() {
  emit('cancel');
}
</script>

<template>
  <Modal
    :title="t('categoryMapping.repostDialogTitle')"
    @close="handleCancel"
  >
    <div class="repost-categories-modal">
      <p class="description">
        {{ t('categoryMapping.repostDialogDescription', { eventTitle }) }}
      </p>

      <fieldset
        v-if="allLocalCategories.length > 0"
        class="category-fieldset"
      >
        <legend>{{ t('categoryMapping.categoriesLabel') }}</legend>
        <ul class="category-list">
          <li
            v-for="cat in allLocalCategories"
            :key="cat.id"
            class="category-item"
          >
            <label class="category-label">
              <input
                type="checkbox"
                :value="cat.id"
                :checked="selectedIds.includes(cat.id)"
                @change="toggle(cat.id)"
              />
              {{ cat.name }}
            </label>
          </li>
        </ul>
      </fieldset>

      <p
        v-else
        class="no-categories"
      >
        {{ t('categoryMapping.noLocalCategories') }}
      </p>

      <div class="modal-actions">
        <button
          type="button"
          class="secondary"
          @click="handleCancel"
        >
          {{ t('categoryMapping.cancel') }}
        </button>
        <button
          type="button"
          class="primary"
          @click="handleConfirm"
        >
          {{ t('categoryMapping.repostConfirm') }}
        </button>
      </div>
    </div>
  </Modal>
</template>

<style scoped lang="scss">
div.repost-categories-modal {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);
  min-width: 300px;

  @media (min-width: 768px) {
    min-width: 440px;
  }

  p.description {
    margin: 0;
    color: var(--pav-color-text-primary);
    font-size: 0.9375rem;
    line-height: 1.5;
  }

  fieldset.category-fieldset {
    border: none;
    padding: 0;
    margin: 0;

    legend {
      font-size: 0.9375rem;
      font-weight: var(--pav-font-weight-medium);
      color: var(--pav-color-text-primary);
      margin-bottom: var(--pav-space-2);
    }
  }

  ul.category-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-2);
    max-height: 240px;
    overflow-y: auto;

    li.category-item {
      label.category-label {
        display: flex;
        align-items: center;
        gap: var(--pav-space-2);
        cursor: pointer;
        font-size: 0.9375rem;
        color: var(--pav-color-text-primary);

        input[type='checkbox'] {
          width: 1rem;
          height: 1rem;
          flex-shrink: 0;
          cursor: pointer;
          accent-color: var(--pav-color-interactive-primary);
        }

        &:hover {
          color: var(--pav-color-interactive-primary);
        }
      }
    }
  }

  p.no-categories {
    margin: 0;
    font-size: 0.875rem;
    color: rgba(0, 0, 0, 0.6);
    font-style: italic;

    @media (prefers-color-scheme: dark) {
      color: rgba(255, 255, 255, 0.6);
    }
  }

  div.modal-actions {
    display: flex;
    gap: var(--pav-space-3);
    justify-content: flex-end;
    margin-top: var(--pav-space-2);

    button {
      padding: var(--pav-space-2) var(--pav-space-4);
      border-radius: var(--pav-border-radius-pill);
      font-weight: var(--pav-font-weight-medium);
      cursor: pointer;
      transition: all 0.2s ease;

      &.secondary {
        background: transparent;
        border: 1px solid rgba(0, 0, 0, 0.2);
        color: var(--pav-color-text-primary);

        @media (prefers-color-scheme: dark) {
          border-color: rgba(255, 255, 255, 0.2);
        }

        &:hover {
          background: rgba(0, 0, 0, 0.05);

          @media (prefers-color-scheme: dark) {
            background: rgba(255, 255, 255, 0.05);
          }
        }
      }

      &.primary {
        background: var(--pav-color-interactive-primary);
        border: none;
        color: white;

        &:hover {
          background: var(--pav-color-interactive-primary-hover);
        }
      }

      &:focus-visible {
        outline: 2px solid var(--pav-color-interactive-primary);
        outline-offset: 2px;
      }
    }
  }
}
</style>
