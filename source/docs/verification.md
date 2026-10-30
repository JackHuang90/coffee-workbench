# v2 验证记录 — 2026-10-28

> The earlier sections below record the v2 milestone. The Artisan/local-bridge phase is recorded in [verification-artisan-web.md](verification-artisan-web.md); the latest provisioning/direct-connection phase is in [verification-provisioning.md](verification-provisioning.md). Old “no firmware” and platform-coverage boundaries are historical, not the current feature inventory.

本记录只覆盖本次代码与真实执行的检查。重建基线为 `1e21414601a8364ed8aa19e05ab7c4899aea660a`（125 tests）；不会把旧结果当成本次验证证据。

## 自动化检查

```sh
npm test
npm run typecheck
npm run build
git diff --check
```

最终源码检查：**175 tests / 10 files 全部通过，TypeScript、Vite production build 与 `git diff --check` 通过。** 命令在生成装饰素材、最终派生值修正和源码整理后重新执行。

新增覆盖：

- v1 只读与显式 v2 转换，原始样本、ID、笔记和历史事件保留；新增重量和修正事件不丢失。
- 全部中文事件、可选阶段事件、时间编辑、撤销、TP 持续回温与噪声/缺口抑制、确认候选的有效范围。
- 连续区间插值、阶段比例/DTR、缺失温度与 RoR 窗口。
- 独立、确定性热模型与 PID；输出限制/抗积分饱和；目标预检、明确起点、手动接管、停止/完成/故障归零。
- 参考改变、文档替换、重置、完成后回放、暂停恢复和卸载；运行态才持有仿真定时器。
- 参考图形与控制器时间原点一致；完成后回放的目标值随回放光标更新；RoR 有用视窗与完整范围选择。
- 对话框 Escape/焦点圈定，包括折叠 details 内的不可见控件。
- 原有 IndexedDB、回滚、配额、重命名事务、保存期间替换/编辑保护仍保留。

测试先失败再实现。独立全差异审查提出四项重要问题：v1 新编辑丢失、仿真终态干扰回放、参考图形原点错位、折叠 details 的键盘焦点。均以 RED→GREEN 回归测试修复，未留下已知 Critical/Important 问题。它不是像素视觉审查。

## 真实浏览器检查（父任务执行）

通过支持的 Sites managed preview，在实际 **1180×757** viewport 验证 document scrollWidth=1180 / scrollHeight=757，无整页滚动；开始仿真和保存均在首屏。

已实际操作：开始仿真 → 手动入豆 → 手动接管仿真，目标偏差/状态/手动模拟加热滑条显示；停止仿真文案与输出归零；风门无实际反馈标识清晰。

**1366×768 与 1440×900 是布局目标，尚未获得这两个精确 viewport 的直接浏览器验证。** 浏览器响应式开发者工具被组织策略明确禁用，未重试、绕过或修改策略。没有把生成图或单元测试冒充浏览器截图；移动 viewport 尚未直接验证。

## 边界

没有硬件传输、固件构建产物或真实执行器输出。无后端数据库，未新增生产依赖。已有源代码与 Git 历史保留，源包由父任务在最终验证后打包。npm 的环境级 http-proxy 配置提示不影响测试或构建。

## 生成装饰素材与最终预览边界

新增 `src/assets/coffee-bean-stages.png`（2172×724 RGBA，三格原样复制），header 32px / 阶段 25px 背景精灵，不扩大布局高度；仅为 AI 生成装饰，不是豆色检测。加热图标改为清晰火焰轮廓。

素材接入后的父任务浏览器刷新/截图遇到 CDP refresh-tabs 超时，随后 listTabs 也超时并发生 kernel reset。没有绕行；因此**不声称最终素材已获新的真实截图验证**。此前 1180×757 真实浏览器证据仍有效，但仅覆盖此前已验状态。部署后的浏览器确认由父任务继续负责。
