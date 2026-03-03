<template>
  <div
    v-if="error"
    role="alert"
    aria-live="polite"
    class="error-alert"
  >
    {{ error }}
  </div>
</template>

<script setup>
defineProps({
  error: {
    type: String,
    default: '',
  },
});
</script>

<style scoped lang="scss">
.error-alert {
  margin-bottom: 2rem; /* 32px */
  padding: 1rem; /* 16px */
  border-radius: 1rem; /* 16px - rounded-2xl */
  background-color: rgb(254 242 242); /* red-50 */
  border: 1px solid rgb(254 202 202); /* red-200 */
  color: rgb(220 38 38); /* red-600 */
  font-size: 1rem; /* 16px */

  @media (prefers-color-scheme: dark) {
    background-color: rgb(127 29 29 / 0.5); /* red-950/50 */
    border-color: rgb(127 29 29); /* red-900 */
    color: rgb(252 165 165); /* red-300 */
  }
}
</style>
