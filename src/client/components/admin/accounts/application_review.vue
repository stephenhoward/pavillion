<template>
  <ModalLayout :title="t('application_details')" @close="$emit('close')">
    <div>
      <p><strong>{{ t('email_label') }}:</strong> {{ application.email }}</p>
      <p>
        <strong>{{ t('status_label') }}:</strong>
        <span :class="getStatusClass(application.status)">{{ formatStatus(application.status) }}</span>
        <span v-if="application.statusTimestamp" class="status-date">
          ({{ formatDate(application.statusTimestamp) }})
        </span>
      </p>
      <div class="message-container">
        <p><strong>{{ t('message_label') }}:</strong></p>
        <pre>{{ application.message }}</pre>
      </div>
      <div class="action-buttons">
        <button
          type="button"
          class="accept"
          @click="accept"
          :disabled="processing"
        >
          <span v-if="processing === 'accept'">{{ t('processing') }}</span>
          <span v-else>{{ t('accept') }}</span>
        </button>
        <button
          v-if="application.status !== 'rejected'"
          type="button"
          class="reject"
          @click="reject(false)"
          :disabled="processing"
        >
          <span v-if="processing === 'reject'">{{ t('processing') }}</span>
          <span v-else>{{ t('reject') }}</span>
        </button>
        <button
          v-if="application.status !== 'rejected'"
          type="button"
          class="silent-reject"
          @click="reject(true)"
          :disabled="processing"
        >
          <span v-if="processing === 'silent-reject'">{{ t('processing') }}</span>
          <span v-else>{{ t('silent_reject') }}</span>
        </button>
      </div>
    </div>
  </ModalLayout>
</template>

<script setup>
import { ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import ModalLayout from '../../modal.vue';

const props = defineProps({
  application: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['close', 'accept', 'reject']);

const { t } = useTranslation('admin', {
  keyPrefix: 'applications',
});

const processing = ref(null);

const closeModal = () => {
  emit('close');
};

const accept = async () => {
  processing.value = 'accept';
  try {
    await emit('accept', props.application);
  }
  finally {
    processing.value = null;
  }
};

const reject = async (silent) => {
  processing.value = silent ? 'silent-reject' : 'reject';
  try {
    await emit('reject', props.application, silent);
  }
  finally {
    processing.value = null;
  }
};

const formatStatus = (status) => {
  return t(`status_${status}`);
};

const getStatusClass = (status) => {
  return `status-${status}`;
};

const formatDate = (date) => {
  if (!date) return '';
  return DateTime.fromJSDate(date).toLocaleString(DateTime.DATETIME_SHORT);
};
</script>

<style scoped lang="scss">
.message-container {
  margin: 15px 0;
  pre {
    white-space: pre-wrap;
    padding: 10px;
    border-radius: 4px;
    max-height: 200px;
    overflow-y: auto;
  }
}

.status-pending {
  color: #FF9800;
  font-weight: bold;
}

.status-accepted {
  color: #4CAF50;
  font-weight: bold;
}

.status-rejected {
  color: #F44336;
  font-weight: bold;
}

.status-date {
  font-size: 0.9em;
  margin-left: 8px;
  color: #666;
}

.action-buttons {
  margin-top: 20px;
  display: flex;
  gap: 10px;

  .accept {
    background-color: #4CAF50;
    color: white;
    &:hover {
      background-color: darken(#4CAF50, 10%);
    }
  }

  .reject, .silent-reject {
    background-color: #F44336;
    color: white;
    &:hover {
      background-color: darken(#F44336, 10%);
    }
  }

  .silent-reject {
    background-color: #FF9800;
    &:hover {
      background-color: darken(#FF9800, 10%);
    }
  }
}
</style>
