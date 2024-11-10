<template>
    <div class="logout"></div>
</template>

<script setup>
    import { inject, onBeforeMount } from 'vue';
    import { useRouter } from 'vue-router';

    const router = useRouter();
    const authentication = inject('authentication');

    onBeforeMount( () => {
        authentication.logout();
        router.replace('/');
    });
</script>