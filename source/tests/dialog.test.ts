import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ConsoleDialog from "../src/components/ConsoleDialog.vue";
describe("dialog keyboard containment", () => {
  it("ignores controls inside collapsed details when wrapping keyboard focus", async () => {
    const w = mount(ConsoleDialog, {
      props: { title: "导入" },
      slots: {
        default:
          '<details><summary>粘贴数据</summary><input aria-label="隐藏输入"><button>隐藏操作</button></details>',
      },
      attachTo: document.body,
    });
    await w.vm.$nextTick();
    const close = w.get('[aria-label="关闭对话框"]'),
      summary = w.get("summary");
    (close.element as HTMLElement).focus();
    await close.trigger("keydown", { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(summary.element);
    await summary.trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(close.element);
    w.unmount();
  });
});
