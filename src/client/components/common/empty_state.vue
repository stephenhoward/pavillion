<template>
  <section
    class="empty-state"
    :aria-labelledby="titleId"
  >
    <h2 :id="titleId">{{ props.title }}</h2>
    <p v-if="props.description">{{ props.description }}</p>
    <slot/>
  </section>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  title: String,
  description: String,
});

const dialogId = Math.random().toString(36).substring(2, 11);
const titleId = computed(() => `empty-title-${dialogId}`);

</script>

<style scoped lang="scss">
</style>
