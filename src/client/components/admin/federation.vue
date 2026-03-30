<script setup lang="ts">
import { useTranslation } from 'i18next-vue';

const { t } = useTranslation('admin', {
  keyPrefix: 'federation',
});
</script>

<template>
  <div class="federation-page">
    <!-- Page Header -->
    <div class="federation-header">
      <div>
        <h1>{{ t("title") }}</h1>
        <p class="federation-subtitle">{{ t("subtitle") }}</p>
      </div>
    </div>

    <!-- Info Panel -->
    <div class="federation-info-panel" role="note">
      <svg
        class="federation-info-icon"
        width="20"
        height="20"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <p>{{ t("info_text") }}</p>
    </div>

    <!-- Blocked Instances Link Card -->
    <section class="federation-card" aria-labelledby="blocked-instances-heading">
      <div class="federation-card-header">
        <h2 id="blocked-instances-heading">{{ t("blocked_instances_title") }}</h2>
      </div>
      <div class="federation-card-body">
        <p class="federation-card-description">{{ t("manage_blocked_description") }}</p>
        <router-link
          :to="{ name: 'blocked_instances' }"
          class="btn btn--pill btn--primary federation-manage-link"
        >
          {{ t("manage_blocked_link") }}
        </router-link>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
@use '../../assets/style/tokens/breakpoints' as *;

.federation-page {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-6);
  max-width: 800px;

  .federation-header {
    h1 {
      margin: 0 0 var(--pav-space-1) 0;
      font-size: var(--pav-font-size-2xl);
      font-weight: var(--pav-font-weight-light);
      color: var(--pav-color-text-primary);
    }

    .federation-subtitle {
      margin: 0;
      font-size: var(--pav-font-size-xs);
      color: var(--pav-color-text-muted);
    }
  }

  .federation-info-panel {
    display: flex;
    gap: var(--pav-space-3);
    padding: var(--pav-space-4);
    background: var(--pav-color-sky-50);
    border: 1px solid var(--pav-color-sky-200);
    border-radius: var(--pav-border-radius-md);

    .federation-info-icon {
      flex-shrink: 0;
      margin-top: var(--pav-space-0_5);
      color: var(--pav-color-sky-500);
    }

    p {
      margin: 0;
      font-size: var(--pav-font-size-xs);
      color: var(--pav-color-sky-800);
      line-height: var(--pav-line-height-relaxed);
    }
  }

  .federation-card {
    background: var(--pav-color-surface-primary);
    border: 1px solid var(--pav-border-color-light);
    border-radius: var(--pav-border-radius-card);
    overflow: hidden;

    .federation-card-header {
      padding: var(--pav-space-4) var(--pav-space-6);
      border-bottom: 1px solid var(--pav-border-color-light);

      h2 {
        margin: 0;
        font-size: var(--pav-font-size-base);
        font-weight: var(--pav-font-weight-medium);
        color: var(--pav-color-text-primary);
      }
    }

    .federation-card-body {
      padding: var(--pav-space-6);

      .federation-card-description {
        margin: 0 0 var(--pav-space-4) 0;
        font-size: var(--pav-font-size-xs);
        color: var(--pav-color-text-secondary);
        line-height: var(--pav-line-height-relaxed);
      }

      .federation-manage-link {
        text-decoration: none;
      }
    }
  }
}

/* Dark mode overrides */
@media (prefers-color-scheme: dark) {
  .federation-page {
    .federation-info-panel {
      background: rgba(14, 165, 233, 0.08);
      border-color: var(--pav-color-sky-800);

      p {
        color: var(--pav-color-sky-200);
      }
    }
  }
}
</style>
