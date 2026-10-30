import type { RoastCurve } from "../core/types";

const UNAVAILABLE = "无法使用浏览器本地存储，请检查隐私模式或网站存储权限后重试。";
const FAILED = "曲线库操作失败，原有数据未更改，请重试。";

function storageError(cause: unknown, fallback = FAILED): Error {
  const name = cause && typeof cause === "object" && "name" in cause ? cause.name : "";
  const message =
    name === "QuotaExceededError"
      ? "浏览器存储空间不足，原有曲线未被覆盖，请清理空间后重试。"
      : name === "SecurityError" || name === "NotSupportedError"
        ? UNAVAILABLE
        : fallback;
  return new Error(message, { cause });
}

export class CurveLibrary {
  private database?: IDBDatabase;
  private opening?: Promise<IDBDatabase>;
  private generation = 0;

  constructor(private readonly dbName = "roast-studio-library") {}

  async list(): Promise<RoastCurve[]> {
    const curves = await this.transact<RoastCurve[]>("readonly", (store) => store.getAll());
    return curves.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async save(curve: RoastCurve): Promise<void> {
    // JSON data is also safe to copy when the editor supplies Vue proxies.
    const snapshot: RoastCurve = JSON.parse(JSON.stringify(curve));
    await this.transact("readwrite", (store) => store.put(snapshot));
  }

  async remove(id: string): Promise<void> {
    await this.transact("readwrite", (store) => store.delete(id));
  }

  async rename(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 120) {
      throw new Error("曲线名称须为 1–120 个字符，不能只包含空格。");
    }
    await this.transact("readwrite", (store, abort) => {
      const request: IDBRequest<RoastCurve | undefined> = store.get(id);
      request.onsuccess = () => {
        const latest = request.result;
        if (!latest) {
          abort(new Error("未找到这条曲线，它可能已被删除，请刷新曲线库。"));
          return;
        }
        try {
          // Read and update within one write transaction; never reuse a stale UI snapshot.
          store.put({
            ...latest,
            name: trimmed,
            updatedAt: new Date().toISOString(),
          });
        } catch (cause) {
          abort(storageError(cause));
        }
      };
      return request;
    });
  }

  close(): void {
    this.generation += 1;
    this.database?.close();
    this.database = undefined;
    this.opening = undefined;
  }

  private async open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    if (this.opening) return this.opening;
    const generation = this.generation;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        if (!globalThis.indexedDB) throw new Error("IndexedDB unavailable");
        request = globalThis.indexedDB.open(this.dbName, 1);
      } catch (cause) {
        reject(storageError(cause, UNAVAILABLE));
        return;
      }
      let rejected = false;
      request.onupgradeneeded = () => {
        request.result.createObjectStore("curves", { keyPath: "id" });
      };
      request.onerror = () => {
        rejected = true;
        reject(storageError(request.error, UNAVAILABLE));
      };
      request.onblocked = () => {
        rejected = true;
        reject(new Error("曲线库被其他页面占用，请关闭其他烘焙页面后重试。"));
      };
      request.onsuccess = () => {
        const database = request.result;
        // A blocked open can still finish later. Never retain its abandoned connection.
        if (rejected || generation !== this.generation) {
          database.close();
          if (!rejected) reject(new Error("曲线库已关闭，请重试。"));
          return;
        }
        database.onversionchange = () => {
          database.close();
          if (this.database === database) this.database = undefined;
        };
        database.onclose = () => {
          if (this.database === database) this.database = undefined;
        };
        this.database = database;
        resolve(database);
      };
    });
    this.opening = opening;
    try {
      return await opening;
    } finally {
      if (this.opening === opening) this.opening = undefined;
    }
  }

  private async transact<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore, abort: (error: Error) => void) => IDBRequest<T>,
  ): Promise<T> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      let transaction: IDBTransaction;
      try {
        transaction = database.transaction("curves", mode);
      } catch (cause) {
        reject(storageError(cause));
        return;
      }
      let request: IDBRequest<T>;
      let failure: Error | undefined;
      const abort = (error: Error) => {
        failure = error;
        transaction.abort();
      };
      // Request success is provisional: only transaction completion commits a write.
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(failure ?? storageError(transaction.error));
      try {
        request = operation(transaction.objectStore("curves"), abort);
        request.onerror = () => {
          failure = storageError(request.error);
        };
      } catch (cause) {
        abort(storageError(cause));
      }
    });
  }
}
