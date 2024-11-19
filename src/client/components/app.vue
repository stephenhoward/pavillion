<script setup>
</script>

<template>
  <div class="root">
    <RouterView />
  </div>
</template>

<style scoped lang="scss">
@import '../assets/mixins.scss';

* {
    font-family: 'Helvetica Neue';
    box-sizing:  border-box;
    &:focus {
        outline: none;
    }
}

:root {
    color-scheme:     light dark; 
    background-color: $light-mode-background;
    color:            $light-mode-text;  
}

@include dark-mode {
    :root {    
        background-color: $dark-mode-background;
        background: $dark-mode-background-gradient;
        color:            $dark-mode-text;
    }
}

html,body,#app {
    margin:  0;
    padding: 0;
    width:   100%;
}

body {
    width:      100%;
    height:     100%;
    min-height: 100%;

    div.root {

      @include dark-mode {
            background: $dark-mode-background;
            color:            $dark-mode-text;
          }

        display:    grid;
        height:     100%;
        min-height: 100%;
        width:      100%;

        grid-template-columns: [ left-rail ] auto [ main ] 40px [ end ];
        grid-template-rows:    [ top ]       120px  [ main ] 1fr [footer] auto [ end ];


        @include medium-size-device {
            grid-template-columns: [ left-rail ] 200px [ main ] auto [ end ];
            grid-template-rows:    [ top ]       80px  [ main ] auto [ end ];
            &.hide-menu {
                grid-template-columns: [ left-rail ] 0 [ main ] auto [ end ];
            }
        }
        @include large-size-device {
            grid-template-rows: [ top ] 280px  [ main ] auto [ end ];
        }
    }
}
.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: filter 300ms;
}
.logo:hover {
  filter: drop-shadow(0 0 2em #646cffaa);
}
.logo.vue:hover {
  filter: drop-shadow(0 0 2em #42b883aa);
}
</style>