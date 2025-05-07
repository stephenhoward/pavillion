<template>
  <section>
    <h3>{{ t('title') }}</h3>
    <div v-if="state.processingSuccess" class="success-message">
      {{ t('processing_success', { email: state.processingSuccess }) }}
    </div>
    <div v-if="state.processingError" class="error-message">
      {{ t('processing_error', { email: state.processingError }) }}
    </div>
    <table>
      <thead>
        <tr>
          <th scope="col">{{ t('email_column') }}</th>
          <th scope="col">{{ t('status_column') }}</th>
          <th scope="col">{{ t('date_column') }}</th>
          <th scope="col">{{ t('actions_column') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="application in store.applications" :key="application.id">
          <td>{{ application.email }}</td>
          <td :class="getStatusClass(application.status)">{{ formatStatus(application.status) }}</td>
          <td>{{ formatDate(application.statusTimestamp) }}</td>
          <td>
            <button type="button" @click="viewApplication(application)">
              {{ t('view') }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Application detail modal using the new component -->
    <ApplicationReviewView
      v-if="state.modalOpen"
      :application="state.selectedApplication"
      @close="state.modalOpen = false"
      @accept="acceptApplication"
      @reject="rejectApplication"
    />
  </section>
</template>

<script setup>
import { onBeforeMount, reactive, inject, toRaw } from 'vue';
import { useTranslation } from 'i18next-vue';
import { DateTime } from 'luxon';
import { useApplicationStore } from '../../../stores/applicationStore';
import AccountApplication from '../../../../common/model/application';
import ApplicationReviewView from './application_review.vue';
import ModelService from '../../../service/models';

const store = useApplicationStore();
const authn = inject('authn');
const { t } = useTranslation('admin', {
  keyPrefix: 'applications',
});

onBeforeMount(async () => {
  await loadApplications();
});

const loadApplications = async () => {
  try {
    const applications = await ModelService.listModels('/api/accounts/v1/applications');
    store.setApplications(applications.map(app => {
      return new AccountApplication(
        app.id,
        app.email,
        app.message,
        app.status,
        app.statusTimestamp ? new Date(app.statusTimestamp) : null,
      );
    }));
  }
  catch (error) {
    console.error('Error loading applications:', error);
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

const state = reactive({
  modalOpen: false,
  selectedApplication: null,
  processingSuccess: null,
  processingError: null,
});

const viewApplication = (application) => {
  state.selectedApplication = application;
  state.modalOpen = true;
};

const acceptApplication = async (application) => {
  try {
    await authn.process_application(application.id, true);
    // Remove the application from the store since it's deleted on the server
    store.removeApplication(toRaw(application));
    state.processingSuccess = application.email;
    state.modalOpen = false;

    setTimeout(() => {
      state.processingSuccess = null;
    }, 3000);
  }
  catch (error) {
    console.error('Error accepting application:', error);
    state.processingError = application.email;
    setTimeout(() => {
      state.processingError = null;
    }, 3000);
  }
};

const rejectApplication = async (application, silent) => {
  try {
    await authn.process_application(application.id, false, silent);
    // Update the application in the store instead of removing
    application.status = 'rejected';
    application.statusTimestamp = new Date();
    state.processingSuccess = application.email;
    state.modalOpen = false;

    setTimeout(() => {
      state.processingSuccess = null;
    }, 3000);
  }
  catch (error) {
    console.error('Error rejecting application:', error);
    state.processingError = application.email;
    setTimeout(() => {
      state.processingError = null;
    }, 3000);
  }
};
</script>

<style scoped lang="scss">
</style>
