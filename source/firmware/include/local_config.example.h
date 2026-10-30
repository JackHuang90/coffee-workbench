#pragma once
/** 功能：可选的本地开发HTTP命令令牌示例，不保存路由器凭据。
 * 首次编写日期：未知（历史代码）；变更日期：2026-10-29
 * 修改记录：2026-10-29：正常构建改用热点配网，空令牌继续关闭HTTP命令。 */
// Copy to git-ignored local_config.h only for explicitly authorized local demo control.
// Keep empty for read-only normal use. Never commit real tokens.
// Wi-Fi SSID/password and HTTPS read origins are configured in the device portal.
#define ROAST_HTTP_TOKEN ""
