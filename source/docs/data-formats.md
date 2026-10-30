# 曲线文件与本地兼容性

> Current native interchange is Artisan `.alog`; see [artisan-files.md](artisan-files.md). The JSON/CSV schemas below remain secondary backup/basic-data options.

所有导入值都只是数据。解析器使用 `JSON.parse` 和严格数值 CSV 解析，不使用 `eval`，不执行事件、脚本、URL、导入命令或设备操作。先校验预览，再确认打开草稿；另行点击保存才写入浏览器库。单条导入生成新的本地 ID，不覆盖同 ID 的库中记录。

## JSON v1 — 保持兼容

```json
{
  "schemaVersion": 1,
  "id": "legacy-roast-1",
  "name": "历史烘焙手记",
  "notes": "原始笔记保留",
  "createdAt": "2026-10-28T00:00:00.000Z",
  "updatedAt": "2026-10-28T00:00:00.000Z",
  "samples": [
    { "t": 0, "bt": 180, "et": 200 },
    { "t": 2, "bt": 175, "et": null }
  ],
  "markers": [{ "kind": "CHARGE", "t": 0 }]
}
```

读取旧库不写入，不更改数据库版本或清空旧记录。显式保存时升级为 v2，保持 `id`、名称、笔记、原始 `samples` 和事件的 `kind/t`；历史来源标记 `legacy`，不能推断为手动事件。用户此后明确编辑的事件才记为 `manual`。新填写的重量与事件温度/插值来源也保留。仅更新名称、格式版本与保存时间等用户操作涉及的字段。

## JSON v2 — 手记备份格式

```json
{
  "schemaVersion": 2,
  "id": "roast-2",
  "name": "曲线跟踪仿真",
  "notes": "独立模型生成，非设备读数",
  "createdAt": "2026-10-28T00:00:00.000Z",
  "updatedAt": "2026-10-28T00:00:00.000Z",
  "source": "simulation",
  "inputWeight": 200,
  "outputWeight": 172,
  "samples": [
    { "t": 0, "bt": 180, "et": 200 },
    { "t": 2, "bt": 179.8, "et": 198 }
  ],
  "markers": [
    { "kind": "CHARGE", "t": 0, "bt": 180, "source": "manual", "temperatureSource": "sample" }
  ]
}
```

- `t`：0–86400 的有限秒数；样本严格递增。
- `bt/et`：−50–500°C 有限数值，或 `null`（缺失）。不使用虚构的零读数。
- 单条文件 2–15000 样本；JSON 备份最大 8 MiB UTF-8 文本（原生附件自身仍限 2 MiB），CSV 与 .alog 最大 2 MiB；名称 1–120 字符，笔记最多 4000 字符。
- `source` 必须为 `legacy | simulation | imported | example`。CSV 使用 `imported`；确定性示例使用 `example`。
- 可选 `inputWeight/outputWeight`：正数且不超过 100000g，或 `null`。出豆重不得高于入豆重。未填写不计算失重率。
- 事件内部顺序：`CHARGE → TP → DRY → FCs → FCe → SCs → SCe → DROP → COOL`。中文分别为入豆、回温点、脱水结束、一爆开始、一爆结束、二爆开始、二爆结束、出豆、冷却结束。
- 事件唯一，时间非递减且在采样区间内；可导入部分事件列表，缺失阶段边界不补造。录制 UI 还要求必要前置事件，例如一爆开始之前需已标记脱水结束。
- 事件 `bt` 可选且可为 `null`。`source` 为 `legacy | manual | imported | example`；`temperatureSource` 为 `sample | interpolated | unavailable`。样本温度继承整条曲线的数据性质：仿真中的 `sample` **不是物理测量**。
- UTC 日期须为完整 ISO 字符串；ID 为受限安全标识符。JSON 工作台层的未知字段会被丢弃；可选 nativeArtisan 原生附件通过独立有界校验后保留，不会把原生未知字段提升为可执行应用字段。

## 整库 JSON 备份

曲线库和设置均提供“导出整库备份”。读取当前已保存的全部条目，不自动保存未保存草稿，不进行迁移或删除。

```json
{
  "format": "coffee-roasting-library",
  "version": 1,
  "exportedAt": "…",
  "curves": [
    { "schemaVersion": 1, "…": "…" },
    { "schemaVersion": 2, "…": "…" }
  ]
}
```

该包装保留各曲线当前格式，便于独立备份。**当前界面的导入器接收单条曲线，而非整库包装**：恢复时从 `curves` 数组取出每个对象保存为单独 JSON，再校验、打开和明确保存。整库直接批量恢复尚未实现。未保存草稿应另行导出单条 JSON。

## 数值 CSV

```csv
time_s,bt_c,et_c
0,180,200
2,175,
4,170,198
```

`time_s` 必须存在；至少包含 `bt_c` 或 `et_c`。列名精确匹配，无重复或未知列，允许列顺序变化、BOM、CRLF。缺失温度列或空温度单元格变为 `null`；时间不能为空。只接受有限十进制数字（可含科学计数法），拒绝公式、十六进制、引号字段和额外元数据。

CSV **不保留名称、笔记、事件、来源及重量**。工作台手记备份使用 JSON；与 Artisan 交换使用原生 .alog。原生字面量、官方样本与 Python 解析器的测试不等于实际 Artisan GUI 验证。

## 派生值与仿真

ΔBT/RoR 和 ΔET 使用连续 30 秒窗口，单位 °C/min。任一通道缺失/无效、时间逆序或间隔超过显示阈值都会重置该通道窗口。显示阈值为观测中位采样间隔的 2.5 倍，限制在 5–15 秒（不足 4 个间隔时按 2 秒 cadence）；这与固件上传曲线的最大 5 秒间隔规则不同。默认 RoR 视窗为 −10～30，超出数据有文字提示，可切完整范围；裁剪显示不更改原始数据或实时数值。

参考目标按入豆事件对齐；无入豆事件时，用户必须明确确认首个样本为起点。只在连续有效段内线性插值，不跨缺口或外推。阶段时长/DTR 由已确认事件计算；出豆之后停止增长。TP 算法只提供候选，不自动生成事件。

闭环仿真在有限目标末端完成并归零；目标空缺、时间间断、非法反馈或模型越界进入故障保护。浏览器只调度离线模型；真实设备必须使用本地固件调度与安全联锁。

## 可选原生附件与迁移

`nativeArtisan` 包含格式标识 `artisan-alog`、附件版本 `1`、有界 UTF-8 原文件 `sourceText`、原首点 `displayOriginSeconds`、来源名 `sourceName`。每个原生文件最大 2 MiB；原生语法、样本与原点在导入/备份恢复时重新校验。它是现有 v1/v2 记录中的可选字段，不需要改动 IndexedDB 数据库版本或迁移旧条目。读旧条目不写入；显式保存只升级目标条目。存储空间不足或事务中止时，旧版本原子保留，当前草稿仍可导出。

托管 Site 与 localhost 是不同浏览器 origin，各有独立库；需要用户主动导出/导入，不偷偷同步本地数据。

原生文本在 JSON 中转义，同时还包含可编辑投影，所以单条 JSON 备份使用独立的 8 MiB 导入/导出上限。导出先检查同一上限，避免产生本工具不能恢复的单条备份；原生附件解析和所有核心样本限制不放宽。
