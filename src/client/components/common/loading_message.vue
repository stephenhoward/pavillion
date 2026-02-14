<template>
  <div class="loading-message" role="status">
    <p class="text-secondary"> ⏱ {{ props.description }}</p>
  </div>
</template>

<script setup>
const props = defineProps({
  description: String,
});
</script>

<style scoped lang="scss">
.loading-message {
  text-align: center;
}
</style>
