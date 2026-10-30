# 风味盘与导入检查实施计划

> 执行：在当前开发目录按 executing-plans / test-driven-development 完成；用户已明确要求落实开发。

**目标：** 核实并保留事件顺序，新增配合现有风格的可交互风味盘，完善 .alog 确认前检查弹窗。

**设计与架构：** 使用 Vue / TypeScript 和原创 SVG，无新增依赖。风味盘置于独立宽弹窗，由页头入口与手记入口打开；8 个自定义风味家族、32 个描述词，点击选择、再次点击取消，选择随当前曲线草稿变脏并显式保存。原生 SCA 图仅作外部参考，不复制其布局、术语全集或图像。导入检查复用曲线库弹窗，替换内容，避免嵌套对话框；确认前不替换草稿、不保存、不连接设备。

**范围：** 事件 canMark() 已按前置事件与时间顺序启用，出豆允许提前、可选事件可跳过，不改为强制线性流程。保留原始 .alog、非执行性控制事件和旧 v1/v2 数据。不修改当前未提交的固件工作。风味标签为可选 flavorTags，保存到 IndexedDB / JSON；.alog 用独立工作台扩展字段往返，不覆盖 Artisan 的杯测评分字段。

## 任务与验证

- [x] 风味数据：src/core/flavors.ts、types.ts、serialization.ts、alog.ts；tests/flavors.test.ts 验证保存/备份/原生往返、标签去重、无效值拒绝、旧曲线不添加空字段。
- [x] 风味交互：components/FlavorWheel.vue、App.vue；tests/flavor-ui.test.ts 验证选择/取消、草稿脏标记、保存后重开；SVG 与按钮均可键盘操作，小屏可滚动。
- [x] 导入检查：core/import-inspection.ts、components/ImportPreview.vue、LibraryPanel.vue、App.vue；tests/import-inspection.test.ts / import-preview.test.ts 验证 BT/ET 分别统计、缺失标记、华氏转换、明确类型映射、未知/损坏事件不猜测、取消和旧草稿保护。
- [x] 验证：npm test、npm run build；Chrome 查看桌面与窄屏，验证实际可点选风味盘和 .alog 检查/取消/确认，记录证据。

## 重点边界

- 有效点按通道分别计数；全缺失通道显示 0，不能用总采样数冒充有效数。
- CHARGE 缺失使用首点相对时间并明确标注；FCs / DROP 缺失不补造事件。
- specialeventstype 必须结合 etypes 明确名称；并行数组不一致、索引越界或非数值字段列为未确认。
- 选择仅修改草稿；取消导入保留原稿，保存失败不能把 UI 标为已保存。
- 原生未编辑文件仍原样导出；工作台风味字段只在选择有变化时写入。

## 进度

- 已核对 canMark() 和既有导入预览；无需重复开发事件顺序。
- 已查阅 SCA 风味轮与 WCR Sensory Lexicon，使用原创个人品饮盘并链接参考。
- 已完成；后续追加的贝塞尔补全见 2026-10-30-curve-gap-repair.md。最终 25 文件 / 439 测试通过，构建成功，浏览器证据与边界见 ../../verification-flavor-import.md。
