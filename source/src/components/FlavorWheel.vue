<script setup lang="ts">
/** 功能：绘制原创可交互品饮风味盘，通过标签事件编辑当前草稿。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写，支持键盘、触屏和已选标签。 */
import { computed, ref } from "vue";
import { flavorDescriptors, flavorFamilies } from "../core/flavors";

const props = defineProps<{ modelValue: string[] }>();
const emit = defineEmits<{ "update:modelValue": [value: string[]] }>();
const activeFamily = ref<string>(flavorFamilies[0].id);
const family = computed(() => flavorFamilies.find((item) => item.id === activeFamily.value)!);
const selected = computed(() =>
  flavorDescriptors.filter((item) => props.modelValue.includes(item.id)),
);

/** 功能：将圆周角度转换为 SVG 坐标。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function point(radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: 260 + radius * Math.cos(radians), y: 260 + radius * Math.sin(radians) };
}
/** 功能：生成留有细缝的环形扇区路径。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function arc(inner: number, outer: number, start: number, end: number) {
  const a = point(outer, start + 0.5),
    b = point(outer, end - 0.5),
    c = point(inner, end - 0.5),
    d = point(inner, start + 0.5);
  return `M ${a.x} ${a.y} A ${outer} ${outer} 0 0 1 ${b.x} ${b.y} L ${c.x} ${c.y} A ${inner} ${inner} 0 0 0 ${d.x} ${d.y} Z`;
}
/** 功能：旋转外圈文字并使左半圆文字保持正向可读。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function labelTransform(angle: number) {
  const p = point(186, angle);
  return `translate(${p.x},${p.y}) rotate(${angle - 90 + (angle > 180 ? 180 : 0)})`;
}
/** 功能：切换一个描述词，保持其他已选词不变。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function toggle(id: string) {
  emit(
    "update:modelValue",
    props.modelValue.includes(id)
      ? props.modelValue.filter((item) => item !== id)
      : [...props.modelValue, id],
  );
}
/** 功能：提供 SVG 按钮的 Enter 和空格操作，阻止空格滚动。首次编写日期：2026-10-30。变更日期：2026-10-30。修改记录：2026-10-30 首次编写。 */
function activate(event: KeyboardEvent, action: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
}
</script>

<template>
  <div class="flavor-intro">
    <p class="eyebrow">A LITTLE TASTE JOURNAL</p>
    <h3>从一缕香气，记住这一锅。</h3>
    <p>点内圈探索风味家族，点外圈记录你的感受。可以多选，再点一次取消。</p>
  </div>
  <div class="flavor-layout">
    <div class="wheel-wrap">
      <svg
        viewBox="0 0 520 520"
        class="flavor-wheel"
        role="group"
        aria-label="咖啡风味盘，8 个家族、32 个描述词"
      >
        <circle cx="260" cy="260" r="254" fill="none" stroke="#e8dfd4" />
        <g v-for="(group, index) in flavorFamilies" :key="group.id">
          <g
            role="button"
            tabindex="0"
            :aria-label="`探索${group.label}`"
            :aria-pressed="activeFamily === group.id"
            class="family-segment"
            @click="activeFamily = group.id"
            @keydown="activate($event, () => (activeFamily = group.id))"
          >
            <path
              :d="arc(70, 130, index * 45, (index + 1) * 45)"
              :fill="group.color"
              :class="{ active: activeFamily === group.id }"
            />
            <text
              :x="point(100, index * 45 + 22.5).x"
              :y="point(100, index * 45 + 22.5).y"
              text-anchor="middle"
              dominant-baseline="central"
              class="family-label"
            >
              {{ group.label }}
            </text>
          </g>
          <g
            v-for="(item, offset) in group.items"
            :key="item.id"
            role="button"
            tabindex="0"
            :aria-label="item.label"
            :aria-pressed="modelValue.includes(item.id)"
            :data-flavor="item.id"
            class="flavor-segment"
            @click="toggle(item.id)"
            @keydown="activate($event, () => toggle(item.id))"
          >
            <path
              :d="arc(135, 247, index * 45 + offset * 11.25, index * 45 + (offset + 1) * 11.25)"
              :fill="group.pale"
              :class="{ selected: modelValue.includes(item.id) }"
            />
            <text
              :transform="labelTransform(index * 45 + (offset + 0.5) * 11.25)"
              text-anchor="middle"
              dominant-baseline="central"
              class="descriptor-label"
            >
              {{ modelValue.includes(item.id) ? "✓ " : "" }}{{ item.label }}
            </text>
          </g>
        </g>
        <circle cx="260" cy="260" r="63" fill="#fffcf8" stroke="#e4dcd3" />
        <text x="260" y="251" text-anchor="middle" class="wheel-center">这一锅</text>
        <text x="260" y="276" text-anchor="middle" class="wheel-count">
          {{ selected.length ? `${selected.length} 种风味` : "细细品味" }}
        </text>
      </svg>
      <p class="wheel-caption">个人品饮记录 · 风味描述不代表品质分数</p>
    </div>
    <div class="flavor-detail">
      <section class="flavor-family-card" :style="{ '--family-color': family.color }">
        <span class="family-dot" /><span class="eyebrow">慢慢辨认</span>
        <h3>{{ family.label }}</h3>
        <div class="flavor-options">
          <button
            v-for="item in family.items"
            :key="item.id"
            :aria-pressed="modelValue.includes(item.id)"
            :class="{ chosen: modelValue.includes(item.id) }"
            @click="toggle(item.id)"
          >
            {{ item.label
            }}<span aria-hidden="true">{{ modelValue.includes(item.id) ? " ✓" : " ＋" }}</span>
          </button>
        </div>
      </section>
      <section class="selected-flavors" aria-live="polite">
        <div class="selection-heading">
          <h3>这一锅的风味</h3>
          <span>{{ selected.length }} / 32</span>
        </div>
        <div v-if="selected.length" class="selected-tags">
          <button
            v-for="item in selected"
            :key="item.id"
            :aria-label="`移除${item.label}`"
            @click="toggle(item.id)"
          >
            {{ item.label }} <span aria-hidden="true">×</span>
          </button>
        </div>
        <p v-else class="subtle">先选一个最明显的感受。<br />没有尝到的风味，可以留空。</p>
        <p class="small-note">选择会加入当前曲线草稿，点击下方保存后留在曲线库。</p>
      </section>
      <details class="flavor-reference">
        <summary>关于这张风味盘</summary>
        <p>工作台原创简化品饮盘，使用常见描述词，不是 SCA 官方风味轮，也不代替专业杯测。</p>
        <p>
          <a href="https://sca.coffee/store/flavor-wheel" target="_blank" rel="noopener noreferrer"
            >SCA 风味轮参考 ↗</a
          ><br /><a
            href="https://worldcoffeeresearch.org/read-more/news/174-world-coffee-research-sensory-lexicon"
            target="_blank"
            rel="noopener noreferrer"
            >WCR 感官词典 ↗</a
          >
        </p>
      </details>
    </div>
  </div>
</template>

<style scoped>
.flavor-intro {
  display: grid;
  gap: 8px;
}
.flavor-intro h3 {
  font-size: 24px;
  font-family: Georgia, "Noto Serif SC", serif;
  font-weight: 500;
}
.flavor-intro > p:last-child {
  font-size: 13px;
  color: var(--muted);
  line-height: 1.7;
}
.flavor-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(220px, 1fr);
  gap: 24px;
  align-items: center;
  margin-top: 16px;
}
.wheel-wrap {
  min-width: 0;
}
.flavor-wheel {
  width: 100%;
  display: block;
  overflow: visible;
}
.flavor-wheel g[role="button"] {
  cursor: pointer;
  outline: none;
}
.flavor-wheel g[role="button"]:focus-visible path {
  stroke: #307ea7;
  stroke-width: 4px;
}
.flavor-wheel path {
  transition:
    stroke 0.15s,
    filter 0.15s;
  stroke-width: 1px;
  stroke: #fffcf8;
}
.flavor-wheel g[role="button"]:hover path {
  filter: brightness(0.95);
}
.flavor-wheel path.selected,
.flavor-wheel path.active {
  stroke: #75503b;
  stroke-width: 2.5px;
}
.family-label {
  fill: #2f251f;
  font-size: 15px;
  font-weight: 650;
  pointer-events: none;
}
.descriptor-label {
  fill: #3d2d25;
  font-size: 12px;
  pointer-events: none;
}
.wheel-center {
  fill: #51392b;
  font:
    22px Georgia,
    "Noto Serif SC",
    serif;
}
.wheel-count {
  fill: #80776f;
  font-size: 12px;
}
.wheel-caption {
  text-align: center;
  font-size: 11px;
  color: var(--muted);
  margin-top: 8px;
}
.flavor-detail {
  display: grid;
  gap: 22px;
}
.flavor-family-card {
  border-top: 2px solid var(--family-color);
  padding-top: 16px;
}
.family-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  background: var(--family-color);
  border-radius: 50%;
  margin-right: 8px;
}
.flavor-family-card h3 {
  margin: 8px 0 12px;
  font-size: 22px;
  font-weight: 500;
}
.flavor-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.flavor-options button {
  display: flex;
  justify-content: space-between;
  min-height: 40px;
  text-align: left;
  font-size: 13px;
}
.flavor-options .chosen {
  background: #eee1d5;
  border-color: #b68163;
}
.selection-heading {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
  align-items: center;
}
.selection-heading span {
  color: var(--muted);
  font-size: 12px;
}
.selected-flavors > p {
  font-size: 13px;
  line-height: 1.8;
}
.selected-flavors .small-note {
  margin-top: 14px;
  font-size: 11px;
}
.selected-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.selected-tags button {
  border-radius: 20px;
  background: #f2e7dc;
  font-size: 12px;
}
.selected-tags span {
  margin-left: 5px;
}
.flavor-reference {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.8;
}
.flavor-reference summary {
  cursor: pointer;
}
.flavor-reference p {
  margin-top: 6px;
}
.flavor-reference a {
  color: #806148;
}
@media (max-width: 600px) {
  .flavor-layout {
    grid-template-columns: 1fr;
    gap: 20px;
  }
  .flavor-intro h3 {
    font-size: 20px;
  }
  .flavor-detail {
    gap: 16px;
  }
}
</style>
