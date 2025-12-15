<script setup lang="ts">
import { defineProps, reactive, ref, computed, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import MediaService, {
  UploadProgress,
  UploadResult,
  FileWithState,
  ValidationErrorCode,
  UploadErrorCode,
} from '@/client/service/media';

const emit = defineEmits(['filesChanged', 'uploadComplete']);
const mediaService = new MediaService();

const { t } = useTranslation('media');

const props = defineProps({
  calendarId: {
    type: String,
    required: true,
  },
  eventId: {
    type: String,
    required: false,
  },
  multiple: {
    type: Boolean,
    default: false,
  },
  maxFiles: {
    type: Number,
    default: 10,
  },
});

const state = reactive({
  files: [] as FileWithState[],
  isDragOver: false,
  isUploading: false,
  uploadError: null as { code: ValidationErrorCode | UploadErrorCode; parameters?: Record<string, any> } | null,
  allowedTypes: mediaService.config.allowedTypes,
  maxFileSize: mediaService.config.maxFileSize,
  allowedExtensions: mediaService.config.allowedExtensions,
});

const fileInput = ref<HTMLInputElement | null>(null);

// Computed properties
const hasFiles = computed(() => state.files.length > 0);
const currentFile = computed(() => state.files[0] || null);
const uploadProgress = computed(() => currentFile.value?.progress || 0);
const isComplete = computed(() => currentFile.value?.status === 'complete');
const isFailed = computed(() => currentFile.value?.status === 'failed');
const isUploading = computed(() => currentFile.value?.status === 'uploading');

/**
 * Formats file size for display
 */
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Auto-upload when files change
 */
watch(() => state.files, async (newFiles) => {
  const pendingFiles = newFiles.filter((f: FileWithState) => f.status === 'pending');
  if (pendingFiles.length > 0 && !state.isUploading) {
    await uploadFiles();
  }
}, { deep: true });

/**
 * Handles file selection from input or drop
 */
const preprocessAddedFiles = async (files: FileList | File[]) => {
  const fileArray = Array.from(files);

  // Clear any previous upload errors
  state.uploadError = null;

  // Validate file count
  if (!props.multiple && fileArray.length > 1) {
    state.uploadError = {
      code: ValidationErrorCode.SINGLE_FILE_ONLY,
      parameters: { maxFiles: 1 },
    };
    return;
  }

  if (state.files.length + fileArray.length > props.maxFiles) {
    state.uploadError = {
      code: ValidationErrorCode.TOO_MANY_FILES,
      parameters: { maxFiles: props.maxFiles },
    };
    return;
  }

  // Clear existing files if single mode
  if (!props.multiple) {
    state.files = [];
  }

  for (const file of fileArray) {
    const fileWithState: FileWithState = await mediaService.prepareFile(file);
    state.files.push(fileWithState);
  }

  emit('filesChanged', state.files);
};

/**
 * Handles file input change
 */
const handleFileInputChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    preprocessAddedFiles(target.files);
  }
  // Reset input so same file can be selected again
  target.value = '';
};

/**
 * Handles drag and drop events
 */
const handleDragOver = (event: DragEvent) => {
  event.preventDefault();
  event.stopPropagation();
  state.isDragOver = true;
};

const handleDragLeave = (event: DragEvent) => {
  event.preventDefault();
  event.stopPropagation();
  state.isDragOver = false;
};

const handleDrop = async (event: DragEvent) => {
  event.preventDefault();
  event.stopPropagation();
  state.isDragOver = false;

  const files = event.dataTransfer?.files;
  if (files && files.length > 0) {
    await preprocessAddedFiles(files);
  }
};

/**
 * Triggers file browser
 */
const triggerFileBrowser = () => {
  fileInput.value?.click();
};

/**
 * Removes a file / clears the upload
 */
const clearFile = () => {
  state.files = [];
  state.uploadError = null;
  emit('filesChanged', state.files);
};

/**
 * Uploads all pending files (auto-triggered)
 */
const uploadFiles = async () => {
  if (state.isUploading) return;

  const pendingFiles = state.files.filter((f: FileWithState) => f.status === 'pending' || f.status === 'failed');
  if (pendingFiles.length === 0) return;

  state.isUploading = true;

  try {
    const results: UploadResult[] = [];

    for (const fileWithState of pendingFiles) {
      fileWithState.status = 'uploading';
      fileWithState.progress = 0;

      const result = await mediaService.uploadFile(
        fileWithState.file,
        props.calendarId,
        props.eventId,
        (progress: UploadProgress) => {
          fileWithState.progress = progress.percentage;
        },
      );

      if (result.success) {
        fileWithState.status = 'complete';
        fileWithState.progress = 100;
      }
      else {
        fileWithState.status = 'failed';
        fileWithState.error = result.error;
      }

      results.push(result);
    }

    emit('uploadComplete', results);
  }
  finally {
    state.isUploading = false;
  }
};

/**
 * Retries upload for failed file
 */
const retryUpload = async () => {
  if (!currentFile.value || currentFile.value.status !== 'failed') return;

  currentFile.value.status = 'pending';
  currentFile.value.progress = 0;
  currentFile.value.error = undefined;

  await uploadFiles();
};

/**
 * Handles keyboard navigation
 */
const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    triggerFileBrowser();
  }
};
</script>

<template>
  <div class="image-upload">
    <!-- Upload Zone -->
    <div
      class="upload-zone"
      :class="{
        'drag-over': state.isDragOver,
        'has-preview': hasFiles,
        'uploading': isUploading,
        'complete': isComplete,
        'failed': isFailed
      }"
      :aria-label="t('accessibility.drag_drop_zone')"
      role="button"
      tabindex="0"
      @click="!hasFiles && triggerFileBrowser()"
      @keydown="handleKeyDown"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <!-- Preview state with image -->
      <div v-if="hasFiles && currentFile" class="preview-state">
        <!-- Image preview -->
        <div class="preview-image-wrapper">
          <img
            v-if="currentFile.preview"
            :src="currentFile.preview"
            :alt="currentFile.file.name"
            class="preview-image"
          />
          <div v-else class="preview-placeholder">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21,15 16,10 5,21"/>
            </svg>
          </div>

          <!-- Upload progress overlay -->
          <div v-if="isUploading" class="upload-progress-overlay">
            <svg class="progress-ring" viewBox="0 0 100 100">
              <circle class="progress-ring-bg" cx="50" cy="50" r="42"/>
              <circle
                class="progress-ring-fill"
                cx="50"
                cy="50"
                r="42"
                :style="{ strokeDashoffset: 264 - (264 * uploadProgress / 100) }"
              />
            </svg>
            <span class="progress-percentage">{{ Math.round(uploadProgress) }}%</span>
          </div>

          <!-- Success overlay -->
          <div v-if="isComplete" class="success-overlay">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>

          <!-- Failed overlay -->
          <div v-if="isFailed" class="failed-overlay">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
          </div>
        </div>

        <!-- File info bar -->
        <div class="file-info-bar">
          <div class="file-details">
            <span class="file-name">{{ currentFile.file.name }}</span>
            <span class="file-size">{{ formatFileSize(currentFile.file.size) }}</span>
          </div>
          <div class="file-actions">
            <button
              v-if="isFailed"
              type="button"
              class="action-btn retry"
              @click.stop="retryUpload"
              :aria-label="t('accessibility.retry_upload', { filename: currentFile.file.name })"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              <span>{{ t('retry') }}</span>
            </button>
            <button
              type="button"
              class="action-btn change"
              @click.stop="triggerFileBrowser"
              :aria-label="t('accessibility.replace_file')"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <span>{{ t('replace') }}</span>
            </button>
            <button
              type="button"
              class="action-btn remove"
              @click.stop="clearFile"
              :aria-label="t('accessibility.remove_file', { filename: currentFile.file.name })"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Error message -->
        <div v-if="currentFile.error" class="error-banner" role="alert">
          {{ t(`errors.${currentFile.error.code}`, currentFile.error.parameters || {}) }}
        </div>
      </div>

      <!-- Empty state -->
      <div v-else class="empty-state">
        <div class="upload-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <div class="upload-text">
          <p class="primary">{{ t('upload.drag_drop_text', { count: props.multiple ? 2 : 1 }) }}</p>
          <p class="secondary">{{ t('upload.or') }} <span class="browse-link">{{ t('upload.click_to_select', { count: props.multiple ? 2 : 1 }) }}</span></p>
        </div>
        <div class="format-hint">
          <span>{{ state.allowedExtensions.join(' · ') }}</span>
          <span class="separator">•</span>
          <span>{{ t('help.max_file_size', { maxSize: formatFileSize(state.maxFileSize) }) }}</span>
        </div>
      </div>
    </div>

    <!-- Hidden file input -->
    <input
      ref="fileInput"
      type="file"
      :multiple="props.multiple"
      :accept="state.allowedTypes.join(',')"
      :aria-label="t('accessibility.file_input')"
      class="file-input"
      @change="handleFileInputChange"
    />

    <!-- Validation Error Display -->
    <div v-if="state.uploadError"
         class="validation-error"
         role="alert"
         aria-live="polite">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span>{{ t(`errors.${state.uploadError.code}`, state.uploadError.parameters || {}) }}</span>
      <button type="button" class="dismiss" @click="state.uploadError = null">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/client/assets/mixins' as *;

// Design tokens
$accent-color: #e67e22;
$accent-color-light: #f39c12;
$success-color: #27ae60;
$error-color: #e74c3c;
$border-radius: 16px;
$transition-smooth: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);

.image-upload {
  width: 100%;
}

.file-input {
  display: none;
}

.upload-zone {
  position: relative;
  border: 2px dashed rgba(0, 0, 0, 0.15);
  border-radius: $border-radius;
  background: linear-gradient(135deg, #fafafa 0%, #f5f5f5 100%);
  cursor: pointer;
  transition: $transition-smooth;
  overflow: hidden;

  @include dark-mode {
    border-color: rgba(255, 255, 255, 0.15);
    background: linear-gradient(135deg, #2a2a2a 0%, #1f1f1f 100%);
  }

  &:hover:not(.has-preview) {
    border-color: $accent-color;
    background: linear-gradient(135deg, #fff8f0 0%, #fef5ed 100%);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(230, 126, 34, 0.15);

    @include dark-mode {
      background: linear-gradient(135deg, #2d2520 0%, #1f1a15 100%);
    }

    .upload-icon svg {
      transform: translateY(-4px);
      color: $accent-color;
    }
  }

  &:focus {
    outline: none;
    border-color: $accent-color;
    box-shadow: 0 0 0 4px rgba(230, 126, 34, 0.2);
  }

  &.drag-over {
    border-color: $accent-color;
    border-style: solid;
    background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%);
    transform: scale(1.02);
    box-shadow: 0 12px 32px rgba(230, 126, 34, 0.25);

    @include dark-mode {
      background: linear-gradient(135deg, #3d2d20 0%, #2d2015 100%);
    }

    .upload-icon svg {
      animation: bounce 0.5s ease infinite;
    }
  }

  &.has-preview {
    border: none;
    cursor: default;
    background: #1a1a1a;
  }

  &.complete {
    .preview-image-wrapper {
      &::after {
        content: '';
        position: absolute;
        inset: 0;
        border: 3px solid $success-color;
        border-radius: $border-radius $border-radius 0 0;
        pointer-events: none;
      }
    }
  }

  &.failed {
    .preview-image-wrapper {
      &::after {
        content: '';
        position: absolute;
        inset: 0;
        border: 3px solid $error-color;
        border-radius: $border-radius $border-radius 0 0;
        pointer-events: none;
      }
    }
  }
}

// Empty state styling
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  gap: 16px;
}

.upload-icon {
  color: #999;
  transition: $transition-smooth;

  @include dark-mode {
    color: #666;
  }

  svg {
    transition: $transition-smooth;
  }
}

.upload-text {
  text-align: center;

  .primary {
    margin: 0 0 4px 0;
    font-size: 16px;
    font-weight: $font-medium;
    color: #333;

    @include dark-mode {
      color: #ddd;
    }
  }

  .secondary {
    margin: 0;
    font-size: 14px;
    color: #777;

    @include dark-mode {
      color: #888;
    }
  }

  .browse-link {
    color: $accent-color;
    font-weight: $font-medium;
    text-decoration: underline;
    text-underline-offset: 2px;

    &:hover {
      color: $accent-color-light;
    }
  }
}

.format-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.5px;

  @include dark-mode {
    color: #666;
  }

  .separator {
    opacity: 0.5;
  }
}

// Preview state styling
.preview-state {
  display: flex;
  flex-direction: column;
}

.preview-image-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  max-height: 300px;
  background: #0a0a0a;
  border-radius: $border-radius $border-radius 0 0;
  overflow: hidden;
}

.preview-image {
  width: 100%;
  height: 100%;
  max-height: 300px;
  object-fit: contain;
}

.preview-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 200px;
  color: #555;
}

// Progress overlay
.upload-progress-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
}

.progress-ring {
  width: 80px;
  height: 80px;
  transform: rotate(-90deg);
}

.progress-ring-bg {
  fill: none;
  stroke: rgba(255, 255, 255, 0.2);
  stroke-width: 6;
}

.progress-ring-fill {
  fill: none;
  stroke: $accent-color;
  stroke-width: 6;
  stroke-linecap: round;
  stroke-dasharray: 264;
  transition: stroke-dashoffset 0.3s ease;
}

.progress-percentage {
  position: absolute;
  font-size: 18px;
  font-weight: $font-bold;
  color: white;
}

// Success overlay
.success-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(39, 174, 96, 0.85);
  color: white;
  animation: fadeIn 0.3s ease;

  svg {
    animation: checkmark 0.4s ease 0.1s both;
  }
}

// Failed overlay
.failed-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(231, 76, 60, 0.85);
  color: white;
  animation: fadeIn 0.3s ease;
}

// File info bar
.file-info-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #1a1a1a;
  border-radius: 0 0 $border-radius $border-radius;

  @include dark-mode {
    background: #1a1a1a;
  }
}

.file-details {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.file-name {
  font-size: 13px;
  font-weight: $font-medium;
  color: white;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-size {
  font-size: 11px;
  color: #888;
}

.file-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: none;
  border-radius: 8px;
  font-size: 12px;
  font-weight: $font-medium;
  cursor: pointer;
  transition: $transition-smooth;
  background: rgba(255, 255, 255, 0.1);
  color: #ccc;

  &:hover {
    background: rgba(255, 255, 255, 0.2);
    color: white;
  }

  &.retry {
    background: rgba(230, 126, 34, 0.2);
    color: $accent-color;

    &:hover {
      background: $accent-color;
      color: white;
    }
  }

  &.change {
    background: rgba(255, 255, 255, 0.1);

    &:hover {
      background: rgba(255, 255, 255, 0.2);
    }
  }

  &.remove {
    padding: 8px;

    &:hover {
      background: rgba(231, 76, 60, 0.3);
      color: $error-color;
    }
  }

  span {
    @media (max-width: 500px) {
      display: none;
    }
  }
}

// Error banner
.error-banner {
  padding: 12px 16px;
  background: rgba(231, 76, 60, 0.15);
  color: $error-color;
  font-size: 13px;
  text-align: center;
}

// Validation error
.validation-error {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding: 12px 16px;
  background: rgba(231, 76, 60, 0.1);
  border: 1px solid rgba(231, 76, 60, 0.3);
  border-radius: 10px;
  font-size: 13px;
  color: $error-color;

  @include dark-mode {
    background: rgba(231, 76, 60, 0.15);
  }

  svg {
    flex-shrink: 0;
  }

  span {
    flex: 1;
  }

  .dismiss {
    flex-shrink: 0;
    padding: 4px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: $error-color;
    cursor: pointer;
    transition: background 0.2s;

    &:hover {
      background: rgba(231, 76, 60, 0.2);
    }
  }
}

// Animations
@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes checkmark {
  0% {
    transform: scale(0);
    opacity: 0;
  }
  50% {
    transform: scale(1.2);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

// Mobile responsiveness
@media (max-width: 500px) {
  .empty-state {
    padding: 32px 16px;
  }

  .file-info-bar {
    flex-direction: column;
    gap: 12px;
    align-items: stretch;
  }

  .file-actions {
    justify-content: center;
  }

  .action-btn {
    flex: 1;
    justify-content: center;
  }
}
</style>
