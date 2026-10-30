<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
defineProps<{
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
const box = ref<HTMLElement>(),
  cancel = ref<HTMLButtonElement>();
let previous: HTMLElement | null = null;
onMounted(async () => {
  previous = document.activeElement as HTMLElement;
  await nextTick();
  cancel.value?.focus();
});
onBeforeUnmount(() => previous?.focus());
function keys(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    emit("cancel");
  }
  if (e.key === "Tab") {
    const items = box.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input,textarea,[tabindex="0"]',
    );
    if (!items?.length) return;
    const first = items[0],
      last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
}
</script>
<template>
  <div class="modal-backdrop" @click.self="emit('cancel')">
    <section
      ref="box"
      class="modal small-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      @keydown="keys"
    >
      <p class="eyebrow">ROAST JOURNAL</p>
      <h2 id="confirm-title">{{ title }}</h2>
      <p id="confirm-message">{{ message }}</p>
      <div class="button-row">
        <button
          ref="cancel"
          data-test="confirm-cancel"
          class="button secondary"
          @click="emit('cancel')"
        >
          取消</button
        ><button
          data-test="confirm-ok"
          :class="['button', danger ? 'danger' : 'primary']"
          @click="emit('confirm')"
        >
          {{ confirmLabel || "继续" }}
        </button>
      </div>
    </section>
  </div>
</template>
