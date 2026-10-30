# ESP32-S3 开发板配置依据

公开版本仅保留开发板配置结论；带有第三方账号水印的原商品图片不包含在仓库中。

## 当前配置

- BOOT 按键采用 GPIO0；RGB LED 采用 GPIO48 上的 WS2812，颜色顺序按 GRB 配置，可覆盖或禁用。
- 参考构建使用 N16R8。商品资料曾混用 N8R2 与 N16R8，请以实物模组丝印核对内存规格。
- ESP32-S3 原生 USB 使用 GPIO19 D−、GPIO20 D+，沿用 SDK 原生 USB 配置。
- 普通 RESET 保留网络设置；BOOT 长按 5 秒后松开用于恢复配网。

## 限制与核对

灯的 RGB/GRB 顺序、亮度、按钮与焊接状态仍需实物验证。上述信息不代表完成硬件联调，也不提供传感器、加热器、风机或仪表接线依据。

官方对照：[ESP32-S3 原生 USB](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/usb_device.html)、[BOOT 与 EN 启动模式](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/advanced-topics/boot-mode-selection.html)。
