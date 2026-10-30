import { afterEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import RoastChart from "../src/components/RoastChart.vue";
import { useRoastStore } from "../src/stores/roast";
import { importALOG } from "../src/core/alog";
const wrappers: ReturnType<typeof mount>[] = [];
function setup() {
  const pinia = createPinia();
  const w = mount(RoastChart, { global: { plugins: [pinia] } });
  wrappers.push(w);
  return { w, s: useRoastStore(pinia) };
}
afterEach(() => wrappers.splice(0).forEach((w) => w.unmount()));
describe("forecast and target are distinct", () => {
  it("shows a separate switch and dashed forecast while retaining reference path", async () => {
    const { w } = setup();
    expect(w.get(".prediction-path").attributes("d")).toContain("L");
    expect(w.find(".reference-path").exists()).toBe(true);
    const toggle = w.get('[aria-label="显示短期 BT 趋势"]');
    await toggle.setValue(false);
    expect(w.find(".prediction-path").exists()).toBe(false);
    expect(w.find(".reference-path").exists()).toBe(true);
    await toggle.setValue(true);
    expect(w.find(".prediction-path").exists()).toBe(true);
  });
  it("keeps prediction independent of reference selection and explains suppression", async () => {
    const { w, s } = setup();
    const first = w.get(".prediction-path").attributes("d");
    s.reference = null;
    await w.vm.$nextTick();
    expect(w.get(".prediction-path").attributes("d")).toBe(first);
    s.cursor = 5;
    await w.vm.$nextTick();
    expect(w.find(".prediction-path").exists()).toBe(false);
    expect(w.get("[data-test=trend-status]").text()).toMatch(/20/);
  });
  it("renders native five-second samples as continuous data, not isolated moves", async () => {
    const { w, s } = setup();
    s.curve.samples = Array.from({ length: 20 }, (_, i) => ({
      t: i * 5.001,
      bt: 100 + i,
      et: 200 + i,
    }));
    s.cursor = 95.019;
    await w.vm.$nextTick();
    const path = w.get(".bt-path").attributes("d")!;
    expect(path.match(/M/g)).toHaveLength(1);
    expect(path.match(/L/g)).toHaveLength(19);
    expect(w.find(".prediction-path").exists()).toBe(true);
  });
  it("shows pre-charge time with a sign without changing imported sample coordinates", async () => {
    const { w, s } = setup();
    const curve = importALOG(
      "{'mode':'C','timex':[-12,0,5,10,15,20,25,30,35,40],'temp1':[200,201,202,203,204,205,206,207,208,209],'temp2':[100,101,102,103,104,105,106,107,108,109],'timeindex':[1,0,0,0,0,0,0,0]}",
    );
    const before = structuredClone(curve.samples);
    s.openCurve(curve, true);
    await w.vm.$nextTick();
    expect(w.text()).toContain("−00:12");
    expect(w.text()).toContain("入豆为 00:00");
    expect(s.curve.samples).toEqual(before);
    expect(w.get(".marker-time").text()).toBe("00:00");
  });
  it("suppresses a paused local simulation without altering its target", async () => {
    const { w, s } = setup();
    s.startTracking();
    for (let i = 0; i < 30; i++) s.stepTracking(1);
    s.pauseTracking();
    await w.vm.$nextTick();
    expect(w.find(".prediction-path").exists()).toBe(false);
    expect(w.get("[data-test=trend-status]").text()).toMatch(/暂停|冻结/);
    expect(w.find(".reference-path").exists()).toBe(true);
  });
});
