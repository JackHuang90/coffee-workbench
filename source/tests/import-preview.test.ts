/** 功能：验证导入预检和取消不会覆盖已有曲线。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
import { afterEach, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import App from "../src/App.vue";
import { useRoastStore } from "../src/stores/roast";
import ImportPreview from "../src/components/ImportPreview.vue";
import { createDemoCurve } from "../src/core/simulation";
const raw =
  "{'title': '导入检查样本', 'mode': 'F', 'timex': [-2, 0, 2, 4], 'temp1': [-1, -1, -1, -1], 'temp2': [212, -1, 392, 410], 'timeindex': [1, 0, 2, 0, 0, 0, 3, 0], 'etypes': ['Air', 'Power'], 'specialevents': [1, 2], 'specialeventstype': [1, 0], 'specialeventsvalue': [4, 5], 'specialeventsStrings': ['', '']}";
afterEach(() => {
  document.body.innerHTML = "";
});
it("shows isolated valid measurements without connecting across missing points", () => {
  const curve = createDemoCurve();
  curve.samples = [
    { t: 0, bt: 100, et: null },
    { t: 2, bt: null, et: 150 },
    { t: 4, bt: 110, et: null },
  ];
  curve.markers = [];
  const w = mount(ImportPreview, { props: { curve, fileName: "isolated.json" } });
  try {
    expect(w.findAll("[data-test=isolated-bt]")).toHaveLength(2);
    expect(w.findAll("[data-test=isolated-et]")).toHaveLength(1);
  } finally {
    w.unmount();
  }
});
it("shows a complete check in one modal, and cancelling leaves the existing draft intact", async () => {
  const pinia = createPinia(),
    w = mount(App, { global: { plugins: [pinia] }, attachTo: document.body });
  const s = useRoastStore(pinia),
    original = s.snapshot();
  try {
    await w.get("[data-test=nav-library]").trigger("click");
    await w.get("[data-test=import-data]").setValue(raw);
    await w.get("[data-test=preview-import]").trigger("click");
    expect(w.findAll("[role=dialog]")).toHaveLength(1);
    expect(w.get("[role=dialog] h2").text()).toContain("导入检查");
    const preview = w.get("[data-test=import-preview]");
    expect(preview.text()).toContain("导入检查样本");
    expect(preview.get("[data-test=channel-bt]").text()).toContain("3 / 4");
    expect(preview.get("[data-test=channel-et]").text()).toContain("0 / 4");
    expect(preview.text()).toContain("°F");
    expect(preview.text()).toContain("一爆开始");
    expect(preview.get("[data-test=heat-events]").text()).toContain("1 条");
    expect(preview.get("[data-test=air-events]").text()).toContain("1 条");
    expect(s.snapshot()).toEqual(original);
    await w.get("[data-test=cancel-import]").trigger("click");
    expect(w.find("[data-test=import-preview]").exists()).toBe(false);
    expect(s.snapshot()).toEqual(original);
    await w.get("[data-test=preview-import]").trigger("click");
    await w.get("[data-test=confirm-import]").trigger("click");
    expect(s.curve.name).toBe("导入检查样本");
    expect(s.savedToLibrary).toBe(false);
  } finally {
    w.unmount();
  }
});
