# 咖啡烘焙工作台 · Coffee Workbench

使用 Vue 3、TypeScript 与 Pinia 构建的浏览器本地咖啡烘焙工作台，附带 ESP32-S3 固件与本地连接工具。

## 功能

- BT/ET 温度曲线、RoR、阶段与事件记录、曲线对比与回放。
- 独立离线仿真、交互风味轮、品饮记录与下一锅计划。
- 浏览器本地曲线库，支持 JSON/CSV 与 Artisan `.alog` 导入导出。
- 在支持的浏览器中，通过局域网 Wi-Fi 或 BLE 读取设备状态；另提供可选本地桥接工具。

## 本地运行

使用 Node.js 22.13+（22.x）或 24+。

```sh
cd source
npm ci
npm run dev
```

打开终端显示的本地地址。构建静态页面使用 `npm run build`，产物位于 `source/dist/`；综合检查使用 `npm run check`。

## 文档

- [开发说明](source/README.md)
- [Wi-Fi 配网与局域网连接](source/docs/local-connection.md)
- [蓝牙连接](source/docs/bluetooth-connection.md)
- [Artisan 文件格式](source/docs/artisan-files.md)
- [固件说明](source/firmware/README.md)
- [构建与烧录](source/firmware/docs/build-and-flash.md)
- [开发板配置依据](source/firmware/docs/hardware/user-board-2026-10-29/README.md)

## 设备与数据

固件不绑定真实加热器或风机，当前设备连接用于只读状态与温度。仿真结果不代表真实烘焙设备行为，实物传感器及执行器仍需验证。

曲线库保存在当前浏览器中；请主动导出重要数据作为备份。公开版本不内置私人站点地址，请在设备配网页中填写实际网页来源。Wi-Fi 密码与本地控制令牌应仅保存在设备或被忽略的本地配置中。

## 第三方测试数据

Artisan 官方测试夹具及其原有许可证和来源说明保留在 [`source/tests/fixtures/artisan/`](source/tests/fixtures/artisan/NOTICE.md)。用户曲线测试夹具使用已脱敏版本。
