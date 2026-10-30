/**
 * 功能：提供工作台原创品饮词汇与有界标签校验，不等同于官方杯测评分标准。
 * 首次编写日期：2026-10-30
 * 变更日期：2026-10-30
 * 修改记录：2026-10-30 首次编写，支持风味盘显示和跨格式持久化。
 */
export const flavorFamilies = [
  {
    id: "floral",
    label: "花香",
    color: "#c18d95",
    pale: "#f0dde0",
    items: [
      { id: "jasmine", label: "茉莉" },
      { id: "rose", label: "玫瑰" },
      { id: "osmanthus", label: "桂花" },
      { id: "orange-blossom", label: "橙花" },
    ],
  },
  {
    id: "fruit",
    label: "鲜果",
    color: "#bf815e",
    pale: "#f2dfcf",
    items: [
      { id: "lemon", label: "柠檬" },
      { id: "orange", label: "甜橙" },
      { id: "peach", label: "蜜桃" },
      { id: "berry", label: "莓果" },
    ],
  },
  {
    id: "dried-fruit",
    label: "果干",
    color: "#ac7e78",
    pale: "#ead7d3",
    items: [
      { id: "raisin", label: "葡萄干" },
      { id: "date", label: "红枣" },
      { id: "fig", label: "无花果" },
      { id: "dried-longan", label: "桂圆干" },
    ],
  },
  {
    id: "sweet",
    label: "甜香",
    color: "#c3a267",
    pale: "#f3e8cb",
    items: [
      { id: "honey", label: "蜂蜜" },
      { id: "caramel", label: "焦糖" },
      { id: "brown-sugar", label: "红糖" },
      { id: "vanilla", label: "香草" },
    ],
  },
  {
    id: "nutty",
    label: "坚果",
    color: "#ad9570",
    pale: "#eadeca",
    items: [
      { id: "almond", label: "杏仁" },
      { id: "hazelnut", label: "榛子" },
      { id: "walnut", label: "核桃" },
      { id: "peanut", label: "花生" },
    ],
  },
  {
    id: "cocoa",
    label: "可可",
    color: "#a4806c",
    pale: "#e6d7cc",
    items: [
      { id: "cocoa", label: "可可粉" },
      { id: "dark-chocolate", label: "黑巧克力" },
      { id: "milk-chocolate", label: "牛奶巧克力" },
      { id: "cocoa-nib", label: "可可碎" },
    ],
  },
  {
    id: "spice",
    label: "香料",
    color: "#b98268",
    pale: "#eddacf",
    items: [
      { id: "cinnamon", label: "肉桂" },
      { id: "clove", label: "丁香" },
      { id: "nutmeg", label: "肉豆蔻" },
      { id: "pepper", label: "胡椒" },
    ],
  },
  {
    id: "botanical",
    label: "草木",
    color: "#8d9b7b",
    pale: "#e0e6d7",
    items: [
      { id: "black-tea", label: "红茶" },
      { id: "green-tea", label: "绿茶" },
      { id: "herbal", label: "青草" },
      { id: "cedar", label: "雪松" },
    ],
  },
] as const;

export const flavorDescriptors = flavorFamilies.flatMap((family) =>
  family.items.map((item) => ({ ...item, family: family.label })),
);
const known = new Set<string>(flavorDescriptors.map((item) => item.id));

/** 功能：校验可选风味标签并按原顺序去重，拒绝不认识的词汇和超长数据。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
export function validateFlavorTags(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 64 ||
    value.some((item) => typeof item !== "string" || !known.has(item))
  ) {
    throw new Error("风味标签须为工作台支持的描述词列表，最多 64 项。");
  }
  return [...new Set(value as string[])];
}
