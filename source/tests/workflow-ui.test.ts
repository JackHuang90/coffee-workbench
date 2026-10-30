import { describe, it, expect, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia } from "pinia";
import RoastChart from "../src/components/RoastChart.vue";
import RoastRecord from "../src/components/RoastRecord.vue";
import { useRoastStore } from "../src/stores/roast";

afterEach(() => {
  document.body.innerHTML = "";
});
describe("journal interactions", () => {
  it("disables reuse of a first-sample record as the next reference", async () => {
    const pinia = createPinia();
    const s = useRoastStore(pinia);
    s.startRecording();
    s.stopRecording();
    const w = mount(RoastRecord, {
      props: { saving: false, error: "", draftStatus: "", items: [] },
      global: { plugins: [pinia] },
    });
    await w.findAll(".record-tabs button")[3].trigger("click");
    expect(w.get(".experiment-intro button").attributes("disabled")).toBeDefined();
    w.unmount();
  });
  it("blocks live prediction when device data is interrupted", async () => {
    const pinia = createPinia();
    const s = useRoastStore(pinia);
    s.deviceRecording = true;
    s.deviceInterrupted = true;
    const w = mount(RoastChart, { global: { plugins: [pinia] } });
    expect(w.get("[data-test=trend-status]").text()).toContain("设备数据中断");
    expect(w.find(".prediction-path").exists()).toBe(false);
    w.unmount();
  });
  it("zooms the first crack region and returns to the full timeline", async () => {
    const pinia = createPinia();
    const s = useRoastStore(pinia);
    const w = mount(RoastChart, { global: { plugins: [pinia] } });
    await w.get("[data-test=zoom-crack]").trigger("click");
    expect(s.chartWindow).not.toBeNull();
    expect(w.get(".chart-inspector > strong").text()).toBe("09:30");
    await w.get("[data-test=zoom-reset]").trigger("click");
    expect(s.chartWindow).toBeNull();
    w.unmount();
  });
  it("records multiple tastings and stores a single-variable plan with the curve", async () => {
    const pinia = createPinia();
    const s = useRoastStore(pinia);
    const w = mount(RoastRecord, {
      props: { saving: false, error: "", draftStatus: "", items: [] },
      global: { plugins: [pinia] },
    });
    await w.findAll(".record-tabs button")[2].trigger("click");
    const form = w.get("form");
    await form.get("textarea").setValue("甜感清晰");
    await form.trigger("submit");
    await form.get("textarea").setValue("养豆后口感更饱满");
    await form.trigger("submit");
    expect(s.curve.journal?.tastings).toHaveLength(2);
    await w.findAll(".record-tabs button")[3].trigger("click");
    await w.findAll("textarea")[1].setValue("只调整发展时长");
    await flushPromises();
    expect(s.curve.journal?.experiment?.change).toBe("只调整发展时长");
    w.unmount();
  });
});
