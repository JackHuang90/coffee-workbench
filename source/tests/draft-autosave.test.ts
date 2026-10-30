import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import { createPinia } from "pinia";
import { useRoastStore } from "../src/stores/roast";
import { useDrafts } from "../src/composables/useDrafts";
import { DraftRepository } from "../src/data/drafts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(DraftRepository.prototype, "list").mockResolvedValue([]);
  vi.spyOn(DraftRepository.prototype, "save").mockResolvedValue();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("automatic draft commits", () => {
  it("never labels newer edits saved when an older pending commit completes", async () => {
    let finish!: () => void;
    vi.mocked(DraftRepository.prototype.save).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pinia = createPinia();
    const s = useRoastStore(pinia);
    const w = mount(
      defineComponent({
        setup() {
          return useDrafts(s);
        },
        template: "<span>{{ status }}</span>",
      }),
      { global: { plugins: [pinia] } },
    );
    await flushPromises();
    s.startRecording();
    await nextTick();
    await flushPromises();
    s.curve.notes = "edit made after the pending snapshot";
    await nextTick();
    finish();
    await flushPromises();
    expect(w.text()).not.toContain("草稿已自动暂存");
    await vi.advanceTimersByTimeAsync(750);
    await flushPromises();
    expect(w.text()).toContain("草稿已自动暂存");
    expect(vi.mocked(DraftRepository.prototype.save).mock.calls.at(-1)?.[0].notes).toBe(
      "edit made after the pending snapshot",
    );
    w.unmount();
    await flushPromises();
  });
  it("continues saving after an event flush and does not starve under continuous input", async () => {
    const pinia = createPinia();
    const s = useRoastStore(pinia);
    const w = mount(
      defineComponent({
        setup() {
          return useDrafts(s);
        },
        template: "<span>{{ status }}</span>",
      }),
      { global: { plugins: [pinia] } },
    );
    await flushPromises();
    s.startRecording();
    await nextTick();
    await flushPromises();
    expect(DraftRepository.prototype.save).toHaveBeenCalled();
    s.curve.notes = "first edit";
    await nextTick();
    await vi.advanceTimersByTimeAsync(400);
    s.mark("CHARGE");
    await nextTick();
    await flushPromises();
    const afterEvent = vi.mocked(DraftRepository.prototype.save).mock.calls.length;
    for (let i = 0; i < 6; i++) {
      s.curve.notes = `continuous ${i}`;
      await nextTick();
      await vi.advanceTimersByTimeAsync(200);
    }
    await flushPromises();
    expect(vi.mocked(DraftRepository.prototype.save).mock.calls.length).toBeGreaterThan(afterEvent);
    w.unmount();
    await flushPromises();
  });
  it("shows storage failure while retaining the current in-memory curve", async () => {
    vi.mocked(DraftRepository.prototype.save).mockRejectedValue(new Error("存储空间不足"));
    const pinia = createPinia();
    const s = useRoastStore(pinia);
    const w = mount(
      defineComponent({
        setup() {
          return useDrafts(s);
        },
        template: "<span>{{ failure }}</span>",
      }),
      { global: { plugins: [pinia] } },
    );
    await flushPromises();
    s.startRecording();
    await nextTick();
    await flushPromises();
    expect(w.text()).toContain("存储空间不足");
    expect(s.curve.samples).toHaveLength(1);
    expect(s.dirty).toBe(true);
    w.unmount();
    await flushPromises();
  });
});
