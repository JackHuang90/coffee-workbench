/** 功能：在独立 IndexedDB 保存可恢复草稿，不覆盖正式曲线库。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
import { CurveLibrary } from "./library";
import { validateCurve } from "../core/serialization";
import type { RoastCurve } from "../core/types";

/** 功能：允许开局单个采样，恢复时校验记录，继承事务完成保证。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export class DraftRepository extends CurveLibrary {
  /** 功能：选择独立草稿库。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  constructor(name = "roast-studio-drafts") {
    super(name);
  }
  /** 功能：返回通过校验的草稿，错误时保留原始存储。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  override async list(): Promise<RoastCurve[]> {
    return (await super.list()).map((value) => validateCurve(value, true));
  }
  /** 功能：校验并提交草稿，允许一采样和正在编辑的空名称。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
  override async save(curve: RoastCurve): Promise<void> {
    await super.save(validateCurve(curve, true));
  }
}
