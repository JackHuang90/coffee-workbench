/** 功能：运行真实内嵌门户脚本，验证编辑与异步响应竞态。
 * 首次编写日期：2026-10-29；变更日期：2026-10-29
 * 修改记录：2026-10-29：首次编写，不以源码字符串代替行为断言。 */
const fs = require("node:fs"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const source = fs
  .readFileSync(require("node:path").join(__dirname, "../include/roast/setup_page.hpp"), "utf8")
  .split("<script>")[1]
  .split("</script>")[0];
/** 功能：提供事件和表单值的最小DOM边界。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
function element() {
  return {
    value: "",
    textContent: "",
    disabled: false,
    hidden: true,
    style: {},
    events: {},
    addEventListener(name, fn) {
      this.events[name] = fn;
    },
    replaceChildren() {},
    append() {},
  };
}
/** 功能：执行表单编辑、测试响应、跨页候选变化的实际交互。首次编写日期：2026-10-29；变更日期：2026-10-29；修改记录：2026-10-29：首次编写。 */
async function run() {
  const elements = new Map(),
    get = (id) => {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    };
  let state = {
      state: "Setup",
      token: "a".repeat(32),
      ssid: "",
      mode: "dhcp",
      ip: "",
      gateway: "",
      origins: [],
      revision: 0,
    },
    resolveTest;
  const timers = new Map();
  let timerId = 0;
  const context = {
    document: { getElementById: get, createTextNode: () => ({}), createElement: element },
    window: { addEventListener() {} },
    navigator: {},
    Option: function () {},
    URLSearchParams,
    AbortController,
    console,
    setTimeout(fn, delay) {
      timers.set(++timerId, { fn, delay });
      return timerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    FormData: class {
      constructor() {
        this.entries = [
          ["ssid", get("ssid").value],
          ["mode", "dhcp"],
        ];
      }
      [Symbol.iterator]() {
        return this.entries[Symbol.iterator]();
      }
    },
    fetch(path) {
      if (path === "/setup/test")
        return new Promise((resolve) => {
          resolveTest = (data) => resolve({ ok: true, json: async () => data });
        });
      return Promise.resolve({ ok: true, json: async () => ({ ...state }) });
    },
  };
  vm.runInNewContext(source, context);
  const settle = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  const poll = async () => {
    const entry = [...timers.entries()].find(([, item]) => item.delay === 1500);
    assert.ok(entry, "poll was scheduled");
    timers.delete(entry[0]);
    await entry[1].fn();
    await settle();
  };
  await settle();
  get("ssid").value = "first";
  get("form").events.input();
  const submitted = get("form").events.submit({ preventDefault() {} });
  get("ssid").value = "edited while pending";
  get("form").events.input();
  resolveTest({ ok: true, revision: 1 });
  await submitted;
  state = { ...state, state: "Ready", revision: 1 };
  await poll();
  assert.equal(get("save").disabled, true, "late test response must not authorize edited form");
  const next = get("form").events.submit({ preventDefault() {} });
  resolveTest({ ok: true, revision: 2 });
  await next;
  state = { ...state, state: "Ready", revision: 2 };
  await poll();
  assert.equal(get("save").disabled, false, "matching current test permits explicit save");
  state = { ...state, revision: 3 };
  await poll();
  assert.equal(
    get("save").disabled,
    true,
    "another tab replacing candidate invalidates this page save",
  );
  state = { ...state, token: "b".repeat(32), revision: 2 };
  await poll();
  assert.equal(
    get("save").disabled,
    true,
    "new hotspot session invalidates reused candidate revision",
  );
  console.log("Embedded setup page behavior passed");
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
