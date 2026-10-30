/** 功能：定义曲线、事件与可选品饮标签的持久化契约。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 增加可选风味标签、记录卡与设备演示来源，保持旧版本兼容。 */
export interface Sample {
  t: number;
  bt: number | null;
  et: number | null;
}
export type MarkerKind = "CHARGE" | "TP" | "DRY" | "FCs" | "FCe" | "SCs" | "SCe" | "DROP" | "COOL";
export type DataSource = "legacy" | "simulation" | "imported" | "example" | "device-demo";
export interface Marker {
  kind: MarkerKind;
  t: number;
  bt?: number | null;
  source?: "legacy" | "manual" | "imported" | "example";
  temperatureSource?: "sample" | "interpolated" | "unavailable";
}
/** Lossless native source is inert data, not a command/configuration source. */
export interface NativeArtisanAttachment {
  format: "artisan-alog";
  version: 1;
  sourceText: string;
  displayOriginSeconds: number;
  sourceName: string;
}
/** 功能：保存单锅曲线及人工品饮信息，不存储可执行设备命令。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 增加可选风味标签和记录卡契约。 */
export interface RoastCurve {
  /** 可选记录卡、品饮、计划和开始时参考；旧记录没有此字段。 */
  journal?: RoastJournal;
  /** 原有持久化版本，新增可选字段不强制迁移。 */
  schemaVersion: 1 | 2;
  /** 保留原生文件全文与原始时间基准。 */
  nativeArtisan?: NativeArtisanAttachment;
  /** 本地库中稳定的曲线标识。 */
  id: string;
  /** 用户可编辑的曲线名称。 */
  name: string;
  /** 人工填写的烘焙和品饮观察。 */
  notes: string;
  /** 人工点选的风味描述词标识；未记录时省略。 */
  flavorTags?: string[];
  /** 创建时间，使用 UTC ISO 字符串。 */
  createdAt: string;
  /** 最近显式保存的 UTC 时间。 */
  updatedAt: string;
  /** 按时间递增的原始温度采样。 */
  samples: Sample[];
  /** 已确认或导入的阶段标记。 */
  markers: Marker[];
  /** 数据来源；旧版可未声明。 */
  source?: DataSource;
  /** 人工填写的入豆克重，未填写时为空。 */
  inputWeight?: number | null;
  /** 人工填写的出豆克重，未填写时为空。 */
  outputWeight?: number | null;
}
export type Phase = "prep" | "drying" | "browning" | "development" | "cooling";

/** 功能：保存一次主观品饮观察。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export interface Tasting {
  /** 品饮记录稳定标识。 */
  id: string;
  /** 用户选择的本地日历日期。 */
  date: string;
  /** 冲煮方式与参数简记。 */
  method: string;
  /** 人工描述，不推断烘焙因果。 */
  notes: string;
}
/** 功能：保存下一锅单变量实验计划。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export interface RoastExperiment {
  /** 期望改善的品饮表现。 */
  goal: string;
  /** 本次打算改变的单一变量。 */
  change: string;
  /** 计划保持一致的其他条件。 */
  keep: string;
}
/** 功能：记录可解释的人工操作或采集中断。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export interface RoastAction {
  /** 相对记录起点的秒数。 */
  t: number;
  /** 操作发生的 UTC 时间。 */
  at: string;
  /** 面向用户的操作摘要，只有确实发生时写入。 */
  text: string;
}
/** 功能：扩展便携曲线的复盘信息，不含可执行控制命令。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export interface RoastJournal {
  /** 豆批或豆名，可为空。 */
  bean: string;
  /** 机器和探针简记，可为空。 */
  machine: string;
  /** 实际烘焙的本地日历日期；导入时不使用文件创建日代替。 */
  roastDate: string;
  /** 同一锅不同时间的品饮观察，最多 100 次。 */
  tastings: Tasting[];
  /** 人工操作日志，最多保留 1000 条。 */
  actions: RoastAction[];
  /** 下一锅需要用户自行执行的计划。 */
  experiment?: RoastExperiment;
  /** 开始时参考曲线快照，不得再含 journal 或原生附件。 */
  reference?: RoastCurve;
}
