<script setup>
</script>

<template>
  <p>profile</p>
  <ul>
    <li>email: {{ email }}</li>
    <li><a href="/follow-list">Following {{ following_count }}</a></li>
    <li><a href="/password">Update Password</a></li>
    <li><a href="/logout">Logout</a></li>
  </ul>
</template>

<style scoped lang="scss">
</style>