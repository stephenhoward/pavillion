<template>
    <div>
        <div class="modal">
            <div class="modal-content">
                <span class="title" >{{ props.title }}</span>
                <span class="close" @click="$emit('close')">&times;</span>
                <slot></slot>
            </div>
        </div>
    </div>
</template>

<script setup>

const props = defineProps({
    title: String
});

</script>

<style scoped lang="scss">
@use '../assets/mixins' as *;

div.modal {
        position: fixed;
        z-index: 1;
        left: 0;
        top: 0;
        width: 100%;
        height: 100%;
        overflow: auto;
        div.modal-content {
            margin: 0;
            padding: 20px;
            width: 100%;
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
                font-size: 20px;
                cursor: pointer;
            }
            span.title {
                font-size: 16px;
                display: block;
                float: left;
            }
        }
    }


@include medium-size-device {

    div.modal {
        background-color: rgb(0,0,0);
        background-color: rgba(0,0,0,0.4);
        div.modal-content {
            margin: 15% auto;
            width: 60%;
        }
    }
}
</style>
