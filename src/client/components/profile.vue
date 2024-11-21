<script setup>
</script>

<template>
  <p>profile</p>
  <ul>
    <li>email: {{ email }}</li>
    <li><a href="/follow-list">Following {{ following_count }}</a></li>
    <li><a href="/password">Update Password</a></li>
    <router-link :to="{ name: 'logout' }">Logout</router-link>
  </ul>
</template>

<style scoped lang="scss">
</style>