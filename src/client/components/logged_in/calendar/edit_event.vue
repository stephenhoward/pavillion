<style scoped lang="scss">
/* Full-page event editor container - uses 100vh since it renders as a top-level route */
.event-editor-page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: var(--pav-color-stone-50);

  @media (prefers-color-scheme: dark) {
    background-color: var(--pav-color-stone-900);
  }
}

/* Page header with back button, title, and action buttons */
.page-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.5rem 2rem;
  border-bottom: 1px solid var(--pav-color-stone-200);
  background-color: white;
  position: sticky;
  top: 0;
  z-index: 10;

  @media (prefers-color-scheme: dark) {
    background-color: var(--pav-color-stone-800);
    border-bottom-color: var(--pav-color-stone-700);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-left: auto;
  }

  .back-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border: none;
    border-radius: 0.5rem; // rounded-lg
    background-color: transparent;
    color: var(--pav-color-stone-700);
    cursor: pointer;
    transition: all 0.15s ease;
    flex-shrink: 0;

    svg {
      width: 20px;
      height: 20px;
      min-width: 20px;
      display: block;
      flex-shrink: 0;
    }

    &:hover {
      background-color: var(--pav-color-stone-100);
      color: var(--pav-color-stone-900);
    }

    &:focus-visible {
      outline: 2px solid var(--pav-color-orange-500);
      outline-offset: 2px;
    }

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-400);

      &:hover {
        background-color: var(--pav-color-stone-800);
        color: var(--pav-color-stone-200);
      }
    }
  }

  h1 {
    margin: 0;
    font-size: 1.25rem; // text-xl (smaller than before)
    font-weight: 500; // font-medium (lighter than semibold)
    color: var(--pav-color-stone-900);

    @media (prefers-color-scheme: dark) {
      color: var(--pav-color-stone-100);
    }
  }

  @media (max-width: 480px) {
    flex-wrap: wrap;
    padding: 1rem;
    gap: 0.5rem;

    h1 {
      flex: 1;
    }

    .header-actions {
      width: 100%;
      margin-left: 0;
      justify-content: flex-end;
    }
  }
}

/* Loading state */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--pav-space-4xl);
  color: var(--pav-color-text-secondary);

  .loading-spinner {
    font-size: 24px;
    margin-bottom: var(--pav-space-md);
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
}

/* Screen reader only class for accessibility */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Main form container - single column */
main[role="main"].editor-main {
  flex: 1;
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
  padding: 0;
  box-sizing: border-box;
}

/* Form styling */
form {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.btn-cancel {
  padding: 0;
  border: none;
  background: none;
  color: var(--pav-color-stone-600);
  font-size: 0.9375rem;
  font-weight: 400;
  cursor: pointer;
  transition: color 0.15s ease;

  &:hover {
    color: var(--pav-color-stone-900);
  }

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);

    &:hover {
      color: var(--pav-color-stone-200);
    }
  }
}

.btn-save {
  padding: 0.625rem 1.5rem;
  border: none;
  background: var(--pav-color-orange-500);
  color: white;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  border-radius: 9999px; // Full pill shape
  transition: all 0.15s ease;

  &:hover {
    background: var(--pav-color-orange-600);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-orange-500);
    outline-offset: 2px;
  }
}

/* Single column container */
.editor-container {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  padding: 2rem;

  @media (max-width: 768px) {
    padding: 1rem;
    gap: 1.5rem;
  }
}

/* Section styling */
.editor-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.section-header {
  margin: 0;
  padding: 0;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--pav-color-stone-500);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.section-card {
  background: white;
  border: 1px solid var(--pav-color-stone-200);
  border-radius: 0.5rem;
  padding: 1.5rem;

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-800);
    border-color: var(--pav-color-stone-700);
  }
}

/* Event fields */
.event-fields {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.field-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--pav-color-stone-700);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-300);
  }

  .info-icon {
    margin-left: 0.25rem;
    color: var(--pav-color-stone-400);
    cursor: help;
  }
}

.field-input,
.field-textarea {
  // appearance: none needed so WebKit accepts custom padding/height on <select>
  appearance: none;
  padding: 0.625rem 0.875rem;
  border: 1px solid var(--pav-color-stone-200);
  border-radius: 0.375rem;
  font-size: 0.9375rem;
  background: var(--pav-color-stone-50);
  color: var(--pav-color-stone-900);
  font-family: inherit;
  transition: all 0.15s ease;

  &:focus {
    outline: none;
    border-color: var(--pav-color-orange-500);
    background: white;
  }

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-900);
    border-color: var(--pav-color-stone-600);
    color: var(--pav-color-stone-100);

    &:focus {
      background: var(--pav-color-stone-800);
    }
  }
}

select.field-input {
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  background-size: 1.25rem 1.25rem;
  padding-inline-end: 2.25rem;
}

.field-input--error {
  border-color: var(--pav-color-red-400);

  &:focus {
    border-color: var(--pav-color-red-500);
    box-shadow: 0 0 0 3px var(--pav-color-red-100);
  }
}

.form-error {
  margin: var(--pav-space-1) 0 0;
  font-size: var(--pav-font-size-xs);
  color: var(--pav-color-red-600);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-red-400);
  }
}

.form-required {
  color: var(--pav-color-red-500);
  margin-inline-start: 0.125rem;
}

.external-link-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: flex-start;
}

.external-link-prompt {
  flex: 0 0 auto;
  min-width: 11rem;
}

.external-link-url {
  flex: 1 1 18rem;
  min-width: 0;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.field-textarea {
  resize: vertical;
  min-height: 80px;
  line-height: 1.5;
}

.remove-translation-link {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: none;
  color: var(--pav-color-red-600);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s ease;

  &:hover {
    color: var(--pav-color-red-700);
    text-decoration: underline;
  }

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-red-400);

    &:hover {
      color: var(--pav-color-red-300);
    }
  }
}

/* Location display/editor */
.location-display {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.location-info {
  flex: 1;
}

.location-name {
  font-size: 1rem;
  font-weight: 500;
  color: var(--pav-color-stone-900);
  margin-bottom: 0.25rem;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-100);
  }
}

.location-address {
  font-size: 0.875rem;
  color: var(--pav-color-stone-600);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

.btn-change {
  padding: 0.5rem 1rem;
  border: 1px solid var(--pav-color-stone-300);
  background: white;
  color: var(--pav-color-stone-700);
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--pav-color-stone-50);
    border-color: var(--pav-color-stone-400);
  }

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-800);
    border-color: var(--pav-color-stone-600);
    color: var(--pav-color-stone-300);

    &:hover {
      background: var(--pav-color-stone-700);
    }
  }
}

.location-editor {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.location-row {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 0.5rem;

  @media (max-width: 480px) {
    grid-template-columns: 1fr;
  }
}

/* Schedule list */
.schedule-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 1rem;
}

.schedule-item {
  padding: 1rem;
  background: var(--pav-color-stone-50);
  border: 1px solid var(--pav-color-stone-200);
  border-radius: 0.5rem;

  @media (prefers-color-scheme: dark) {
    background: var(--pav-color-stone-900);
    border-color: var(--pav-color-stone-700);
  }
}

.add-schedule-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 2px dashed var(--pav-color-stone-300);
  background: transparent;
  color: var(--pav-color-stone-600);
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.15s ease;
  width: 100%;
  justify-content: center;

  &:hover {
    border-color: var(--pav-color-stone-400);
    background: var(--pav-color-stone-50);
  }

  @media (prefers-color-scheme: dark) {
    border-color: var(--pav-color-stone-600);
    color: var(--pav-color-stone-400);

    &:hover {
      border-color: var(--pav-color-stone-500);
      background: var(--pav-color-stone-800);
    }
  }
}

.schedule-help-text {
  margin: 0.75rem 0 0 0;
  font-size: 0.8125rem;
  color: var(--pav-color-stone-500);
  line-height: 1.5;

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-stone-400);
  }
}

/* Cancellations panel collapsible trigger & container */
.cancellations-trigger-wrapper {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--pav-color-stone-200);

  @media (prefers-color-scheme: dark) {
    border-top-color: var(--pav-color-stone-700);
  }
}

.cancellations-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--pav-color-stone-300);
  border-radius: 0.375rem;
  background: transparent;
  color: var(--pav-color-stone-700);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--pav-color-stone-50);
    border-color: var(--pav-color-stone-400);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-orange-500);
    outline-offset: 2px;
  }

  @media (prefers-color-scheme: dark) {
    border-color: var(--pav-color-stone-600);
    color: var(--pav-color-stone-300);

    &:hover {
      background: var(--pav-color-stone-800);
      border-color: var(--pav-color-stone-500);
    }
  }
}

.cancellations-panel-wrapper {
  margin-top: 1rem;
}

/* Error styling */
.error {
  position: relative;
  color: var(--pav-color-red-700);
  font-size: 0.9rem;
  padding: 1rem 2.5rem 1rem 1.5rem;
  border-radius: 0.75rem; // rounded-xl
  background-color: var(--pav-color-red-50);
  border: 1px solid var(--pav-color-red-200);

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-red-300);
    background-color: rgba(239, 68, 68, 0.1);
    border-color: var(--pav-color-red-900);
  }

  ul {
    margin: 0;
    padding-left: var(--pav-space-md);
    list-style-type: disc;
  }

  li {
    margin-bottom: var(--pav-space-xs);

    &:last-child {
      margin-bottom: 0;
    }
  }
}

.error-dismiss {
  position: absolute;
  top: 0.5rem;
  right: 0.75rem;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.25rem;
  line-height: 1;
  color: var(--pav-color-red-700);
  padding: 0.125rem 0.25rem;
  border-radius: 0.25rem;

  &:hover {
    background-color: var(--pav-color-red-100);
  }

  @media (prefers-color-scheme: dark) {
    color: var(--pav-color-red-300);

    &:hover {
      background-color: rgba(239, 68, 68, 0.2);
    }
  }
}

.error-detail {
  margin-top: 0.5rem;
  font-size: 0.875rem;
  opacity: 0.85;
}

/* Form group styling (for general use) */
.form-group {
  margin-bottom: 0;

  label {
    display: block;
    margin-bottom: var(--pav-space-xs);
    font-weight: var(--pav-font-weight-medium);
    color: var(--pav-color-text-primary);
  }
}

/* Form actions footer */
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding-top: 2rem;
  margin-top: 2rem;
  border-top: 1px solid var(--pav-color-stone-200);

  @media (prefers-color-scheme: dark) {
    border-top-color: var(--pav-color-stone-700);
  }

  @media (max-width: 768px) {
    flex-direction: column-reverse;

    button {
      width: 100%;
    }
  }
}

/* Button styling that follows semantic system */
button {
  font-size: 14px;
  border: 1px solid var(--pav-color-border-primary);
  border-radius: var(--pav-border-radius-sm);
  padding: var(--pav-space-sm) var(--pav-space-lg);
  background-color: var(--pav-color-surface-primary);
  color: var(--pav-color-text-primary);
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background-color: var(--pav-color-interactive-secondary-hover);
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px rgba(var(--pav-color-interactive-primary-rgb), 0.2);
  }

  &.primary {
    background-color: var(--pav-color-interactive-primary);
    color: white;
    border-color: var(--pav-color-interactive-primary);

    &:hover {
      opacity: 0.9;
    }
  }

  &.danger {
    background-color: var(--pav-color-danger, #dc3545);
    color: white;
    border-color: var(--pav-color-danger, #dc3545);

    &:hover {
      opacity: 0.9;
    }
  }

  &.remove {
    font-size: 20px;
    background: none;
    border: none;
    display: block;
    float: right;
  }

  img {
    width: 16px;
  }
}

/* Unsaved changes confirmation dialog */
.unsaved-changes-confirmation {
  p {
    margin: 0 0 var(--pav-space-xl) 0;
    color: var(--pav-color-text-primary);
    line-height: 1.5;
  }

  .dialog-actions {
    display: flex;
    gap: var(--pav-space-md);
    justify-content: flex-end;

    @media (max-width: 599px) {
      flex-direction: column-reverse;

      button {
        width: 100%;
      }
    }
  }
}
</style>

<template>
  <div class="event-editor-page">
    <!-- Page Header with Back Button and Actions -->
    <header class="page-header">
      <button type="button"
              class="back-button"
              @click="handleBackClick"
              :aria-label="t('back_button', 'Go back')">
        <ArrowLeft :size="20" aria-hidden="true" />
      </button>
      <h1>{{ translatedPageTitle }}</h1>
      <div class="header-actions">
        <button
          type="button"
          class="btn-cancel"
          @click="handleBackClick"
        >
          Cancel
        </button>
        <button
          type="submit"
          form="event-form"
          class="btn-save"
        >
          Save Changes
        </button>
      </div>
    </header>

    <!-- Loading State -->
    <div
      v-if="editorState.isLoading"
      class="loading-container"
      role="status"
      aria-live="polite"
    >
      <span class="loading-spinner" aria-hidden="true">&#8987;</span>
      <span>Loading...</span>
    </div>

    <!-- Main Content - only render when event is loaded -->
    <main
      v-else-if="editorState.event"
      role="main"
      aria-label="Event Editor"
      class="editor-main"
    >
      <form
        id="event-form"
        @submit.prevent="handleSaveEvent()"
        aria-label="Event Information Form"
        novalidate
      >

        <!-- Error Display -->
        <div v-if="editorState.err"
             ref="errorContainer"
             class="error"
             role="alert">
          <button
            class="error-dismiss"
            type="button"
            aria-label="Dismiss error"
            @click="editorState.err = ''; editorState.errDetail = ''"
          >&times;</button>
          <div v-if="Array.isArray(editorState.err)">
            <ul>
              <li v-for="(error, index) in editorState.err" :key="index">{{ error }}</li>
            </ul>
          </div>
          <div v-else>
            {{ editorState.err }}
          </div>
          <div v-if="editorState.errDetail" class="error-detail">
            {{ editorState.errDetail }}
          </div>
        </div>

        <!-- Single Column Layout -->
        <div class="editor-container">

          <!-- EVENT DETAILS Section -->
          <section class="editor-section">
            <h2 class="section-header">EVENT DETAILS</h2>

            <div class="section-card">
              <!-- Language Tabs -->
              <LanguageTabSelector
                v-model="currentLanguage"
                :languages="languages"
                :errored-tabs="erroredTabs"
                @add-language="openLanguagePicker"
                @remove-language="handleRemoveLanguage"
              />

              <!-- Event Content Fields (for selected language) -->
              <div
                :dir="iso6391.getDir(currentLanguage) === 'rtl' ? 'rtl' : 'ltr'"
                class="event-fields"
              >
                <div class="form-field">
                  <label :for="`event-name-${currentLanguage}`" class="field-label">
                    Event Title
                    <span class="form-required" aria-hidden="true">*</span>
                  </label>
                  <input
                    :id="`event-name-${currentLanguage}`"
                    type="text"
                    name="name"
                    v-model="editorState.event.content(currentLanguage).name"
                    class="field-input"
                    :class="{ 'field-input--error': fieldErrors.title }"
                    :aria-invalid="fieldErrors.title ? 'true' : undefined"
                    :aria-describedby="fieldErrors.title ? 'event-title-error' : undefined"
                    @input="clearFieldError('title')"
                  />
                  <p
                    v-if="fieldErrors.title"
                    id="event-title-error"
                    class="form-error"
                    role="alert"
                  >
                    {{ fieldErrors.title }}
                  </p>
                </div>

                <div class="form-field">
                  <label :for="`event-description-${currentLanguage}`" class="field-label">Description</label>
                  <textarea
                    :id="`event-description-${currentLanguage}`"
                    name="description"
                    v-model="editorState.event.content(currentLanguage).description"
                    class="field-textarea"
                    rows="4"
                  />
                </div>

                <div class="form-field">
                  <label :for="`event-accessibility-${currentLanguage}`" class="field-label">
                    {{ t('field_accessibility_info') }}
                    <span class="info-icon" :title="t('field_accessibility_tooltip')">ⓘ</span>
                  </label>
                  <textarea
                    :id="`event-accessibility-${currentLanguage}`"
                    name="accessibility"
                    v-model="editorState.event.content(currentLanguage).accessibilityInfo"
                    class="field-textarea"
                    rows="3"
                  />
                </div>

                <button
                  v-if="languages.length > 1"
                  type="button"
                  class="remove-translation-link"
                  @click="handleRemoveLanguage(currentLanguage)"
                >
                  {{ t('remove_language', { language: iso6391.getName(currentLanguage) }) }}
                </button>
              </div>
            </div>
          </section>

          <!-- LOCATION Section -->
          <section class="editor-section">
            <h2 class="section-header">LOCATION</h2>

            <LocationDisplayCard
              :location="editorState.event.location"
              @change-location="handleOpenLocationPicker"
              @add-location="handleOpenLocationPicker"
            />
          </section>

          <!-- EXTERNAL LINK Section -->
          <section class="editor-section">
            <h2 class="section-header">{{ tExternalLink('section_title') }}</h2>

            <div class="section-card">
              <div class="external-link-row">
                <div class="form-field external-link-prompt">
                  <label for="event-url-prompt" class="visually-hidden">
                    {{ tExternalLink('prompt_label') }}
                  </label>
                  <select
                    id="event-url-prompt"
                    name="urlPrompt"
                    v-model="urlPromptProxy"
                    class="field-input"
                    :class="{ 'field-input--error': fieldErrors.urlPrompt }"
                    :aria-invalid="fieldErrors.urlPrompt ? 'true' : undefined"
                    :aria-describedby="fieldErrors.urlPrompt ? 'event-urlPrompt-error' : undefined"
                    @change="clearFieldError('urlPrompt')"
                  >
                    <option value="more_info">{{ tExternalLink('prompt_options.more_info') }}</option>
                    <option value="tickets">{{ tExternalLink('prompt_options.tickets') }}</option>
                    <option value="rsvp">{{ tExternalLink('prompt_options.rsvp') }}</option>
                  </select>
                  <p
                    v-if="fieldErrors.urlPrompt"
                    id="event-urlPrompt-error"
                    class="form-error"
                    role="alert"
                  >
                    {{ fieldErrors.urlPrompt }}
                  </p>
                </div>

                <div class="form-field external-link-url">
                  <label for="event-external-url" class="visually-hidden">
                    {{ tExternalLink('url_label') }}
                  </label>
                  <input
                    id="event-external-url"
                    type="url"
                    name="externalUrl"
                    maxlength="2048"
                    :placeholder="tExternalLink('url_placeholder')"
                    v-model="editorState.event.externalUrl"
                    class="field-input"
                    :class="{ 'field-input--error': fieldErrors.externalUrl }"
                    :aria-invalid="fieldErrors.externalUrl ? 'true' : undefined"
                    :aria-describedby="fieldErrors.externalUrl ? 'event-externalUrl-error' : undefined"
                    @input="clearFieldError('externalUrl')"
                  />
                  <p
                    v-if="fieldErrors.externalUrl"
                    id="event-externalUrl-error"
                    class="form-error"
                    role="alert"
                  >
                    {{ fieldErrors.externalUrl }}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <!-- EVENT IMAGE Section -->
          <section class="editor-section">
            <h2 class="section-header">EVENT IMAGE</h2>

            <div class="section-card">
              <!-- Show workspace when an image is attached, uploader otherwise -->
              <ImageWorkspace
                v-if="eventImage"
                :image="eventImage"
                @adjust="handleImageAdjust"
                @replace="handleImageReplace"
                @remove="handleImageRemove"
              />
              <ImageUpload
                v-else
                :calendar-id="editorState.event.calendarId || 'default'"
                :multiple="false"
                @upload-complete="handleImageUpload"
                aria-label="Event Image Upload"
              />
            </div>
          </section>

          <!-- CATEGORIES Section -->
          <section class="editor-section">
            <h2 class="section-header">CATEGORIES</h2>

            <div class="section-card">
              <CategorySelector
                :calendar-id="editorState.event.calendarId"
                :selected-categories="selectedCategories"
                @categories-changed="handleCategoriesChanged"
                aria-label="Select Event Categories"
              />
            </div>
          </section>

          <!-- SERIES Section -->
          <section class="editor-section">
            <h2 class="section-header">{{ t('series_section') }}</h2>

            <div class="section-card">
              <SeriesSelector
                :calendar-id="editorState.event.calendarId"
                :selected-series-id="selectedSeriesId"
                :event-id="editorState.event.id"
                @series-changed="handleSeriesChanged"
              />
            </div>
          </section>

          <!-- DATE & TIME Section -->
          <section class="editor-section">
            <h2 class="section-header">DATE & TIME</h2>

            <div class="section-card">
              <div
                class="schedule-list"
                role="group"
                aria-label="Event Schedules"
                :aria-describedby="fieldErrors.schedule ? 'event-schedule-error' : undefined"
                :aria-invalid="fieldErrors.schedule ? 'true' : undefined"
              >
                <div
                  v-for="(schedule, index) in editorState.event.schedules"
                  :key="index"
                  class="schedule-item"
                >
                  <EventRecurrenceView
                    :schedule="schedule"
                    :index="index"
                    :can-remove="editorState.event.schedules.length > 1"
                    @remove-schedule="editorState.event.dropSchedule(index)"
                  />
                </div>
              </div>

              <button
                type="button"
                class="add-schedule-btn"
                @click="editorState.event.addSchedule()"
              >
                <Plus :size="16" aria-hidden="true" />
                Add another schedule
              </button>

              <p class="schedule-help-text">
                Add multiple schedules to create events that occur at different times or with different patterns.
              </p>

              <p
                v-if="fieldErrors.schedule"
                id="event-schedule-error"
                class="form-error"
                role="alert"
              >
                {{ fieldErrors.schedule }}
              </p>

              <!-- Cancellations Panel Trigger (only for recurring events) -->
              <div
                v-if="hasRecurringSchedule"
                class="cancellations-trigger-wrapper"
              >
                <button
                  type="button"
                  class="cancellations-trigger"
                  data-testid="cancellations-trigger"
                  :aria-expanded="showCancellationsPanel"
                  aria-controls="event-cancellations-panel"
                  @click="showCancellationsPanel = !showCancellationsPanel"
                >
                  {{ tCancellations('toggle_button') }}
                </button>

                <div
                  v-if="showCancellationsPanel"
                  id="event-cancellations-panel"
                  class="cancellations-panel-wrapper"
                >
                  <EventCancellationsPanel
                    :event="editorState.event"
                  />
                </div>
              </div>
            </div>
          </section>

        </div>
      </form>
    </main>

    <!-- Error state when event failed to load -->
    <main v-else role="main" aria-label="Event Editor Error">
      <div class="error" role="alert">
        {{ editorState.err || 'Failed to load event' }}
      </div>
    </main>
  </div>

  <div v-if="showLanguagePicker">
    <language-picker :languages="availableLanguages"
                     :selectedLanguages="languages"
                     @close="closeLanguagePicker"
                     @select="handleAddLanguage" />
  </div>

  <!-- Location Picker Modal -->
  <LocationPickerModal
    v-if="showLocationPicker"
    ref="locationPickerRef"
    :locations="availableLocations"
    :spaces-by-place="locationStore.spacesByPlace"
    :selected-location-id="editorState.event?.locationId || null"
    :selected-space-id="editorState.event?.space?.id || null"
    @location-selected="handleLocationSelected"
    @create-new="createNewLocation"
    @remove-location="handleRemoveLocation"
    @close="showLocationPicker = false"
  />

  <!-- Create Location Form Modal -->
  <CreateLocationForm
    v-if="showCreateLocationForm"
    :languages="languages"
    :field-errors="locationFieldErrors"
    :submission-error="locationSubmissionError"
    @create-location="handleLocationCreated"
    @back-to-search="backToSearch"
    @close="showCreateLocationForm = false"
  />

  <!-- Unsaved Changes Confirmation Dialog -->
  <ModalLayout
    v-if="showUnsavedChangesDialog"
    :title="t('unsaved_changes_title', 'Unsaved Changes')"
    @close="cancelLeave"
  >
    <div class="unsaved-changes-confirmation">
      <p>{{ t('unsaved_changes_message', 'You have unsaved changes. Are you sure you want to leave?') }}</p>
      <div class="dialog-actions">
        <PillButton
          type="button"
          variant="ghost"
          @click="cancelLeave"
        >
          {{ t('unsaved_changes_cancel', 'Stay') }}
        </PillButton>
        <PillButton
          type="button"
          variant="secondary"
          class="danger"
          @click="confirmLeave"
        >
          {{ t('unsaved_changes_confirm', 'Leave') }}
        </PillButton>
      </div>
    </div>
  </ModalLayout>
</template>

<script setup>
import { ref, onBeforeMount, onMounted, computed, watch, nextTick } from 'vue';
import { useRouter, onBeforeRouteLeave } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { ArrowLeft, Plus } from 'lucide-vue-next';
import EventRecurrenceView from './event_recurrence.vue';
import EventCancellationsPanel from './EventCancellationsPanel.vue';
import languagePicker from '@/client/components/common/language-picker.vue';
import ImageUpload from '@/client/components/common/media/image-upload.vue';
import ImageWorkspace from '@/client/components/common/media/image-workspace.vue';
import CategorySelector from './category-selector.vue';
import SeriesSelector from './series-selector.vue';
import ModalLayout from '@/client/components/common/modal.vue';
import PillButton from '@/client/components/common/pill-button.vue';
import LanguageTabSelector from '@/client/components/common/language-tab-selector.vue';
import LocationDisplayCard from '@/client/components/common/location-display-card.vue';
import LocationPickerModal from '@/client/components/common/location-picker-modal.vue';
import CreateLocationForm from '@/client/components/common/create-location-form.vue';
import { ValidationError } from '@/common/exceptions';
import iso6391 from 'iso-639-1-dir';

// Composables
import { useEventEditor } from '@/client/composables/useEventEditor';
import { useLocationManagement } from '@/client/composables/useLocationManagement';
import { useUnsavedChanges } from '@/client/composables/useUnsavedChanges';
import { useLanguageManagement } from '@/client/composables/useLanguageManagement';

// Stores
import { useLocationStore } from '@/client/stores/locationStore';

// Props for edit mode (eventId passed from route)
const props = defineProps({
  eventId: {
    type: String,
    default: null,
  },
});

// Router
const router = useRouter();

// Translation
const { t } = useTranslation('event_editor', {
  keyPrefix: 'editor',
});
const { t: tExternalLink } = useTranslation('event_editor', {
  keyPrefix: 'external_link',
});
const { t: tCancellations } = useTranslation('event_editor', {
  keyPrefix: 'cancellations',
});

// Initialize composables
const defaultLanguage = 'en';

// Event editor composable
const {
  state: editorState,
  selectedCategories,
  selectedSeriesId,
  mediaId,
  fieldErrors,
  clearFieldError,
  initializeEvent,
  saveEvent,
  pageTitle,
} = useEventEditor(defaultLanguage);

// Location management composable
const {
  availableLocations,
  showLocationPicker,
  showCreateLocationForm,
  locationFieldErrors,
  locationSubmissionError,
  fetchLocations,
  openLocationPicker,
  selectLocation,
  createNewLocation,
  createLocation,
  removeLocation,
  backToSearch,
} = useLocationManagement();

// Location store — exposes per-Place Space cache (locationStore.spacesByPlace)
// to the picker so it can render the flat list with whole-venue + Space entries.
const locationStore = useLocationStore();

// Unsaved changes composable
const {
  isDirty,
  snapshotReady,
  showUnsavedChangesDialog,
  initializeSnapshot,
  resetSnapshot,
  checkDirtyState,
  handleBack,
  confirmLeave,
  cancelLeave,
  setupNavigationGuard,
} = useUnsavedChanges();

// Language management composable
const {
  languages,
  availableLanguages,
  currentLanguage,
  showLanguagePicker,
  addLanguage,
  removeLanguage,
  openLanguagePicker,
  closeLanguagePicker,
} = useLanguageManagement();

// Error container ref for scrolling
const errorContainer = ref(null);

// Modal refs
const locationPickerRef = ref(null);

// The dropdown shows 'more_info' when the event has no prompt set; the
// value is only persisted as urlPrompt when the user actually provides a
// URL (see handleSaveEvent, which strips urlPrompt to null when the URL
// is empty to satisfy the backend's both-or-neither rule).
const urlPromptProxy = computed({
  get: () => editorState.event?.urlPrompt ?? 'more_info',
  set: (value) => {
    if (!editorState.event) return;
    editorState.event.urlPrompt = value || null;
  },
});

/**
 * Whether the event has at least one recurring schedule. A schedule is
 * recurring when its frequency is set. Used to gate the cancellations panel
 * trigger, which is only meaningful for recurring events.
 */
const hasRecurringSchedule = computed(() => {
  if (!editorState.event?.schedules) return false;
  return editorState.event.schedules.some(
    (schedule) => schedule.frequency !== null && schedule.frequency !== undefined,
  );
});

/**
 * Visibility of the cancellations panel. Collapsed by default so the DATE &
 * TIME section stays compact for the common case.
 */
const showCancellationsPanel = ref(false);

/**
 * Translated page title
 */
const translatedPageTitle = computed(() => {
  const titleKey = pageTitle.value;
  return t(titleKey + '_title', titleKey.replace(/_/g, ' '));
});

/**
 * Language tabs that have validation errors (missing required title field).
 * Used to show a visual indicator on inactive tabs that need attention.
 */
const erroredTabs = computed(() => {
  if (!editorState.event) return [];
  return languages.value.filter((lang) => {
    const name = editorState.event.content(lang).name;
    return !name || name.trim() === '';
  });
});

/**
 * URL for a freshly-uploaded image that has not yet been persisted.
 * Allows the workspace to display the image immediately after upload.
 */
const localPreviewUrl = ref(null);

/**
 * Computed image data for the ImageWorkspace component.
 * Returns null when no image is attached (shows uploader instead).
 */
const eventImage = computed(() => {
  if (!mediaId.value || !editorState.event) return null;

  // Prefer the local preview URL for freshly-uploaded images,
  // fall back to the API media endpoint for persisted images.
  const url = localPreviewUrl.value || `/api/v1/media/${mediaId.value}`;

  return {
    url,
    mediaFocalPointX: editorState.event.mediaFocalPointX ?? 0.5,
    mediaFocalPointY: editorState.event.mediaFocalPointY ?? 0.5,
    mediaZoom: editorState.event.mediaZoom ?? 1.0,
  };
});

/**
 * Handle back button click
 */
const handleBackClick = () => {
  handleBack(router);
};

/**
 * Handle image upload completion.
 * Sets the mediaId and captures a local preview URL so the workspace
 * can display the image immediately without waiting for a server round-trip.
 */
const handleImageUpload = (results) => {
  if (results && results.length > 0 && results[0].success) {
    mediaId.value = results[0].media.id;
    // Use the blob preview URL for immediate display — the media is still
    // 'pending' on the server until the event is saved, so the API endpoint
    // would return 202.
    localPreviewUrl.value = results[0].previewUrl || `/api/v1/media/${results[0].media.id}`;
  }
};

/**
 * Handle focal point / zoom adjustments from the image workspace.
 */
const handleImageAdjust = ({ mediaFocalPointX, mediaFocalPointY, mediaZoom }) => {
  if (!editorState.event) return;
  editorState.event.mediaFocalPointX = mediaFocalPointX;
  editorState.event.mediaFocalPointY = mediaFocalPointY;
  editorState.event.mediaZoom = mediaZoom;
};

/**
 * Handle image replacement — clears the current image so the uploader re-appears.
 */
const handleImageReplace = () => {
  mediaId.value = null;
  localPreviewUrl.value = null;
};

/**
 * Handle image removal — clears the image and resets focal point to defaults.
 */
const handleImageRemove = () => {
  mediaId.value = null;
  localPreviewUrl.value = null;
  if (editorState.event) {
    editorState.event.mediaFocalPointX = 0.5;
    editorState.event.mediaFocalPointY = 0.5;
    editorState.event.mediaZoom = 1.0;
  }
};

/**
 * Handle category selection changes
 */
const handleCategoriesChanged = (categories) => {
  selectedCategories.value = categories;
};

/**
 * Handle series selection changes
 */
const handleSeriesChanged = (seriesId) => {
  selectedSeriesId.value = seriesId;
};

/**
 * Handle opening the location picker modal.
 *
 * Passes both the calendar ID (for fetching Places) and the calendar URL name
 * (for prefetching each Place's Spaces) so the picker can render its flat
 * Place + Spaces list.
 */
const handleOpenLocationPicker = async () => {
  if (editorState.event) {
    await openLocationPicker(
      editorState.event.calendarId,
      editorState.calendar?.urlName,
    );
  }
};

/**
 * Handle location selection from the picker.
 *
 * Picker emits `{ placeId, spaceId | null }` (null = whole venue, NOT undefined).
 * Pass through to the composable along with the locationStore's per-Place
 * Space cache so the composable can resolve the EventLocationSpace model.
 */
const handleLocationSelected = async (selection) => {
  if (editorState.event) {
    selectLocation(selection, editorState.event, locationStore.spacesByPlace);
  }
};

/**
 * Handle location creation from the create form
 */
const handleLocationCreated = async (locationData) => {
  if (editorState.event) {
    try {
      await createLocation(editorState.event.calendarId, locationData, editorState.event);
    }
    catch (error) {
      // ValidationError populates locationFieldErrors / locationSubmissionError
      // in the composable; surface a generic toast only for non-validation failures.
      if (!(error instanceof ValidationError)) {
        console.error('Error creating location:', error);
        editorState.err = 'Failed to create location';
      }
    }
  }
};

/**
 * Handle "Remove location" button click
 */
const handleRemoveLocation = () => {
  if (editorState.event) {
    removeLocation(editorState.event);
  }
};

/**
 * Handle adding a language
 */
const handleAddLanguage = (language) => {
  if (editorState.event) {
    addLanguage(language, editorState.event);
  }
  closeLanguagePicker();
};

/**
 * Handle removing a language — shows a confirmation dialog before removing.
 */
const handleRemoveLanguage = (language) => {
  if (!editorState.event) return;
  const languageName = iso6391.getName(language);
  const message = t(
    'remove_translation_confirm',
    `Remove the ${languageName} translation? This will permanently delete all ${languageName} content for this event.`,
    { language: languageName },
  );
  if (!window.confirm(message)) return;
  removeLanguage(language, editorState.event);
};

/**
 * Handle save event
 */
const handleSaveEvent = async () => {
  // Only persist urlPrompt when an external URL is actually set; the
  // backend requires both fields to be set together or both cleared.
  if (editorState.event) {
    const url = (editorState.event.externalUrl ?? '').trim();
    if (!url) {
      editorState.event.externalUrl = null;
      editorState.event.urlPrompt = null;
    }
    else {
      // Ensure urlPrompt reflects the proxy value (may be null if event was
      // loaded without a prompt, but the UI defaulted to 'more_info').
      editorState.event.urlPrompt = urlPromptProxy.value;
    }
  }

  await saveEvent(t, () => {
    resetSnapshot(editorState.event, selectedCategories.value, mediaId.value);
  });
  // Move focus to first errored field for keyboard/screen reader users
  await nextTick();
  if (Object.keys(fieldErrors).length > 0) {
    const firstInvalid = document.querySelector<HTMLElement>('[aria-invalid="true"]');
    firstInvalid?.focus();
  }
};

// Watch for error changes and scroll into view
watch(() => editorState.err, async (newError) => {
  if (newError) {
    await nextTick();
    errorContainer.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}, { deep: true });

// Watch for changes in event data and update dirty state
// Watch the state object to catch changes to the event and its nested properties
watch(
  () => editorState.event?._content,
  () => {
    if (snapshotReady.value && editorState.event) {
      isDirty.value = checkDirtyState(editorState.event, selectedCategories.value, mediaId.value);
    }
  },
  { deep: true },
);

// Also watch location changes
watch(
  () => editorState.event?.location,
  () => {
    if (snapshotReady.value && editorState.event) {
      isDirty.value = checkDirtyState(editorState.event, selectedCategories.value, mediaId.value);
    }
  },
  { deep: true },
);

// Also watch schedule changes
watch(
  () => editorState.event?.schedules,
  () => {
    if (snapshotReady.value && editorState.event) {
      isDirty.value = checkDirtyState(editorState.event, selectedCategories.value, mediaId.value);
    }
  },
  { deep: true },
);

// Watch for changes in selected categories
watch(
  () => selectedCategories.value,
  () => {
    if (snapshotReady.value) {
      isDirty.value = checkDirtyState(editorState.event, selectedCategories.value, mediaId.value);
    }
  },
  { deep: true },
);

// Watch for changes in media
watch(
  () => mediaId.value,
  () => {
    if (snapshotReady.value) {
      isDirty.value = checkDirtyState(editorState.event, selectedCategories.value, mediaId.value);
    }
  },
);

/**
 * Initialize event editor and then take snapshot
 */
onBeforeMount(async () => {
  await initializeEvent(
    props.eventId,
    (updatedLanguages) => {
      languages.value = updatedLanguages;
    },
    fetchLocations,
  );

  // After event is loaded, take the initial snapshot
  // initializeSnapshot already includes nextTick() waits internally
  await initializeSnapshot(editorState.event, selectedCategories.value, mediaId.value);
});

/**
 * Navigation guard to check for unsaved changes
 */
onBeforeRouteLeave((to, from, next) => {
  setupNavigationGuard(to, from, next);
});

// Expose properties for testing
defineExpose({
  isDirty,
  snapshotReady,
  showUnsavedChangesDialog,
  state: editorState,
  selectedCategories,
  selectedSeriesId,
  mediaId,
  fieldErrors,
  confirmLeave,
  cancelLeave,
  // Expose checkDirtyState for manual triggering in tests
  checkDirtyState: () => {
    isDirty.value = checkDirtyState(editorState.event, selectedCategories.value, mediaId.value);
  },
});
</script>
