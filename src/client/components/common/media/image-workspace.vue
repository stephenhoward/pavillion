<script setup lang="ts">
import { ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import { Crosshair, ZoomIn, ZoomOut, RefreshCw, Trash2 } from 'lucide-vue-next';

const { t } = useTranslation('media');

interface ImageData {
  url: string;
  mediaFocalPointX: number;
  mediaFocalPointY: number;
  mediaZoom: number;
}

const props = defineProps<{
  image: ImageData;
}>();

const emit = defineEmits<{
  adjust: [{ mediaFocalPointX: number; mediaFocalPointY: number; mediaZoom: number }];
  replace: [];
  remove: [];
}>();

const imageAreaRef = ref<HTMLElement | null>(null);
const isDraggingOnImage = ref(false);
const isDraggingFocal = ref(false);

/**
 * Clamps a value between min and max.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Computes focal point from pointer coordinates and emits adjust.
 */
function updateFocalFromPointer(clientX: number, clientY: number): void {
  if (!imageAreaRef.value) return;
  const rect = imageAreaRef.value.getBoundingClientRect();
  const x = clamp((clientX - rect.left) / rect.width, 0, 1);
  const y = clamp((clientY - rect.top) / rect.height, 0, 1);
  emit('adjust', {
    mediaFocalPointX: x,
    mediaFocalPointY: y,
    mediaZoom: props.image.mediaZoom,
  });
}

/**
 * Handles pointerdown on the image area background.
 */
function onImagePointerDown(e: PointerEvent): void {
  e.preventDefault();
  isDraggingOnImage.value = true;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  updateFocalFromPointer(e.clientX, e.clientY);
}

/**
 * Handles pointerdown on the focal point marker.
 */
function onFocalPointerDown(e: PointerEvent): void {
  e.preventDefault();
  e.stopPropagation();
  isDraggingFocal.value = true;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}

/**
 * Handles pointermove on the image area.
 */
function onImagePointerMove(e: PointerEvent): void {
  if (isDraggingOnImage.value || isDraggingFocal.value) {
    updateFocalFromPointer(e.clientX, e.clientY);
  }
}

/**
 * Handles pointerup on the image area.
 */
function onImagePointerUp(): void {
  isDraggingOnImage.value = false;
  isDraggingFocal.value = false;
}

/**
 * Handles zoom slider input changes.
 */
function onZoomInput(e: Event): void {
  const value = parseFloat((e.target as HTMLInputElement).value);
  emit('adjust', {
    mediaFocalPointX: props.image.mediaFocalPointX,
    mediaFocalPointY: props.image.mediaFocalPointY,
    mediaZoom: value,
  });
}
</script>

<template>
  <div class="image-workspace"
       role="region"
       :aria-label="t('accessibility.image_workspace')">
    <!-- Image area with focal point -->
    <div ref="imageAreaRef"
         class="image-area"
         @pointerdown="onImagePointerDown"
         @pointermove="onImagePointerMove"
         @pointerup="onImagePointerUp">
      <img :src="image.url"
           alt=""
           class="workspace-image"
           draggable="false" />
      <div class="dimming-overlay" />
      <div class="focal-point-marker"
           :class="{ dragging: isDraggingFocal }"
           :style="{
             left: `${image.mediaFocalPointX * 100}%`,
             top: `${image.mediaFocalPointY * 100}%`,
           }"
           :aria-label="t('accessibility.focal_point_marker')"
           role="slider"
           :aria-valuenow="Math.round(image.mediaFocalPointX * 100)"
           aria-valuemin="0"
           aria-valuemax="100"
           tabindex="0"
           @pointerdown="onFocalPointerDown">
        <div class="crosshair-h" />
        <div class="crosshair-v" />
      </div>
      <div class="hint-pill">
        <Crosshair :size="14"
                   aria-hidden="true" />
        <span>{{ t('workspace.focal_hint') }}</span>
      </div>
    </div>

    <!-- Zoom slider -->
    <div class="zoom-row">
      <ZoomOut :size="18"
               class="zoom-icon"
               aria-hidden="true" />
      <input type="range"
             class="zoom-slider"
             min="1"
             max="2"
             step="0.05"
             :value="image.mediaZoom"
             :aria-label="t('accessibility.zoom_slider')"
             @input="onZoomInput" />
      <ZoomIn :size="18"
              class="zoom-icon"
              aria-hidden="true" />
    </div>

    <!-- Explanatory text -->
    <p class="focal-explanation">
      {{ t('workspace.focal_explanation') }}
    </p>

    <!-- Action buttons -->
    <div class="action-buttons">
      <button class="btn btn--pill btn--secondary"
              type="button"
              @click="emit('replace')">
        <RefreshCw :size="16"
                   aria-hidden="true" />
        <span>{{ t('workspace.replace_image') }}</span>
      </button>
      <button class="btn btn--pill btn--ghost"
              type="button"
              @click="emit('remove')">
        <Trash2 :size="16"
                aria-hidden="true" />
        <span>{{ t('workspace.remove') }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use '@/client/assets/style/mixins' as *;

// Component-local design tokens
$border-radius: 0.75rem;
$transition-smooth: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);

.image-workspace {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.image-area {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 2;
  overflow: hidden;
  border-radius: $border-radius;
  border: 1px solid #e7e5e4;
  cursor: crosshair;
  touch-action: none;
  user-select: none;

  @media (prefers-color-scheme: dark) {
    border-color: #44403c;
  }
}

.workspace-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

.dimming-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.1);
  pointer-events: none;

  @media (prefers-color-scheme: dark) {
    background: rgba(0, 0, 0, 0.2);
  }
}

.focal-point-marker {
  position: absolute;
  width: 40px;
  height: 40px;
  transform: translate(-50%, -50%);
  border: 2px solid white;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.3), 0 2px 8px rgba(0, 0, 0, 0.3);
  cursor: grab;
  transition: box-shadow 0.15s ease;
  z-index: 1;

  &.dragging {
    cursor: grabbing;
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.4), 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-brand-primary);
    outline-offset: 2px;
  }
}

.crosshair-h,
.crosshair-v {
  position: absolute;
  background: white;
  box-shadow: 0 0 2px rgba(0, 0, 0, 0.4);
}

.crosshair-h {
  top: 50%;
  left: 4px;
  right: 4px;
  height: 1px;
  transform: translateY(-50%);
}

.crosshair-v {
  left: 50%;
  top: 4px;
  bottom: 4px;
  width: 1px;
  transform: translateX(-50%);
}

.hint-pill {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  border-radius: 9999px;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.8);
  pointer-events: none;
  white-space: nowrap;
}

.zoom-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0 0.25rem;
}

.zoom-icon {
  color: #a8a29e;
  flex-shrink: 0;
}

.zoom-slider {
  flex: 1;
  height: 6px;
  appearance: none;
  background: #e7e5e4;
  border-radius: 3px;
  outline: none;
  transition: background 0.2s ease;

  @media (prefers-color-scheme: dark) {
    background: #44403c;
  }

  &::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--pav-color-brand-primary);
    cursor: pointer;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
    transition: transform 0.15s ease;

    &:hover {
      transform: scale(1.15);
    }
  }

  &::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border: none;
    border-radius: 50%;
    background: var(--pav-color-brand-primary);
    cursor: pointer;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  }

  &:focus-visible {
    outline: 2px solid var(--pav-color-brand-primary);
    outline-offset: 2px;
  }
}

.focal-explanation {
  font-size: 0.75rem;
  color: #a8a29e;
  margin: 0;
  padding: 0 0.25rem;
}

.action-buttons {
  display: flex;
  align-items: center;
  gap: 0.75rem;

  @include pav-media-down(sm) {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
