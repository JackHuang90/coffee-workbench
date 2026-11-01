/** 功能：有界重试浏览器明确拒绝的“操作仍在进行”，不重放已接受或结果不明的写入。 */
export async function retryGattBusy<T>(
  operation: () => Promise<T>,
  active: () => boolean,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (!active()) throw new Error("蓝牙操作已取消");
    try {
      return await operation();
    } catch (cause) {
      const busy =
        cause instanceof DOMException &&
        cause.name === "NetworkError" &&
        /^(Connection already in progress\.|GATT operation already in progress\.)$/.test(
          cause.message,
        );
      if (!busy || attempt >= 4 || !active()) throw cause;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
  }
}

/** 功能：仅在建立连接时恢复一次实机观察到的 Windows 连接尝试失败；不可用于特征写入。 */
export async function retryGattConnect<T>(
  operation: () => Promise<T>,
  active: () => boolean,
): Promise<T> {
  try {
    return await retryGattBusy(operation, active);
  } catch (cause) {
    if (
      !(cause instanceof DOMException) ||
      cause.name !== "NetworkError" ||
      cause.message !== "Connection Error: Connection attempt failed." ||
      !active()
    )
      throw cause;
    // 保留本次用户选择和连接所有权，给 Windows 的失败会话短暂清理时间。
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    return retryGattBusy(operation, active);
  }
}
