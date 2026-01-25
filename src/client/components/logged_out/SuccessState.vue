<template>
  <div class="success-state">
    <!-- Success Icon -->
    <div class="success-icon">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M4.5 12.75l6 6 9-13.5"
        />
      </svg>
    </div>

    <!-- Success content slot -->
    <slot />
  </div>
</template>

<style scoped lang="scss">
.success-state {
  text-align: center;

  .success-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 4rem; /* 64px */
    height: 4rem; /* 64px */
    margin: 0 auto 1.5rem; /* 24px bottom margin */
    border-radius: 50%;
    background-color: rgb(220 252 231); /* green-100 */
    color: rgb(22 163 74); /* green-600 */

    @media (prefers-color-scheme: dark) {
      background-color: rgb(20 83 45 / 0.5); /* green-900/50 */
      color: rgb(74 222 128); /* green-400 */
    }

    svg {
      width: 2rem; /* 32px */
      height: 2rem; /* 32px */
    }
  }
}
</style>
