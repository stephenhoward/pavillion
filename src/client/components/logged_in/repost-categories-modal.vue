<script setup lang="ts">
import { ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import Modal from '@/client/components/common/modal.vue';
import type { CalendarEvent } from '@/common/model/events';

interface Category {
  id: string;
  name: string;
}

const props = defineProps<{
  eventTitle?: string;
  preSelectedCategories: Category[];
  allLocalCategories: Category[];
  event?: CalendarEvent;
  confirmLabel?: string;
  dialogTitle?: string;
}>();

const emit = defineEmits<{
  confirm: [categoryIds: string[]];
  cancel: [];
}>();

const { t } = useTranslation('feed');

const selectedIds = ref<string[]>(
  props.preSelectedCategories
    .map(c => c.id)
    .filter(id => props.allLocalCategories.some(cat => cat.id === id)),
);

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

function formatEventDate(event: CalendarEvent): string | null {
  if (!event.schedules || event.schedules.length === 0) return null;
  const schedule = event.schedules[0];
  if (!schedule.startDate) return null;
  return schedule.startDate.toLocaleString(DateTime.DATETIME_MED);
}

function getEventSource(url: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  }
  catch {
    return null;
  }
}
</script>

<template>
  <Modal
    :title="dialogTitle ?? t('categoryMapping.repostDialogTitle')"
    @close="handleCancel"
  >
    <div class="repost-categories-modal">
      <!-- Read-only event details section (shown when event prop is provided) -->
      <div
        v-if="event"
        class="event-details"
      >
        <dl class="event-details-list">
          <div
            v-if="formatEventDate(event)"
            class="detail-row"
          >
            <dt>{{ t('categoryMapping.eventDate') }}</dt>
            <dd>{{ formatEventDate(event) }}</dd>
          </div>
          <div
            v-if="event.content('en').description"
            class="detail-row"
          >
            <dt>{{ t('categoryMapping.eventDescription') }}</dt>
            <dd>{{ event.content('en').description }}</dd>
          </div>
          <div
            v-if="event.location?.name"
            class="detail-row"
          >
            <dt>{{ t('categoryMapping.eventLocation') }}</dt>
            <dd>{{ event.location.name }}</dd>
          </div>
          <div
            v-if="getEventSource(event.eventSourceUrl)"
            class="detail-row"
          >
            <dt>{{ t('categoryMapping.eventSource') }}</dt>
            <dd>{{ getEventSource(event.eventSourceUrl) }}</dd>
          </div>
        </dl>
      </div>

      <!-- Description paragraph (shown in feed repost flow when event prop is absent) -->
      <p
        v-else
        class="description"
      >
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
          {{ confirmLabel ?? t('categoryMapping.repostConfirm') }}
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

  div.event-details {
    padding: var(--pav-space-3);
    background: var(--pav-color-surface-secondary);
    border-radius: var(--pav-border-radius-md);
    border: 1px solid var(--pav-color-border-primary);

    dl.event-details-list {
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: var(--pav-space-2);

      div.detail-row {
        display: grid;
        grid-template-columns: 6rem 1fr;
        gap: var(--pav-space-2);
        align-items: baseline;

        dt {
          font-size: 0.8125rem;
          font-weight: var(--pav-font-weight-medium);
          color: var(--pav-color-text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        dd {
          margin: 0;
          font-size: 0.9375rem;
          color: var(--pav-color-text-primary);
          line-height: 1.4;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
        }
      }
    }
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
    color: var(--pav-color-text-secondary);
    font-style: italic;
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
        border: 1px solid var(--pav-color-border-primary);
        color: var(--pav-color-text-primary);

        &:hover {
          background: var(--pav-color-surface-secondary);
        }
      }

      &.primary {
        background: var(--pav-color-interactive-primary);
        border: none;
        color: var(--pav-color-text-inverse);

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
