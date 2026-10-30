/**
 * 功能：统一校验设备直连网页与来源复制使用的精确 origin，不发起网络或权限请求。
 * 首次编写日期：2026-10-30
 * 变更日期：2026-10-30
 * 修改记录：
 * - 2026-10-30：首次编写；HTTPS 保持支持，HTTP 仅允许本机与 RFC1918 数字 IPv4 来源。
 * - 2026-10-30：HTTPS 校验固件支持的 DNS 标签和来源长度，避免网页放行设备无法保存的来源。
 */

/**
 * 功能：识别规范 HTTPS origin，或 localhost、127/8、RFC1918 的规范 HTTP origin。
 * 首次编写日期：2026-10-30
 * 变更日期：2026-10-30
 * 修改记录：
 * - 2026-10-30：首次编写；拒绝路径、用户信息、IPv6、数字别名和非规范端口，不替调用方规范化输入。
 * - 2026-10-30：来源最长 255 字符；HTTPS 域名每个标签为 1–63 个字母、数字或内部连字符。
 */
export function isAllowedDevicePageOrigin(origin: string): boolean {
  try {
    if (origin.length > 255) return false;
    const parsed = new URL(origin);
    // The browser's location.origin is already canonical, including omission of default ports.
    if (parsed.origin !== origin || parsed.port === "0" || parsed.hostname.includes(":"))
      return false;
    if (parsed.protocol === "https:")
      return parsed.hostname
        .split(".")
        .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
    if (parsed.protocol !== "http:") return false;
    if (parsed.hostname === "localhost") return true;
    if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(parsed.hostname)) return false;
    const octets = parsed.hostname.split(".").map(Number);
    return (
      octets.every((n) => n <= 255) &&
      (octets[0] === 127 ||
        octets[0] === 10 ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168))
    );
  } catch {
    return false;
  }
}
