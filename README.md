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

## 自动构建与发布

推送到 `main` 后，GitHub Actions 自动运行前端检查、固件原生测试，并编译固件；前端检查与构建通过后自动部署到 [GitHub Pages](https://jackhuang90.github.io/coffee-workbench/)，前端和固件全部成功后创建一个预发布 Release。向 `main` 提交 PR 时也会构建检查，但不会部署网站或发布 Release。可在仓库的 Actions → Build and Release → Run workflow 中手动运行；只有选择 `main` 才会发布。

GitHub Pages 的发布来源为 Settings → Pages → Build and deployment → Source → GitHub Actions。工作流读取 Pages 的基础路径，单独构建网站资源，避免项目子路径下的 JS/CSS 加载失败；Release 中的前端 ZIP 保持通用根路径构建。Pages 部署只等待前端任务，不等待固件编译；已落后于 `main` 的构建不会覆盖较新的网站。部署成功后可在工作流的 `github-pages` 环境中查看访问链接。

连接设备时，GitHub Pages 对应的网站来源为 `https://jackhuang90.github.io`，不包含 `/coffee-workbench/` 路径；请在设备配网设置中确认允许该来源。不同站点来源的浏览器本地曲线库相互独立，换站点前应先导出数据，再在新站点导入。

前端使用 Node.js 24 和 `npm ci` / `npm run check`。固件使用 Python 3.12、PlatformIO 6.2.0 和 `platformio.ini` 中固定的 SDK，复用 `tools/build_release.py` 清理构建、校验输入、审计栈帧并收集镜像。`s3_network_compilecheck` 仅参与编译校验，不作为交付镜像。

在 [Releases](https://github.com/JackHuang90/coffee-workbench/releases) 中下载：

- `coffee-workbench-web.zip`：可部署到静态网站服务器的前端文件，解压后请通过 HTTP/HTTPS 访问。
- `coffee-workbench-firmware.zip`：只包含 `s3_locked/`、`s3_virtual_demo/` 两个目录下的 `.bin` 固件和顶层 `SHA256SUMS`；不包含 ELF、日志、配置、构建元数据或文档。刷机说明见 Release 中对应源码版本的文档链接。
- `SHA256SUMS`：两个下载包的校验和；固件包内另有 `SHA256SUMS` 校验每个固件文件。

自动标签格式为 `build-<构建编号>-<提交短哈希>`，指向实际构建的提交。每次推送生成独立版本，重新运行同一次构建会更新对应版本的附件。自动版本标记为预发布，正式版本可在 GitHub 上核验后手动发布。手动下载前端 ZIP 不会触发部署，网站由 Actions 中的 Pages 任务更新。

工作流使用 GitHub 自动提供的 `GITHUB_TOKEN`，无需添加个人令牌或其他 Secrets；Release 任务单独申请 `contents: write`，Pages 部署任务单独申请 `pages: write` 与 `id-token: write`。仓库或组织需允许 GitHub Actions 运行官方 `actions/*`，并允许对应发布权限。前端失败会阻止网站部署和 Release；固件失败会阻止 Release，可在 Actions 中查看日志。

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

源码、文档、测试样例、发布说明及交付包均不得包含私人站点发布地址、私人域名、真实凭据或个人机器路径。用户已明确允许公开的本项目 GitHub Pages 地址可以写入项目文档；其他部署地址由使用者自行保存与填写。需要网址示例时统一使用 `https://example.com`，本机工具路径使用明确标注的通用示例。提交、打包或发布前应检查正文、链接目标、配置及生成文件，日志中的设备标识也应脱敏。

## 第三方测试数据

Artisan 官方测试夹具及其原有许可证和来源说明保留在 [`source/tests/fixtures/artisan/`](source/tests/fixtures/artisan/NOTICE.md)。用户曲线测试夹具使用已脱敏版本。
