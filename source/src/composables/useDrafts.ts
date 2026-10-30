/** 功能：协调草稿暂存、恢复提示和串行提交及编辑版本核对，失败保留内存记录。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
import { onMounted, onBeforeUnmount, ref, watch } from "vue";
import { DraftRepository } from "../data/drafts";
import { useRoastStore } from "../stores/roast";

/** 功能：自动暂存编辑并提供显式恢复候选，卸载前尽力完成最后一次提交。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export function useDrafts(store: ReturnType<typeof useRoastStore>) {
  const repository = new DraftRepository();
  const pending = ref<Awaited<ReturnType<DraftRepository["list"]>>>([]);
  const status = ref(""),
    failure = ref("");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue = Promise.resolve();
  let ready = false,
    disposed = false;
  let revision = 0;
  /** 功能：按调用顺序提交不可变快照，旧提交不能覆盖新状态。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (!ready || !store.dirty || disposed) return queue;
    const value = store.snapshot();
    value.updatedAt = new Date().toISOString();
    const currentRevision = revision;
    const source = store.curve;
    status.value = "正在暂存…";
    queue = queue
      .then(async () => {
        await repository.save(value);
        if (revision === currentRevision && store.curve === source) {
          status.value = "草稿已自动暂存";
          failure.value = "";
        }
      })
      .catch((e) => {
        failure.value = e instanceof Error ? e.message : "自动暂存失败，请导出备份。";
        status.value = "暂存失败";
      });
    return queue;
  }
  /** 功能：正式保存后仅移除对应草稿，保留随后发生的新编辑。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  async function remove(id: string) {
    queue = queue
      .then(() => repository.remove(id))
      .then(() => {
        pending.value = pending.value.filter((c) => c.id !== id);
      })
      .catch((e) => {
        failure.value = e instanceof Error ? e.message : "无法清理草稿";
      });
    await queue;
  }
  watch(
    () => store.curve,
    () => {
      revision++;
      if (!store.dirty) return;
      status.value = "等待暂存…";
      // A bounded delay, not a trailing debounce: continuous telemetry still commits.
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          void flush();
        }, 750);
    },
    { deep: true },
  );
  watch(
    () => [store.recording, store.curve.markers.length, store.curve.journal?.actions.length],
    () => void flush(),
  );
  onMounted(async () => {
    try {
      pending.value = await repository.list();
    } catch (e) {
      failure.value = e instanceof Error ? e.message : "无法读取恢复草稿";
    } finally {
      ready = true;
      if (store.dirty) void flush();
    }
  });
  onBeforeUnmount(() => {
    void flush();
    disposed = true;
    clearTimeout(timer);
    void queue.finally(() => repository.close());
  });
  return { pending, status, failure, flush, remove };
}
