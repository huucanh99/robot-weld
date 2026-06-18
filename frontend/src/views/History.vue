<template>
<div class="history-page">

  <div class="history-header">
    <span class="title">{{ t('historyTitle') }}</span>
    <button class="clear-btn" @click="clearAll" :disabled="isViewer" :title="t('tipHistoryClear')">{{ t('historyClear') }}</button>
  </div>

  <!-- FILTERS -->
  <div class="filters">
    <div class="filter-group">
      <button
        v-for="opt in timeOpts" :key="opt.value"
        class="filter-btn"
        :class="{ active: filterTime === opt.value }"
        :title="t('tipFilterTime')"
        @click="filterTime = opt.value"
      >{{ t(opt.label) }}</button>
    </div>
    <div class="filter-group">
      <button
        v-for="opt in levelOpts" :key="opt.value"
        class="filter-btn"
        :class="['level-' + opt.value, { active: filterLevel === opt.value }]"
        :title="t('tipFilterLevel')"
        @click="filterLevel = opt.value"
      >{{ t(opt.label) }}</button>
    </div>
  </div>

  <div v-if="groups.length === 0" class="empty">{{ t('historyEmpty') }}</div>

  <div v-for="group in groups" :key="group.date" class="day-group">
    <div class="day-label">{{ group.date }}</div>
    <div
      v-for="entry in group.entries"
      :key="entry.id"
      class="log-entry"
      :class="entry.level"
    >
      <span class="log-time">{{ entry.timeStr }}</span>
      <span class="log-dot" :class="entry.level"></span>
      <span class="log-text">{{ entry.text }}</span>
    </div>
  </div>

</div>
</template>

<script>
import { useLangStore } from '../stores/lang'
import { mapState } from 'pinia'

export default {

computed: {
  ...mapState(useLangStore, ['lang', 'isViewer']),
  apiBase() { return `http://${window.location.hostname}:3000` },

  groups() {
    const now = Date.now()
    const cutoff = {
      today: new Date().setHours(0,0,0,0),
      '7d':  now - 7  * 86400000,
      '30d': now - 30 * 86400000,
      all:   0,
    }[this.filterTime]

    const filtered = this.rawLogs.filter(e => {
      if (e.ts < cutoff) return false
      if (this.filterLevel !== 'all' && e.level !== this.filterLevel) return false
      return true
    })

    const map = {}
    for (const entry of filtered) {
      const d = new Date(entry.ts)
      const date = d.toLocaleDateString(this.lang === 'zh' ? 'zh-TW' : 'en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' })
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      if (!map[date]) map[date] = []
      map[date].push({ ...entry, timeStr, text: this.translate(entry) })
    }
    return Object.entries(map)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, entries]) => ({ date, entries }))
  },
},

data() {
  return {
    rawLogs: [],
    filterTime: 'today',
    filterLevel: 'all',
    timeOpts: [
      { value: 'today', label: 'historyToday' },
      { value: '7d',    label: 'history7d'    },
      { value: '30d',   label: 'history30d'   },
      { value: 'all',   label: 'historyAll'   },
    ],
    levelOpts: [
      { value: 'all',   label: 'historyLevelAll'   },
      { value: 'ok',    label: 'historyLevelOk'    },
      { value: 'error', label: 'historyLevelError' },
      { value: 'info',  label: 'historyLevelInfo'  },
    ],
  }
},

mounted() {
  this.loadLogs()
},

methods: {
  t(key) { return useLangStore().t(key) },

  translate(entry) {
    const val = this.t(entry.key)
    const params = JSON.parse(entry.params || '[]')
    return typeof val === 'function' ? val(...params) : (val || entry.key)
  },

  async loadLogs() {
    try {
      const res = await fetch(`${this.apiBase}/logs?limit=500`)
      this.rawLogs = await res.json()
    } catch(e) {}
  },

  async clearAll() {
    if (!confirm(this.t('historyConfirmClear'))) return
    await fetch(`${this.apiBase}/logs`, { method: 'DELETE' })
    this.rawLogs = []
  },
},

}
</script>

<style scoped>
* { box-sizing: border-box; }

.history-page {
  max-width: 860px;
  margin: 0 auto;
  padding: 24px 16px;
  font-family: monospace;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.title { font-size: 1.2rem; font-weight: 700; }

.clear-btn {
  padding: 6px 14px;
  border: 1px solid #dc2626;
  background: #fff;
  color: #dc2626;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
}
.clear-btn:hover { background: #fef2f2; }
.clear-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.filters {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.filter-group {
  display: flex;
  gap: 4px;
}

.filter-btn {
  padding: 4px 12px;
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 20px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.15s;
  color: #6b7280;
}
.filter-btn:hover { border-color: #9ca3af; color: #374151; }
.filter-btn.active { background: #1e40af; border-color: #1e40af; color: #fff; }

.filter-btn.level-ok.active    { background: #16a34a; border-color: #16a34a; }
.filter-btn.level-error.active { background: #dc2626; border-color: #dc2626; }
.filter-btn.level-info.active  { background: #2563eb; border-color: #2563eb; }

.empty { color: #aaa; text-align: center; padding: 60px 0; }

.day-group { margin-bottom: 24px; }

.day-label {
  font-size: 0.8rem;
  font-weight: 700;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 4px 0;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 8px;
}

.log-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 4px;
  font-size: 0.82rem;
  line-height: 1.4;
}
.log-entry:hover { background: #f9fafb; }

.log-time { color: #9ca3af; min-width: 80px; flex-shrink: 0; }

.log-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #9ca3af;
}
.log-dot.ok    { background: #16a34a; }
.log-dot.error { background: #dc2626; }
.log-dot.info  { background: #2563eb; }

.log-text { color: #111827; }
.log-entry.error .log-text { color: #dc2626; }
.log-entry.ok    .log-text { color: #15803d; }
</style>
