<script setup lang="ts">
import { defineProps, reactive, ref, computed, onMounted, onUnmounted } from 'vue';
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
  files: [],
  isDragOver: false,
  isSinglePreviewDragOver: false,
  isUploading: false,
  uploadError: null as { code: ValidationErrorCode | UploadErrorCode; parameters?: Record<string, any> } | null,
  allowedTypes: mediaService.config.allowedTypes,
  maxFileSize: mediaService.config.maxFileSize,
  allowedExtensions: mediaService.config.allowedExtensions,
});

const fileInput = ref<HTMLInputElement | null>(null);


// Computed properties
const hasFiles = computed(() => state.files.length > 0);
const singleFilePreview = computed(() => {
  if (!props.multiple && state.files.length === 1) {
    return state.files[0];
  }
  return null;
});

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
};

/**
 * Handles drag and drop events
 */
const handleDragOver = (event: DragEvent) => {
  event.preventDefault();
  event.stopPropagation();

  // If we have a single file preview, don't set the outer drag state
  // The inner preview handlers will manage the drag state
  if (!singleFilePreview.value) {
    state.isDragOver = true;
  }
};

const handleDragLeave = (event: DragEvent) => {
  event.preventDefault();
  event.stopPropagation();

  // Only clear outer drag state if we don't have single file preview
  if (!singleFilePreview.value) {
    state.isDragOver = false;
  }
};

const handleDrop = async (event: DragEvent) => {
  event.preventDefault();
  event.stopPropagation();

  // Only clear outer drag state if we don't have single file preview
  if (!singleFilePreview.value) {
    state.isDragOver = false;
  }

  const files = event.dataTransfer?.files;
  if (files && files.length > 0) {
    await preprocessAddedFiles(files);
  }
};

/**
 * Handles drag and drop events specifically for single file preview
 */
const handleSinglePreviewDragOver = (event: DragEvent) => {
  event.preventDefault();
  event.stopPropagation();
  state.isSinglePreviewDragOver = true;
};

const handleSinglePreviewDragLeave = (event: DragEvent) => {
  event.preventDefault();
  event.stopPropagation();
  state.isSinglePreviewDragOver = false;
};

const handleSinglePreviewDrop = async (event: DragEvent) => {
  event.preventDefault();
  event.stopPropagation();
  state.isSinglePreviewDragOver = false;

  const files = event.dataTransfer?.files;
  if (files && files.length > 0) {
    // In single file mode, replace the existing file
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
 * Removes a file from the upload queue
 */
const removeFile = (fileId: string) => {
  const index = state.files.findIndex((f: FileWithState) => f.id === fileId);
  if (index !== -1) {
    state.files.splice(index, 1);

    // Clear upload error if removing files resolves the issue
    if (state.uploadError &&
        (state.uploadError.code === ValidationErrorCode.TOO_MANY_FILES ||
         state.uploadError.code === ValidationErrorCode.SINGLE_FILE_ONLY)) {
      state.uploadError = null;
    }

    emit('filesChanged', state.files);
  }
};

/**
 * Uploads all pending files
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
 * Retries upload for a failed file
 */
const retryFile = async (fileId: string) => {
  const fileWithState = state.files.find((f: FileWithState) => f.id === fileId);
  if (!fileWithState || fileWithState.status !== 'failed') return;

  fileWithState.status = 'pending';
  fileWithState.progress = 0;
  fileWithState.error = undefined;

  uploadFiles();
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
        'has-files': hasFiles,
        'single-mode': !props.multiple,
        'single-with-preview': singleFilePreview
      }"
      :aria-label="t('accessibility.drag_drop_zone')"
      role="button"
      tabindex="0"
      @click="triggerFileBrowser"
      @keydown="handleKeyDown"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <!-- Single file preview mode -->
      <div
        v-if="singleFilePreview"
        class="single-file-preview"
        :class="{ 'drag-over': state.isSinglePreviewDragOver }"
        @dragover="handleSinglePreviewDragOver"
        @dragleave="handleSinglePreviewDragLeave"
        @drop="handleSinglePreviewDrop"
      >
        <div class="preview-container">
          <img
            v-if="singleFilePreview.preview"
            :src="singleFilePreview.preview"
            :alt="t('accessibility.file_preview', { filename: singleFilePreview.file.name })"
            class="preview-image"
          />
          <div v-else class="preview-placeholder">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <rect x="3"
                    y="3"
                    width="18"
                    height="18"
                    rx="2"
                    ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21,15 16,10 5,21"/>
            </svg>
          </div>
        </div>

        <div class="file-overlay">
          <div class="file-info">
            <div class="file-name">{{ singleFilePreview.file.name }}</div>
            <div class="file-size">{{ formatFileSize(singleFilePreview.file.size) }}</div>
            <div class="file-status" :class="`status-${singleFilePreview.status}`">
              {{ t(`status.${singleFilePreview.status}`) }}
            </div>
          </div>

          <!-- Progress Bar for single file -->
          <div
            v-if="singleFilePreview.status === 'uploading'"
            class="progress-container"
          >
            <div
              class="progress-bar"
              :style="{ width: `${singleFilePreview.progress}%` }"
              :aria-label="t('accessibility.upload_progress', {
                filename: singleFilePreview.file.name,
                percentage: singleFilePreview.progress
              })"
              role="progressbar"
              :aria-valuenow="singleFilePreview.progress"
              aria-valuemin="0"
              aria-valuemax="100"
            />
            <span class="progress-text">{{ singleFilePreview.progress }}%</span>
          </div>

          <!-- Error Message for single file -->
          <div v-if="singleFilePreview.error" class="error-message">
            {{ t(`errors.${singleFilePreview.error.code}`, singleFilePreview.error.parameters || {}) }}
          </div>

          <div class="file-actions">
            <button
              v-if="singleFilePreview.status === 'failed'"
              type="button"
              class="action-button retry-button"
              :aria-label="t('accessibility.retry_upload', { filename: singleFilePreview.file.name })"
              @click.stop="retryFile(singleFilePreview.id)"
            >
              {{ t('retry') }}
            </button>

            <button
              v-if="singleFilePreview.status !== 'uploading'"
              type="button"
              class="action-button remove-button"
              :aria-label="t('accessibility.remove_file', { filename: singleFilePreview.file.name })"
              @click.stop="removeFile(singleFilePreview.id)"
            >
              {{ t('remove') }}
            </button>

            <button
              type="button"
              class="action-button replace-button"
              :aria-label="t('accessibility.replace_file')"
              @click.stop="triggerFileBrowser"
            >
              {{ t('replace') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Default upload content -->
      <div v-else class="upload-content">
        <div class="upload-icon">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3"
                  y="3"
                  width="18"
                  height="18"
                  rx="2"
                  ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21,15 16,10 5,21"/>
          </svg>
        </div>

        <div class="upload-text">
          <p class="primary-text">{{ t('upload.drag_drop_text', { count: props.multiple ? 2 : 1 }) }}</p>
          <p class="secondary-text">
            {{ t('upload.or') }}
            <span class="browse-link">{{ t('upload.click_to_select', { count: props.multiple ? 2 : 1 }) }}</span>
          </p>
        </div>

        <button
          type="button"
          class="browse-button"
          @click.stop="triggerFileBrowser"
        >
          {{ t('upload.browse_files') }}
        </button>
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

    <!-- Upload Error Display -->
    <div v-if="state.uploadError"
         class="upload-error"
         role="alert"
         aria-live="polite"
         :id="`upload-error-${props.calendarId}`">
      <div class="error-icon" aria-hidden="true">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10"/>
          <line
            x1="15"
            y1="9"
            x2="9"
            y2="15"
          />
          <line
            x1="9"
            y1="9"
            x2="15"
            y2="15"
          />
        </svg>
      </div>
      <div class="error-message">
        {{ t(`errors.${state.uploadError.code}`, state.uploadError.parameters || {}) }}
      </div>
      <button
        type="button"
        class="error-dismiss"
        :aria-label="t('accessibility.dismiss_error')"
        @click="state.uploadError = null"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line
            x1="18"
            y1="6"
            x2="6"
            y2="18"
          />
          <line
            x1="6"
            y1="6"
            x2="18"
            y2="18"
          />
        </svg>
      </button>
    </div>

    <!-- File List (Multiple mode only) -->
    <div v-if="hasFiles && props.multiple" class="file-list">
      <div
        v-for="fileWithState in state.files"
        :key="fileWithState.id"
        class="file-item"
        :class="`status-${fileWithState.status}`"
      >
        <!-- File Preview -->
        <div class="file-preview">
          <img
            v-if="fileWithState.preview"
            :src="fileWithState.preview"
            :alt="t('accessibility.file_preview', { filename: fileWithState.file.name })"
            class="preview-image"
          />
          <div v-else class="preview-placeholder">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <rect x="3"
                    y="3"
                    width="18"
                    height="18"
                    rx="2"
                    ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21,15 16,10 5,21"/>
            </svg>
          </div>
        </div>

        <!-- File Info -->
        <div class="file-info">
          <div class="file-name">{{ fileWithState.file.name }}</div>
          <div class="file-details">
            <span class="file-size">{{ formatFileSize(fileWithState.file.size) }}</span>
            <span class="file-status">{{ t(`status.${fileWithState.status}`) }}</span>
          </div>

          <!-- Progress Bar -->
          <div
            v-if="fileWithState.status === 'uploading'"
            class="progress-container"
          >
            <div
              class="progress-bar"
              :style="{ width: `${fileWithState.progress}%` }"
              :aria-label="t('accessibility.upload_progress', {
                filename: fileWithState.file.name,
                percentage: fileWithState.progress
              })"
              role="progressbar"
              :aria-valuenow="fileWithState.progress"
              aria-valuemin="0"
              aria-valuemax="100"
            />
            <span class="progress-text">{{ fileWithState.progress }}%</span>
          </div>

          <!-- Error Message -->
          <div v-if="fileWithState.error"
               class="error-message"
               role="alert"
               aria-live="polite"
               :id="`file-error-${fileWithState.id}`">
            {{ t(`errors.${fileWithState.error.code}`, fileWithState.error.parameters || {}) }}
          </div>
        </div>

        <!-- File Actions -->
        <div class="file-actions">
          <button
            v-if="fileWithState.status === 'failed'"
            type="button"
            class="action-button retry-button"
            :aria-label="t('accessibility.retry_upload', { filename: fileWithState.file.name })"
            @click="retryFile(fileWithState.id)"
          >
            {{ t('retry') }}
          </button>

          <button
            v-if="fileWithState.status !== 'uploading'"
            type="button"
            class="action-button remove-button"
            :aria-label="t('accessibility.remove_file', { filename: fileWithState.file.name })"
            @click="removeFile(fileWithState.id)"
          >
            {{ t('remove') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Upload Controls -->
    <div v-if="hasFiles && (props.multiple || (!props.multiple && singleFilePreview && singleFilePreview.status !== 'complete'))" class="upload-controls">
      <button
        type="button"
        class="upload-button primary"
        :disabled="state.isUploading || !state.files.some((f: FileWithState) => f.status === 'pending' || f.status === 'failed')"
        @click="uploadFiles"
      >
        <span v-if="state.isUploading">{{ t('uploading') }}</span>
        <span v-else>{{ t('upload.upload_files', { count: props.multiple ? 2 : 1 }) }}</span>
      </button>
    </div>

    <!-- Help Text -->
    <div class="upload-help">
      <p class="help-text">{{ t('help.supported_formats') }}: {{ state.allowedExtensions.join(', ') }}</p>
      <p class="help-text">{{ t('help.max_file_size', { maxSize: formatFileSize(state.maxFileSize) }) }}</p>
      <p v-if="props.multiple" class="help-text">{{ t('help.drag_drop_instructions') }}</p>
      <p v-else class="help-text">{{ t('help.drag_drop_instructions_single') }}</p>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/client/assets/mixins' as *;

.image-upload {
  width: 100%;
  max-width: 600px;
}

.upload-zone {
  border: 2px dashed #ccc;
  border-radius: 12px;
  padding: 2rem;
  text-align: center;
  background: $light-mode-panel-background;
  cursor: pointer;
  transition: all 0.2s ease-in-out;

  @media (prefers-color-scheme: dark) {
    border-color: $dark-mode-border;
    background: $dark-mode-background;
  }

  &:hover {
    border-color: #007acc;
    background: rgba(0, 122, 204, 0.05);
  }

  &:focus {
    outline: 2px solid #007acc;
    outline-offset: 2px;
  }

  &.drag-over {
    border-color: #007acc;
    background: rgba(0, 122, 204, 0.1);
    transform: scale(1.02);
  }

  &.has-files {
    margin-bottom: 1.5rem;
  }

  &.single-with-preview {
    padding: 0;
    border: 2px solid $light-mode-border;
    min-height: 200px;
    position: relative;
    overflow: hidden;

    @media (prefers-color-scheme: dark) {
      border-color: $dark-mode-border;
    }

    &:hover {
      border-color: #007acc;
    }

    &.drag-over {
      border-color: #007acc;
      &::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 122, 204, 0.1);
        z-index: 2;
      }
    }
  }
}

.upload-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.upload-icon {
  color: $light-mode-secondary-text;

  @media (prefers-color-scheme: dark) {
    color: $dark-mode-secondary-text;
  }
}

.upload-text {
  .primary-text {
    margin: 0 0 0.5rem 0;
    font-size: 1.1rem;
    font-weight: $font-medium;
    color: $light-mode-text;

    @media (prefers-color-scheme: dark) {
      color: $dark-mode-text;
    }
  }

  .secondary-text {
    margin: 0;
    color: $light-mode-secondary-text;

    @media (prefers-color-scheme: dark) {
      color: $dark-mode-secondary-text;
    }
  }

  .browse-link {
    color: #007acc;
    text-decoration: underline;
  }
}

.browse-button {
  padding: 0.75rem 1.5rem;
  background: var(--pav-color-interactive-primary);
  color: white;
  border: none;
  border-radius: 6px;
  font-weight: $font-medium;
  cursor: pointer;
  transition: background-color 0.2s ease-in-out;

  &:hover {
    background: #005a9e;
  }

  &:focus {
    outline: 2px solid #007acc;
    outline-offset: 2px;
  }
}

.file-input {
  display: none;
}

.single-file-preview {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 200px;
  display: flex;
  flex-direction: column;
  cursor: pointer;

  &.drag-over {
    &::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 122, 204, 0.1);
      border: 2px solid #007acc;
      border-radius: 8px;
      z-index: 3;
    }
  }

  .preview-container {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: $light-mode-panel-background;

    @media (prefers-color-scheme: dark) {
      background: $dark-mode-background;
    }

    .preview-image {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }

    .preview-placeholder {
      width: 80px;
      height: 80px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: $light-mode-secondary-text;

      @media (prefers-color-scheme: dark) {
        color: $dark-mode-secondary-text;
      }
    }
  }

  .file-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
    color: white;
    padding: 1rem;

    .file-info {
      margin-bottom: 0.75rem;

      .file-name {
        font-weight: $font-medium;
        font-size: 0.95rem;
        margin-bottom: 0.25rem;
        word-break: break-word;
      }

      .file-size {
        font-size: 0.875rem;
        opacity: 0.9;
        margin-right: 1rem;
      }

      .file-status {
        font-size: 0.875rem;
        opacity: 0.9;

        &.status-complete {
          color: #28a745;
        }

        &.status-failed {
          color: #dc3545;
        }

        &.status-uploading {
          color: #007acc;
        }
      }
    }

    .progress-container {
      margin-bottom: 0.75rem;
      position: relative;
      height: 4px;
      background: rgba(255, 255, 255, 0.3);
      border-radius: 2px;
      overflow: hidden;

      .progress-bar {
        height: 100%;
        background: #007acc;
        transition: width 0.2s ease-in-out;
      }

      .progress-text {
        position: absolute;
        top: -1.5rem;
        right: 0;
        font-size: 0.75rem;
        color: white;
      }
    }

    .error-message {
      margin-bottom: 0.75rem;
      font-size: 0.875rem;
      color: #dc3545;
      background: rgba(220, 53, 69, 0.2);
      padding: 0.5rem;
      border-radius: 4px;
    }

    .file-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;

      .action-button {
        padding: 0.5rem 1rem;
        border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: 4px;
        font-size: 0.875rem;
        cursor: pointer;
        transition: all 0.2s ease-in-out;
        background: rgba(255, 255, 255, 0.1);
        color: white;

        &:hover {
          background: rgba(255, 255, 255, 0.2);
          border-color: rgba(255, 255, 255, 0.5);
        }

        &.retry-button {
          border-color: #007acc;
          background: rgba(0, 122, 204, 0.2);

          &:hover {
            background: #007acc;
          }
        }

        &.remove-button {
          border-color: #dc3545;
          background: rgba(220, 53, 69, 0.2);

          &:hover {
            background: #dc3545;
          }
        }

        &.replace-button {
          border-color: #28a745;
          background: rgba(40, 167, 69, 0.2);

          &:hover {
            background: #28a745;
          }
        }
      }
    }
  }
}

.file-list {
  margin-top: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid $light-mode-border;
  border-radius: 8px;
  background: $light-mode-panel-background;

  @media (prefers-color-scheme: dark) {
    border-color: $dark-mode-border;
    background: $dark-mode-background;
  }

  &.status-complete {
    border-color: #28a745;
  }

  &.status-failed {
    border-color: #dc3545;
  }

  &.status-uploading {
    border-color: #007acc;
  }
}

.file-preview {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 4px;
  overflow: hidden;

  .preview-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .preview-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: $light-mode-selected-background;
    color: $light-mode-secondary-text;

    @media (prefers-color-scheme: dark) {
      background: $dark-mode-selected-background;
      color: $dark-mode-secondary-text;
    }
  }
}

.file-info {
  flex: 1;
  min-width: 0;

  .file-name {
    font-weight: $font-medium;
    color: $light-mode-text;
    word-break: break-word;

    @media (prefers-color-scheme: dark) {
      color: $dark-mode-text;
    }
  }

  .file-details {
    display: flex;
    gap: 1rem;
    margin-top: 0.25rem;
    font-size: 0.875rem;
    color: $light-mode-secondary-text;

    @media (prefers-color-scheme: dark) {
      color: $dark-mode-secondary-text;
    }
  }
}

.progress-container {
  margin-top: 0.5rem;
  position: relative;
  height: 4px;
  background: $light-mode-selected-background;
  border-radius: 2px;
  overflow: hidden;

  @media (prefers-color-scheme: dark) {
    background: $dark-mode-selected-background;
  }

  .progress-bar {
    height: 100%;
    background: #007acc;
    transition: width 0.2s ease-in-out;
  }

  .progress-text {
    position: absolute;
    top: -1.5rem;
    right: 0;
    font-size: 0.75rem;
    color: $light-mode-secondary-text;

    @media (prefers-color-scheme: dark) {
      color: $dark-mode-secondary-text;
    }
  }
}

.error-message {
  margin-top: 0.5rem;
  font-size: 0.875rem;
  color: #dc3545;
}

.file-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

.action-button {
  padding: 0.5rem 1rem;
  border: 1px solid;
  border-radius: 4px;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease-in-out;

  &.retry-button {
    border-color: #007acc;
    color: #007acc;
    background: transparent;

    &:hover {
      background: #007acc;
      color: white;
    }
  }

  &.remove-button {
    border-color: $light-mode-border;
    color: $light-mode-secondary-text;
    background: transparent;

    @media (prefers-color-scheme: dark) {
      border-color: $dark-mode-border;
      color: $dark-mode-secondary-text;
    }

    &:hover {
      border-color: #dc3545;
      color: #dc3545;
    }
  }
}

.upload-controls {
  margin-top: 1.5rem;
  text-align: center;
}

.upload-button {
  padding: 0.75rem 2rem;
  border: none;
  border-radius: 6px;
  font-weight: $font-medium;
  cursor: pointer;
  transition: all 0.2s ease-in-out;

  &.primary {
    background: #28a745;
    color: white;

    &:hover:not(:disabled) {
      background: #218838;
    }

    &:disabled {
      background: $light-mode-selected-background;
      color: $light-mode-secondary-text;
      cursor: not-allowed;

      @media (prefers-color-scheme: dark) {
        background: $dark-mode-selected-background;
        color: $dark-mode-secondary-text;
      }
    }
  }
}

.upload-help {
  margin-top: 1rem;

  .help-text {
    margin: 0.25rem 0;
    font-size: 0.875rem;
    color: $light-mode-secondary-text;

    @media (prefers-color-scheme: dark) {
      color: $dark-mode-secondary-text;
    }
  }
}

.upload-error {
  margin-top: 1rem;
  padding: 1rem;
  background: rgba(220, 53, 69, 0.1);
  border: 1px solid #dc3545;
  border-radius: 6px;
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;

  @media (prefers-color-scheme: dark) {
    background: rgba(220, 53, 69, 0.15);
  }

  .error-icon {
    flex-shrink: 0;
    color: #dc3545;
    margin-top: 0.125rem;
  }

  .error-message {
    flex: 1;
    color: #dc3545;
    font-weight: $font-medium;
    line-height: 1.4;
  }

  .error-dismiss {
    flex-shrink: 0;
    background: transparent;
    border: none;
    color: #dc3545;
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 3px;
    transition: background-color 0.2s ease-in-out;

    &:hover {
      background: rgba(220, 53, 69, 0.2);
    }

    &:focus {
      outline: 2px solid #dc3545;
      outline-offset: 2px;
    }
  }
}

// Mobile responsiveness
@media (max-width: 768px) {
  .upload-zone {
    padding: 1.5rem 1rem;

    &.single-with-preview {
      min-height: 150px;

      .file-overlay {
        position: static;
        background: rgba(0, 0, 0, 0.85);
        border-radius: 0 0 8px 8px;

        .file-actions {
          flex-direction: column;

          .action-button {
            text-align: center;
          }
        }
      }

      .preview-container {
        min-height: 120px;

        .preview-placeholder {
          width: 60px;
          height: 60px;
        }
      }
    }
  }

  .file-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;

    .file-preview {
      align-self: center;
    }

    .file-actions {
      align-self: stretch;
      justify-content: center;
    }
  }

  .upload-button {
    width: 100%;
  }
}
</style>
