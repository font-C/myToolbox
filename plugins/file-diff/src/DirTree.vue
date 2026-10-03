<script setup>
/**
 * DirTree — 目录树渲染（目录折叠展开 + 文件状态行）。
 * 树模型由 dirtree.buildDirTree 构建；点击文件行向上抛 open 事件。
 *
 * 就地展开：expandedRel 命中的文件行下方渲染 #expand 插槽（父组件注入差异内容），
 * 用于文本对比页的目录模式；activeRel 仅标识选中行（箭头 + 高亮），详情由父组件
 * 在树外下方面板展示，用于文件对比页的目录模式。
 *
 * 两种口径：
 *   - 文本口径（默认）：diff 文件显示 ± 行数，二进制单独标记，仅 diff 文件可点开
 *   - 一致性口径（verdict）：同/异文件均显示 一致/不一致，双侧存在的文件都可点开
 * 两种展开管理：
 *   - 托管（传入 expanded 集合）：对比结果区，默认展开逻辑 / 全部展开折叠在父组件
 *   - 自管（expanded 为 null）：编辑态预览卡，内部维护，树变化时重置为全折叠
 * flat=true 或 filter 非空时为平铺视图：不分组目录，全部文件按路径排序直接列出
 *（flat 恒定平铺，用于文本对比页目录模式；filter 仅筛选时临时平铺），行内带目录前缀。
 */
import { ref, watch, computed } from 'vue'
import { flattenTree, flatFiles, dirSummary, dirSummaryKind, dirPart } from './dirtree.js'

const props = defineProps({
  tree: { type: Array, default: () => [] },
  /** 已展开目录 rel 集合；null = 组件自管展开状态 */
  expanded: { type: Set, default: null },
  /** 就地展开差异的文件 rel（文本口径，#expand 插槽渲染于该行下方） */
  expandedRel: { type: String, default: null },
  /** 选中文件 rel（仅高亮 + 箭头，详情在父组件下方面板） */
  activeRel: { type: String, default: null },
  /** 路径筛选关键字；非空 → 平铺筛选模式 */
  filter: { type: String, default: '' },
  /** 平铺模式：不分目录层级，全部文件按路径排序直接列出（文本对比页目录模式） */
  flat: { type: Boolean, default: false },
  /** 编辑态预览：无状态列、纯展示 */
  preview: { type: Boolean, default: false },
  /** 一致性口径（文件对比页目录模式） */
  verdict: { type: Boolean, default: false },
  /** 树模式渲染节点上限 */
  limit: { type: Number, default: 1200 },
  /** 平铺筛选模式行数上限 */
  filterLimit: { type: Number, default: 1000 },
})
const emit = defineEmits(['toggle', 'open'])

const innerExpanded = ref(new Set())
watch(
  () => props.tree,
  () => (innerExpanded.value = new Set())
)

const kw = computed(() => props.filter.trim().toLowerCase())
const isFilter = computed(() => kw.value !== '')

const visible = computed(() => {
  // 平铺（flat 或筛选中）：全部文件按路径排序，depth 0，行内带目录前缀
  if (props.flat || isFilter.value) {
    const { files, truncated } = flatFiles(props.tree, {
      kw: props.filter,
      limit: props.flat ? props.limit : props.filterLimit,
    })
    return { rows: files.map((node) => ({ node, depth: 0 })), truncated, flatView: true }
  }
  const expanded = props.expanded ?? innerExpanded.value
  return { ...flattenTree(props.tree, expanded, props.limit), flatView: false }
})

function isExpanded(node) {
  return (props.expanded ?? innerExpanded.value).has(node.rel)
}

/** 文件行是否可点开详情：文本口径 diff/仅原（删除）/仅新（新增）；一致性口径为双侧都存在的文件 */
function fileClickable(row) {
  if (props.preview) return false
  if (props.verdict) return row.status !== 'onlyL' && row.status !== 'onlyR'
  return row.status === 'diff' || row.status === 'onlyL' || row.status === 'onlyR'
}

/** 文件名着色：仅原=删除红，仅新=新增绿，文本口径 diff=琥珀 */
function nameCls(row) {
  if (props.preview) return ''
  if (row.status === 'onlyL') return 'trow__name--del'
  if (row.status === 'onlyR') return 'trow__name--add'
  if (!props.verdict && row.status === 'diff') return 'trow__name--diff'
  return ''
}

function rowClick(item) {
  const node = item.node
  if (node.type === 'dir') {
    if (props.expanded) emit('toggle', node.rel)
    else innerExpanded.value = flip(innerExpanded.value, node.rel)
    return
  }
  if (fileClickable(node.row)) emit('open', node.row)
}

function flip(set, rel) {
  const next = new Set(set)
  next.has(rel) ? next.delete(rel) : next.add(rel)
  return next
}

function statCls(stats) {
  const kind = dirSummaryKind(stats)
  return kind ? 'trow__stat--' + kind : ''
}
</script>

<template>
  <div class="dtree">
    <template v-for="item in visible.rows" :key="item.node.type + ':' + item.node.rel">
      <!-- 目录行 -->
      <div
        v-if="item.node.type === 'dir'"
        class="trow trow--dir trow--click"
        :style="{ paddingLeft: 10 + item.depth * 18 + 'px' }"
        @click="rowClick(item)"
      >
        <span class="trow__arrow">{{ isExpanded(item.node) ? '▾' : '▸' }}</span>
        <span class="trow__icon">📁</span>
        <span class="trow__name">{{ item.node.name }}</span>
        <span v-if="!preview" class="trow__stat" :class="statCls(item.node.stats)">
          {{ dirSummary(item.node.stats, verdict) }}
          <template v-if="!verdict && (item.node.stats.plus || item.node.stats.minus)">
            <b class="pm-plus">+{{ item.node.stats.plus }}</b>
            <b class="pm-minus">−{{ item.node.stats.minus }}</b>
          </template>
        </span>
      </div>

      <!-- 文件行 -->
      <div
        v-else
        class="trow trow--file"
        :class="{
          'trow--click': fileClickable(item.node.row),
          'trow--on': expandedRel === item.node.rel || activeRel === item.node.rel,
        }"
        :style="{ paddingLeft: 10 + item.depth * 18 + 'px' }"
        @click="rowClick(item)"
      >
        <span class="trow__arrow">
          {{ fileClickable(item.node.row) ? (expandedRel === item.node.rel || activeRel === item.node.rel ? '▾' : '▸') : '' }}
        </span>
        <span class="trow__icon">📄</span>
        <span v-if="visible.flatView && dirPart(item.node.rel)" class="trow__dir">{{ dirPart(item.node.rel) }}/</span>
        <span class="trow__name" :class="nameCls(item.node.row)">
          {{ item.node.name }}
        </span>
        <span v-if="!preview" class="trow__stat" :class="verdict && item.node.row.status !== 'same' && item.node.row.status !== 'onlyL' && item.node.row.status !== 'onlyR' ? 'trow__stat--bad' : ''">
          <template v-if="verdict">
            <template v-if="item.node.row.status === 'same'">一致</template>
            <template v-else-if="item.node.row.status === 'onlyL'">仅原目录</template>
            <template v-else-if="item.node.row.status === 'onlyR'">仅新目录</template>
            <template v-else>不一致</template>
          </template>
          <template v-else>
            <template v-if="item.node.row.status === 'diff' && item.node.row.plus != null">
              <b class="pm-plus">+{{ item.node.row.plus }}</b>
              <b class="pm-minus">−{{ item.node.row.minus }}</b>
            </template>
            <template v-else-if="item.node.row.status === 'onlyL'"><b class="pm-minus">− 删除</b></template>
            <template v-else-if="item.node.row.status === 'onlyR'"><b class="pm-plus">+ 新增</b></template>
            <template v-else-if="item.node.row.status === 'same'">相同</template>
            <template v-else-if="item.node.row.status === 'binary'">二进制</template>
          </template>
        </span>
      </div>

      <!-- 就地展开该文件的差异（文本口径：#expand 插槽由父组件注入） -->
      <div
        v-if="item.node.type === 'file' && expandedRel === item.node.rel"
        class="trow__expand"
        :style="{ marginLeft: 10 + item.depth * 18 + 'px' }"
      >
        <slot name="expand" :rel="item.node.rel" />
      </div>
    </template>

    <div v-if="visible.truncated" class="trow trow--note">…文件较多，仅显示前 {{ visible.rows.length }} 项，可在上方按路径筛选…</div>
    <div v-if="!visible.rows.length" class="trow trow--note">{{ isFilter ? '（无匹配文件）' : '（目录为空）' }}</div>
  </div>
</template>

<style scoped>
.dtree { flex: 1; min-height: 0; }
.trow {
  display: flex; align-items: center; gap: 7px; padding: 5px 14px; font-size: 13px;
  border-bottom: 1px solid #f1f5f9; min-width: 0;
}
.trow:last-child { border-bottom: none; }
.trow--click { cursor: pointer; }
.trow--click:hover { background: #f8fafc; }
.trow--on { background: #eff6ff; }
.trow--note { justify-content: center; color: var(--c-text-muted); padding: 22px 0; font-size: 12px; }
.trow__arrow { flex: none; width: 13px; color: var(--c-text-muted); font-size: 10px; }
.trow__icon { flex: none; font-size: 12px; }
.trow__name {
  font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.trow__name--diff { color: #b45309; }
.trow__name--del { color: #dc2626; }
.trow__name--add { color: #16a34a; }
.trow__dir {
  flex: none; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px; color: var(--c-text-muted); font-family: ui-monospace, Menlo, Consolas, monospace;
}
.trow__stat { flex: none; margin-left: auto; font-size: 12px; color: var(--c-text-muted); white-space: nowrap; display: inline-flex; gap: 8px; }
.trow__stat--diff { color: #b45309; }
.trow__stat--same { color: #16a34a; }
.trow__stat--bad { color: #dc2626; font-weight: 600; }
.pm-plus { color: #16a34a; font-weight: 600; }
.pm-minus { color: #dc2626; font-weight: 600; }
.trow__expand { padding: 0 14px 12px 24px; display: flex; flex-direction: column; gap: 8px; }
.trow__expand :deep(.diff) { flex: none; max-height: 70vh; overflow-y: auto; }
</style>
