#pragma once
/** 功能：采用用户提供的BOOT GPIO0及WS2812 GPIO48板型配置，保留可覆盖/禁用能力。
 * 首次编写日期：2026-10-29；变更日期：2026-10-31
 * 修改记录：2026-10-29：首次编写；只绑定用户交互引脚，不绑定执行器。
 * - 2026-10-31：公开版本不预填私人网站来源，由用户配网时设置。 */
#ifndef ROAST_BOOT_PIN
#define ROAST_BOOT_PIN 0
#endif
#ifndef ROAST_RGB_PIN
#define ROAST_RGB_PIN 48
#endif
#ifndef ROAST_RGB_ENABLE
#define ROAST_RGB_ENABLE 1
#endif
#ifndef ROAST_RGB_BRIGHTNESS
#define ROAST_RGB_BRIGHTNESS 12
#endif
#ifndef ROAST_RGB_ORDER
#define ROAST_RGB_ORDER LED_COLOR_ORDER_GRB
#endif
#ifndef ROAST_DEFAULT_ORIGIN
#define ROAST_DEFAULT_ORIGIN ""
#endif
