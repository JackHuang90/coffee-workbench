import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia } from "pinia";
import App from "../src/App.vue";
import { useRoastStore } from "../src/stores/roast";
const start = () => {
  const pinia = createPinia();
  return {
    w: mount(App, { global: { plugins: [pinia] }, attachTo: document.body }),
    s: useRoastStore(pinia),
  };
};
afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});
describe("compact console", () => {
  it("uses the approved Chinese identity and all Chinese event controls without a marketing hero", () => {
    const { w } = start();
    expect(w.text()).toContain("咖啡烘焙工作台");
    expect(w.text()).not.toContain("ROAST STUDIO");
    expect(w.get(".brand h1").text()).not.toBe("焙时");
    expect(w.find(".hero").exists()).toBe(false);
    for (const label of [
      "入豆",
      "回温点",
      "脱水结束",
      "一爆开始",
      "一爆结束",
      "二爆开始",
      "二爆结束",
      "出豆",
      "冷却结束",
    ])
      expect(w.get(".event-toolbar").text()).toContain(label);
    expect(w.get("[data-test=real-tracking]").attributes("disabled")).toBeDefined();
    expect(w.text()).toContain("实机传感器与执行器尚待接入验证");
    w.unmount();
  });
  it("opens advanced data in a keyboard-dismissible dialog", async () => {
    const { w } = start();
    await w.get("[data-test=advanced]").trigger("click");
    expect(w.get("[role=dialog]").text()).toContain("风味与观察");
    await w.get("[role=dialog]").trigger("keydown", { key: "Escape" });
    expect(w.find("[role=dialog]").exists()).toBe(false);
    w.unmount();
  });
  it("runs genuine simulation separately and clears output/timers when replaced or unmounted", async () => {
    const { w, s } = start();
    await flushPromises();
    await w.get("[data-test=start-tracking]").trigger("click");
    expect(s.tracking.state).toBe("running");
    expect(s.curve.markers).toEqual([]);
    s.stepTracking(1);
    expect(s.tracking.elapsed).toBe(1);
    s.loadDemo();
    await flushPromises();
    expect(s.tracking.output).toBe(0);
    expect(s.tracking.state).toBe("idle");
    await w.get("[data-test=start-tracking]").trigger("click");
    expect(s.tracking.state).toBe("running");
    w.unmount();
    expect(s.tracking.state).toBe("idle");
    expect(s.tracking.output).toBe(0);
  });
  it("stops and requires restart confirmation when target changes during a run", async () => {
    const { w, s } = start();
    await flushPromises();
    await w.get("[data-test=start-tracking]").trigger("click");
    s.stepTracking(1);
    s.reference = { ...s.snapshot(), id: "replacement" };
    await flushPromises();
    expect(s.tracking.state).toBe("idle");
    expect(s.tracking.output).toBe(0);
    w.unmount();
  });
});
describe("simulation timer ownership", () => {
  it("owns an active timer only while running/manual and removes all on teardown", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
    const { w, s } = start();
    expect(vi.getTimerCount()).toBe(1);
    await w.get("[data-test=start-tracking]").trigger("click");
    expect(vi.getTimerCount()).toBe(2);
    s.pauseTracking();
    await w.vm.$nextTick();
    expect(vi.getTimerCount()).toBe(1);
    s.startTracking();
    await w.vm.$nextTick();
    expect(vi.getTimerCount()).toBe(2);
    s.stopTracking();
    await w.vm.$nextTick();
    expect(vi.getTimerCount()).toBe(1);
    w.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
describe("reference and chart clarity", () => {
  it("aligns the target drawing to the same reference origin as the simulator", async () => {
    const { w, s } = start();
    s.reference = {
      ...s.snapshot(),
      id: "shifted",
      samples: [
        { t: 100, bt: 100, et: 110 },
        { t: 102, bt: 102, et: 112 },
      ],
      markers: [{ kind: "CHARGE", t: 100 }],
    };
    s.startTracking();
    await w.vm.$nextTick();
    expect(w.get(".reference-path").attributes("d")).toMatch(/^M48\.00,/);
    w.unmount();
  });
  it("keeps useful RoR scale readable and exposes a full-range alternative", async () => {
    const { w } = start();
    expect(w.text()).toContain("含超出视窗数据");
    const scale = w.get('[aria-label="升温率显示范围"]');
    expect((scale.element as HTMLSelectElement).value).toBe("roast");
    await scale.setValue("full");
    expect(w.text()).not.toContain("含超出视窗数据");
    w.unmount();
  });
});

it("reports the target at the playback cursor after a completed simulation", async () => {
  const { w, s } = start();
  s.reference = {
    ...s.snapshot(),
    id: "short-target",
    samples: [
      { t: 100, bt: 100, et: 110 },
      { t: 102, bt: 102, et: 112 },
    ],
    markers: [{ kind: "CHARGE", t: 100 }],
  };
  s.startTracking();
  s.stepTracking(2);
  s.cursor = 0;
  await w.vm.$nextTick();
  expect(w.get(".tracking-values").findAll("strong")[0].text()).toBe("100.0°C");
  w.unmount();
});
