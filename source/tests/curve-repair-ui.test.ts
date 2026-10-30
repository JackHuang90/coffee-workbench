/** 功能：验证缺口估算仅改变显示且回放不读取未来。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
import { expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import ImportPreview from "../src/components/ImportPreview.vue";
import RoastChart from "../src/components/RoastChart.vue";
import { createDemoCurve } from "../src/core/simulation";
import { useRoastStore } from "../src/stores/roast";

/** 功能：构造含一个短缺口和已知事件时间的曲线。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function fixture() {
  const curve = createDemoCurve();
  curve.samples = [98, 100, null, 106, 108].map((bt, i) => ({ t: i * 2, bt, et: null }));
  curve.markers = [
    { kind: "CHARGE", t: 0 },
    { kind: "FCs", t: 4, bt: null },
  ];
  return curve;
}
it("toggles dashed estimates without changing measured counts or imported samples", async () => {
  const curve = fixture(),
    before = JSON.stringify(curve);
  const w = mount(ImportPreview, { props: { curve, fileName: "gap.alog" } });
  try {
    expect(w.findAll("[data-test=repair-bt]")).toHaveLength(1);
    expect(w.get("[data-test=repair-bt]").attributes("stroke-dasharray")).toBeTruthy();
    expect(w.get("[data-test=channel-bt]").text()).toContain("4 / 5");
    expect(w.text()).toContain("贝塞尔估算");
    await w.get('[aria-label="贝塞尔补全短缺口"]').setValue(false);
    expect(w.find("[data-test=repair-bt]").exists()).toBe(false);
    expect(w.text()).toContain("该时刻豆温缺失");
    await w.get("[data-test=confirm-import]").trigger("click");
    expect(w.emitted("confirm")).toHaveLength(1);
    expect(JSON.stringify(curve)).toBe(before);
  } finally {
    w.unmount();
  }
});
it("only fills gaps after playback reaches the measured right endpoint and leaves metrics raw", async () => {
  const pinia = createPinia(),
    w = mount(RoastChart, { global: { plugins: [pinia] } });
  const s = useRoastStore(pinia);
  try {
    s.openCurve(fixture());
    s.cursor = 4;
    await w.vm.$nextTick();
    expect(w.find("[data-test=repair-bt]").exists()).toBe(false);
    expect(w.get(".metric.bt").text()).toContain("—");
    s.cursor = 8;
    await w.vm.$nextTick();
    const before = s.snapshot(),
      ror = w.get(".ror-path").attributes("d");
    expect(w.findAll("[data-test=repair-bt]")).toHaveLength(1);
    expect(w.get(".bt-path").attributes("d")!.match(/M/g)).toHaveLength(2);
    await w.get('[aria-label="贝塞尔补全短缺口"]').setValue(false);
    expect(w.find("[data-test=repair-bt]").exists()).toBe(false);
    expect(s.snapshot()).toEqual(before);
    expect(w.get(".ror-path").attributes("d")).toBe(ror);
    expect(s.dirty).toBe(false);
  } finally {
    w.unmount();
  }
});
it("keeps isolated measured points visible when estimates are switched off", async () => {
  const pinia = createPinia(),
    w = mount(RoastChart, { global: { plugins: [pinia] } });
  const s = useRoastStore(pinia);
  try {
    const curve = fixture();
    curve.samples = [98, null, 102, null, 106].map((bt, i) => ({ t: i * 2, bt, et: null }));
    s.openCurve(curve);
    await w.vm.$nextTick();
    await w.get('[aria-label="贝塞尔补全短缺口"]').setValue(false);
    expect(w.findAll("[data-test=isolated-bt]")).toHaveLength(3);
    expect(w.find("[data-test=repair-bt]").exists()).toBe(false);
  } finally {
    w.unmount();
  }
});
