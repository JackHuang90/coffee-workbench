# 风味盘、导入检查与短缺口补全验证

日期：2026-10-30（上海时间）。本轮为本地源码开发与构建验证，未发布线上站点。

## 完成内容

- 复核 `canMark()`：已有前置事件和时间顺序限制，同时允许跳过可选事件；保留原逻辑。
- 新增原创 SVG 风味盘，8 个家族、32 个描述词，支持点击和键盘选择、取消、多选。选择修改草稿，显式保存后进入曲线库，JSON / `.alog` 可往返；Artisan 原生 `flavors`、`flavorlabels`、`cuppingnotes` 保持不变。
- `.alog` / JSON / CSV 导入确认前检查：名称、原始温标、BT/ET 分别计数和范围、入豆/一爆/出豆、火力/风量事件。不按数字类型猜测含义；数组损坏和类型不明确时列为未确认。
- 缺少独立事件温度的旧曲线可读取实际采样，线性插值标为“插值”；存在短缺口时可显示“贝塞尔估算”，不会自动添加缺失事件。
- 导入预览与主图提供可关闭的贝塞尔补全，实测线与估算虚线分层；关闭后孤立实测点仍显示。

## 补全策略与限制

- 只估算有左右实测端点的内部短缺口。最大端点间距 `min(30, max(6, 3 × medianCadence))` 秒。周期不足时沿用工作台的 2 秒默认值。
- 有足够样本时，超过 1.5 倍采样周期的时间间隔视为可能漏行；显式缺失温度逐通道处理。
- 三次贝塞尔控制点使用相邻割线的保形切线并限制在两端温度范围；平台/转向切线归零。仅有两端数据时退化为直线插值。
- 这些规则是保守的显示策略，并不能恢复真实测量或证明缺口内实际单调。长缺口、首尾缺失、全空通道不外推。
- 不修改原始 samples、事件、有效点数、保存、导出、RoR、预测或控制输入。主图只使用当前游标之前的数据，不能从未来样本补全当前缺口。
- 参考：[SciPy PCHIP 保形切线说明](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.PchipInterpolator.html)、[MDN 三次贝塞尔 SVG 定义](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/d)。没有新增第三方运行依赖。

## 自动验证

- 新增用例先失败，后实现通过。覆盖风味保存/重开、原生杯测字段保留、取消导入保护旧草稿、华氏温标、缺失值、事件识别、贝塞尔有界性、长缺口、非法时间、开关、游标边界和孤立实测点。
- 最终 `npm test -- --reporter=dot`：**25 个文件、439 项测试全部通过**。
- Windows PATH 中的旧 Strawberry GCC 不支持 C++17，首次全量测试因原生 HTTP oracle 编译失败；用项目已有 `firmware/.tools/w64devkit/bin/g++.exe` 显式设置 `CXX` 后全量通过，无跳过原生 oracle。
- `npm run build`：Vue 类型检查与 Vite 构建成功。
- 独立代码复核发现并修复旧事件温度、风味弹窗保存错误提示及主图孤立实测点；最终无剩余重要问题。

## 浏览器验证

Windows Chrome、本地构建预览 `http://127.0.0.1:4175/`：

- 桌面点击茉莉、选中反馈和风味弹窗；390 × 844 视口查看风味盘与按钮。
- 63 点合成 `.alog` 样本使用 °F，BT 缺失 2 点、ET 缺失 1 点；预检仍显示 61/63 与 62/63，识别火力/风量各 2 条。
- 开启补全出现 2 段虚线；关闭恢复断线，计数不变；确认后主图显示相同估算段且记录为未保存草稿。
- 390px 视口中补全选项和统计卡可正常换行、纵向滚动；完成后恢复桌面视口。

证据：

- [风味盘桌面](evidence/flavor-import/flavor-wheel-desktop.jpg)
- [风味盘窄屏](evidence/flavor-import/flavor-wheel-mobile.jpg)
- [带补全的导入检查](evidence/flavor-import/alog-import-bezier.jpg)
- [导入检查窄屏](evidence/flavor-import/alog-import-bezier-mobile.jpg)
- [主图补全](evidence/flavor-import/curve-bezier.jpg)

未进行实机烘焙、传感器或执行器验证；本轮功能没有新增硬件命令。
