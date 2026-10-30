import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDBFactory,
  IDBObjectStore,
  IDBVersionChangeEvent,
  forceCloseDatabase,
} from "fake-indexeddb";
import { reactive } from "vue";
import { CurveLibrary } from "../src/data/library";
import type { RoastCurve } from "../src/core/types";

const libraries: CurveLibrary[] = [];

function library() {
  const instance = new CurveLibrary("roast-library-test");
  libraries.push(instance);
  return instance;
}

function curve(overrides: Partial<RoastCurve> = {}): RoastCurve {
  return {
    schemaVersion: 1,
    id: "roast-1",
    name: "水洗耶加雪菲",
    notes: "花香与柑橘",
    createdAt: "2026-10-28T04:00:00.000Z",
    updatedAt: "2026-10-28T04:10:00.000Z",
    samples: [
      { t: 0, bt: 190, et: null },
      { t: 5, bt: 184, et: 210 },
    ],
    markers: [{ kind: "CHARGE", t: 0 }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
});

afterEach(() => {
  vi.useRealTimers();
  for (const instance of libraries.splice(0)) instance.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CurveLibrary", () => {
  it("atomically renames the latest stored curve without overwriting a pending save", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T08:00:00.000Z"));
    const repository = library();
    const writer = library();
    await repository.save(curve());
    await writer.list();
    const latest = curve({
      notes: "另一页面的新笔记",
      samples: [
        { t: 0, bt: 200, et: 220 },
        { t: 15, bt: 180, et: 215 },
      ],
      markers: [
        { kind: "CHARGE", t: 0 },
        { kind: "DRY", t: 15 },
      ],
      updatedAt: "2026-10-28T07:00:00.000Z",
    });

    const saving = writer.save(latest);
    const renaming = repository.rename("roast-1", "  新的名称  ");
    await Promise.all([saving, renaming]);

    expect(await repository.list()).toEqual([
      {
        ...latest,
        name: "新的名称",
        updatedAt: "2026-10-28T08:00:00.000Z",
      },
    ]);
  });

  it("rejects renaming a deleted ID without resurrecting its stale snapshot", async () => {
    const repository = library();
    await repository.save(curve());
    await library().remove("roast-1");

    await expect(repository.rename("roast-1", "不应复活")).rejects.toThrow(/不存在|未找到/);
    expect(await repository.list()).toEqual([]);
  });

  it.each(["", "   ", "名".repeat(121)])(
    "rejects invalid trimmed rename input %j",
    async (name) => {
      const repository = library();
      await repository.save(curve());

      await expect(repository.rename("roast-1", name)).rejects.toThrow(/名称.*120/);
      expect(await repository.list()).toEqual([curve()]);
    },
  );

  it("preserves the original curve when a rename exceeds storage quota", async () => {
    const repository = library();
    await repository.save(curve());
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    await expect(repository.rename("roast-1", "不应改名")).rejects.toThrow(/空间不足/);
    expect(await repository.list()).toEqual([curve()]);
  });

  it("rejects a rename aborted after its put succeeds instead of reporting an uncommitted name", async () => {
    const repository = library();
    await repository.save(curve());
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(function (
      this: IDBObjectStore,
      value,
      key,
    ) {
      const request = put.call(this, value, key);
      request.addEventListener("success", () => request.transaction?.abort());
      return request;
    });

    await expect(repository.rename("roast-1", "未提交的改名")).rejects.toThrow(/操作失败|事务/);
    expect(await repository.list()).toEqual([curve()]);
  });

  it("starts empty and persists an explicitly saved curve across connections", async () => {
    const first = library();
    expect(await first.list()).toEqual([]);

    await first.save(curve());
    first.close();

    expect(await library().list()).toEqual([curve()]);
  });

  it("lists newest updates first and renames a saved ID without duplicating it", async () => {
    const repository = library();
    await repository.save(curve({ id: "a" }));
    await repository.save(curve({ id: "b", updatedAt: "2026-10-28T05:00:00.000Z" }));
    expect((await repository.list()).map((item) => item.id)).toEqual(["b", "a"]);

    await repository.save(
      curve({
        id: "a",
        name: "重新命名",
        updatedAt: "2026-10-28T06:00:00.000Z",
      }),
    );
    expect((await repository.list()).map((item) => [item.id, item.name])).toEqual([
      ["a", "重新命名"],
      ["b", "水洗耶加雪菲"],
    ]);
  });

  it("sorts ISO update timestamps by time even when their fractional precision differs", async () => {
    const repository = library();
    await repository.save(curve({ id: "older", updatedAt: "2026-10-28T04:10:00Z" }));
    await repository.save(curve({ id: "newer", updatedAt: "2026-10-28T04:10:00.100Z" }));

    expect((await repository.list()).map((item) => item.id)).toEqual(["newer", "older"]);
  });

  it("deletes only the requested saved ID and tolerates deleting it again", async () => {
    const repository = library();
    await repository.save(curve({ id: "a" }));
    await repository.save(curve({ id: "b" }));

    await repository.remove("a");
    await repository.remove("a");
    repository.close();
    expect((await library().list()).map((item) => item.id)).toEqual(["b"]);
  });

  it("snapshots Vue reactive input at save time without implicitly saving later edits", async () => {
    const repository = library();
    const draft = reactive(curve());
    const saving = repository.save(draft);
    draft.name = "未保存的编辑";
    draft.samples[0].bt = 999;
    await saving;

    const saved = await repository.list();
    expect(saved).toEqual([curve()]);
    saved[0].name = "另一个未保存的编辑";
    saved[0].samples[0].bt = 555;
    expect(await repository.list()).toEqual([curve()]);
  });

  it("reports unavailable browser storage and allows retry after storage becomes available", async () => {
    const repository = library();
    const storage = indexedDB;
    vi.stubGlobal("indexedDB", undefined);

    await expect(repository.list()).rejects.toThrow(/浏览器.*存储/);
    vi.stubGlobal("indexedDB", storage);
    expect(await repository.list()).toEqual([]);
  });

  it("reports denied storage access with a helpful Chinese error", async () => {
    vi.spyOn(indexedDB, "open").mockImplementationOnce(() => {
      throw new DOMException("Access denied", "SecurityError");
    });

    await expect(library().save(curve())).rejects.toThrow(/浏览器.*存储/);
  });

  it("rejects a transaction aborted after request success and preserves the previous curve", async () => {
    const repository = library();
    await repository.save(curve());
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(function (
      this: IDBObjectStore,
      value,
      key,
    ) {
      const request = put.call(this, value, key);
      request.addEventListener("success", () => request.transaction?.abort());
      return request;
    });

    await expect(repository.save(curve({ name: "不应保存" }))).rejects.toThrow(/操作失败|事务/);
    expect(await repository.list()).toEqual([curve()]);
  });

  it("reports quota exhaustion without replacing a previously saved curve", async () => {
    const repository = library();
    await repository.save(curve());
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    await expect(repository.save(curve({ name: "不应覆盖" }))).rejects.toThrow(/空间不足/);
    expect(await repository.list()).toEqual([curve()]);
  });

  it("reports asynchronous request errors after the transaction rolls back", async () => {
    const repository = library();
    await repository.save(curve());
    // Exercise a real failing IndexedDB request, not just a thrown operation.
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(function (
      this: IDBObjectStore,
      value,
      key,
    ) {
      return this.add(value, key);
    });

    await expect(repository.save(curve({ name: "重复键不应写入" }))).rejects.toThrow(/操作失败/);
    expect(await repository.list()).toEqual([curve()]);
  });

  it("does not retain a connection when closed while its first open is pending", async () => {
    const repository = library();
    const loading = repository.list();
    repository.close();
    await expect(loading).rejects.toThrow(/关闭|操作失败/);

    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase("roast-library-test");
      deletion.onblocked = () => reject(new Error("Closing retained a pending connection"));
      deletion.onerror = () => reject(deletion.error);
      deletion.onsuccess = () => resolve();
    });
    expect(await repository.list()).toEqual([]);
  });

  it("rejects a blocked open and closes any connection that arrives afterward", async () => {
    const repository = library();
    const open = indexedDB.open.bind(indexedDB);
    let finishOpening!: Promise<void>;
    vi.spyOn(indexedDB, "open").mockImplementationOnce((name, version) => {
      const request = open(name, version);
      finishOpening = new Promise((resolve) =>
        request.addEventListener("success", () => resolve()),
      );
      queueMicrotask(() => request.dispatchEvent(new IDBVersionChangeEvent("blocked")));
      return request;
    });

    await expect(repository.list()).rejects.toThrow(/其他页面|占用/);
    await finishOpening;
    await new Promise<void>((resolve, reject) => {
      const upgrade = open("roast-library-test", 2);
      upgrade.onblocked = () => reject(new Error("A rejected open leaked its connection"));
      upgrade.onerror = () => reject(upgrade.error);
      upgrade.onsuccess = () => {
        upgrade.result.close();
        resolve();
      };
    });
  });

  it("closes the connection when another page requests a version change", async () => {
    await library().save(curve());

    await new Promise<void>((resolve, reject) => {
      const upgrade = indexedDB.open("roast-library-test", 2);
      upgrade.onblocked = () => reject(new Error("The library blocked a version change"));
      upgrade.onerror = () => reject(upgrade.error);
      upgrade.onsuccess = () => {
        upgrade.result.close();
        resolve();
      };
    });
  });

  it("reopens after the browser unexpectedly closes a connection without losing saved data", async () => {
    const repository = library();
    const open = indexedDB.open.bind(indexedDB);
    let connection!: IDBDatabase;
    vi.spyOn(indexedDB, "open").mockImplementationOnce((name, version) => {
      const request = open(name, version);
      request.addEventListener("success", () => {
        connection = request.result;
      });
      return request;
    });
    await repository.save(curve());
    const closed = new Promise<void>((resolve) =>
      connection.addEventListener("close", () => resolve(), { once: true }),
    );
    // Version 6.2.4's helper declaration incorrectly expects a constructor, not an instance.
    forceCloseDatabase(connection as unknown as Parameters<typeof forceCloseDatabase>[0]);
    await closed;

    expect(await repository.list()).toEqual([curve()]);
    await repository.save(curve({ name: "连接恢复后保存" }));
    expect((await repository.list())[0].name).toBe("连接恢复后保存");
  });
});
