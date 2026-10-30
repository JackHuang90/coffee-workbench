<script setup lang="ts">
import { nextTick, onMounted, onBeforeUnmount, ref, useId } from "vue";
defineProps<{
  title: string;
  wide?: boolean;
}>();
const emit = defineEmits<{
  close: [];
}>();
const box = ref<HTMLElement>();
const id = useId();
let previous: HTMLElement | null = null;
onMounted(async () => {
  previous = document.activeElement as HTMLElement;
  await nextTick();
  box.value?.querySelector<HTMLButtonElement>("button")?.focus();
});
onBeforeUnmount(() => previous?.focus());
function keys(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.stopPropagation();
    e.preventDefault();
    emit("close");
  }
  if (e.key === "Tab") {
    const items = Array.from(
      box.value?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]',
      ) ?? [],
    ).filter((element) => {
      const closed = element.closest("details:not([open])");
      if (closed && !element.closest("summary")) return false;
      let node: HTMLElement | null = element;
      while (node && node !== box.value) {
        if (
          node.hidden ||
          node.hasAttribute("inert") ||
          getComputedStyle(node).display === "none" ||
          getComputedStyle(node).visibility === "hidden"
        )
          return false;
        node = node.parentElement;
      }
      return true;
    });
    if (!items.length) return;
    const first = items[0],
      last = items.at(-1)!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
</script>
<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section
      ref="box"
      :class="['modal', { 'wide-modal': wide }]"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="id"
      @keydown="keys"
    >
      <header class="modal-heading">
        <h2 :id="id">{{ title }}</h2>
        <button aria-label="关闭对话框" class="icon-button" @click="emit('close')">×</button>
      </header>
      <div class="modal-content">
        <slot />
      </div>
    </section>
  </div>
</template>
