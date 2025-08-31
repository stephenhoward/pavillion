<template>
  <div class="loading-message text-center" aria-role="status">
    <p class="text-secondary"> ⏱ {{ props.description }}</p>
  </div>
</template>

<script setup>
const props = defineProps({
  description: String,
});
</script>
