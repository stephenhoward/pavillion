<script setup lang="ts">
/**
 * DoorPlus Icon
 *
 * Custom Lucide-style icon used by the location picker's per-Place
 * "add space" action. Composes Lucide's closed-door silhouette with a
 * Lucide-style "+" badge replacing the lock badge from DoorClosedLocked.
 *
 * Door paths are inlined (not imported from lucide-vue-next) so the
 * inline-end badge can be precisely placed. The default attribute set
 * mirrors lucide-vue-next so this icon sits next to existing Lucide
 * icons (DoorOpen, MapPin, Plus, etc.) without visual drift.
 *
 * Decorative by default (aria-hidden); the calling button supplies the
 * accessible label.
 */

withDefaults(defineProps<{
  size?: number;
}>(), {
  size: 24,
});
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <!-- Closed-door silhouette (lucide DoorClosedLocked door paths) -->
    <path d="M18 9V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14" />
    <path d="M2 20h8" />
    <path d="M10 12h.01" />
    <!-- Plus badge in the inline-end corner where the lock would sit -->
    <path d="M15 18h6" />
    <path d="M18 15v6" />
  </svg>
</template>
