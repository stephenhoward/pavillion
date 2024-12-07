<template>
    <div>
        <div class="modal">
            <div class="modal-content">
                <span class="close" @click="$emit('close')">&times;</span>
                <slot></slot>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue';


</script>

<style scoped lang="scss">
@import '../assets/mixins.scss';

div.modal {
    position: fixed;
    z-index: 1;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    overflow: auto;
    background-color: rgb(0,0,0);
    background-color: rgba(0,0,0,0.4);
    div.modal-content {
        margin: 15% auto;
        padding: 20px;
        width: 60%;
        border-radius: 10px;

        background-color: $light-mode-background;
        color:            $light-mode-text;
        @include dark-mode {
            background-color: $dark-mode-background;
            color:            $dark-mode-text;
        }

        span.close {
            display: block;
            text-align: right;
        }
    }
 }
</style>