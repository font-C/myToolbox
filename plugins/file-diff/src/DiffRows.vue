<script setup>
/**
 * DiffRows — 差异行渲染（文件对比与目录对比共用）。
 * 由父组件负责构建行模型（diffcore.buildSideRows / buildUnifiedRows）与折叠展开状态；
 * 本组件只负责并排 / 上下两种视图的呈现，gap 点击向上抛 expand 事件。
 */
defineProps({
  view: { type: String, default: 'side' }, // side | unified
  sideRows: { type: Array, default: () => [] },
  unifiedRows: { type: Array, default: () => [] },
  leftTitle: { type: String, default: '' },
  rightTitle: { type: String, default: '' },
})
defineEmits(['expand'])
</script>

<template>
  <div class="diff">
    <div v-if="view === 'side'" class="diff__cols">
      <div class="diff__colhead">{{ leftTitle }}</div>
      <div class="diff__colhead">{{ rightTitle }}</div>
    </div>

    <div class="diff__body">
      <!-- 并排 -->
      <template v-if="view === 'side'">
        <template v-for="(row, i) in sideRows" :key="i">
          <div v-if="row.kind === 'gap'" class="gap" @click="$emit('expand', row.id)">
            ⋯ 点击展开相同的 {{ row.count }} 行 ⋯
          </div>
          <div v-else class="srow">
            <div class="half" :class="row.ln ? (row.kind === 'equal' ? 'half--plain' : 'half--del') : 'half--none'">
              <span class="ln">{{ row.ln?.n ?? '' }}</span>
              <code class="code"
                ><template v-if="row.segsL"
                  ><span v-for="(s, j) in row.segsL" :key="j" :class="{ hl: s.chg }">{{ s.t }}</span></template
                ><template v-else>{{ row.ln?.text || ' ' }}</template></code
              >
            </div>
            <div class="half" :class="row.rn ? (row.kind === 'equal' ? 'half--plain' : 'half--add') : 'half--none'">
              <span class="ln">{{ row.rn?.n ?? '' }}</span>
              <code class="code"
                ><template v-if="row.segsR"
                  ><span v-for="(s, j) in row.segsR" :key="j" :class="{ hl: s.chg }">{{ s.t }}</span></template
                ><template v-else>{{ row.rn?.text || ' ' }}</template></code
              >
            </div>
          </div>
        </template>
      </template>

      <!-- 上下（统一） -->
      <template v-else>
        <template v-for="(row, i) in unifiedRows" :key="i">
          <div v-if="row.kind === 'gap'" class="gap" @click="$emit('expand', row.id)">
            ⋯ 点击展开相同的 {{ row.count }} 行 ⋯
          </div>
          <div v-else class="urow" :class="'urow--' + row.kind">
            <span class="ln ln--o">{{ row.on ?? '' }}</span>
            <span class="ln ln--n">{{ row.nn ?? '' }}</span>
            <span class="sign">{{ row.kind === 'del' ? '-' : row.kind === 'add' ? '+' : '' }}</span>
            <code class="code"
              ><template v-if="row.segs"
                ><span v-for="(s, j) in row.segs" :key="j" :class="{ hl: s.chg }">{{ s.t }}</span></template
              ><template v-else>{{ row.text || ' ' }}</template></code
            >
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.diff { flex: 1; border: 1px solid var(--c-border); border-radius: 10px; background: var(--c-surface); overflow: hidden; }
.diff__cols { display: flex; border-bottom: 1px solid var(--c-border); background: #f8fafc; }
.diff__colhead {
  flex: 1; min-width: 0; padding: 6px 12px; font-size: 12px; font-weight: 600; color: var(--c-text-muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.diff__colhead + .diff__colhead { border-left: 1px solid var(--c-border); }
.code {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, 'Courier New', monospace;
  font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 4;
  flex: 1; min-width: 0; padding: 0 10px 0 2px;
}
.ln {
  flex: none; width: 46px; text-align: right; padding-right: 8px; user-select: none;
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 11px; color: #94a3b8;
}
.gap {
  text-align: center; font-size: 12px; color: var(--c-text-muted); background: var(--c-bg);
  padding: 3px 0; cursor: pointer; user-select: none;
}
.gap:hover { color: var(--c-primary); background: #e2e8f0; }

/* 并排 */
.srow { display: flex; }
.srow .half { width: 50%; min-width: 0; display: flex; align-items: flex-start; }
.srow .half + .half { border-left: 1px solid rgba(226, 232, 240, 0.9); }
.half--plain .ln { color: #94a3b8; }
.half--del { background: #fef2f2; }
.half--del .ln { background: #fee2e2; color: #b91c1c; }
.half--del .hl { background: #fecaca; border-radius: 2px; }
.half--add { background: #f0fdf4; }
.half--add .ln { background: #dcfce7; color: #15803d; }
.half--add .hl { background: #bbf7d0; border-radius: 2px; }
.half--none { background: repeating-linear-gradient(135deg, #f8fafc 0 6px, #f1f5f9 6px 12px); }

/* 上下 */
.urow { display: flex; align-items: flex-start; }
.urow .ln--o { width: 42px; }
.urow .ln--n { width: 42px; }
.urow .sign { flex: none; width: 16px; text-align: center; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12.5px; }
.urow--ctx .ln { color: #94a3b8; }
.urow--del { background: #fef2f2; }
.urow--del .ln--o { background: #fee2e2; color: #b91c1c; }
.urow--del .sign { color: #b91c1c; }
.urow--del .hl { background: #fecaca; border-radius: 2px; }
.urow--add { background: #f0fdf4; }
.urow--add .ln--n { background: #dcfce7; color: #15803d; }
.urow--add .sign { color: #15803d; }
.urow--add .hl { background: #bbf7d0; border-radius: 2px; }
</style>
