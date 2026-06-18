<template>

<div class="home">

  <!-- CRITICAL ERROR BANNER -->
  <div v-if="criticalError" class="critical-banner">{{ t('criticalBanner') }}</div>

  <!-- ROBOT WARNING BANNER -->
  <div v-if="robotWarning && !criticalError" class="robot-warning-banner" @click="robotWarning = null">{{ t('robotWarningBanner') }} ✕</div>

  <!-- JOINT LIMIT WARNING BANNER -->
  <div v-if="jointWarnings.length" class="joint-warning-banner">⚠️ {{ jointWarnings.join(' · ') }}</div>

  <!-- TOAST -->
  <transition name="toast">
    <div v-if="toast.visible" class="toast" :class="toast.type">{{ toast.message }}</div>
  </transition>

  <!-- VIEWER MODE BANNER -->
  <div v-if="isViewer" class="viewer-banner">{{ t('viewerBanner') }}</div>

  <!-- TOP BAR -->
  <div class="top-bar">

    <div class="left">

      <label>{{ t('armIp') }}</label>
      <input type="text" v-model="robotIP"/>

      <button class="connect-btn" @click="connectRobot" :disabled="isViewer || isConnecting"
        :title="isConnected ? t('tipDisconnect') : t('tipConnect')">{{ isConnecting ? '...' : isConnected ? t('disconnect') : t('connect') }}</button>

      <button class="viewer-toggle-btn" @click="toggleViewer" :class="{ active: isViewer }"
        :title="isViewer ? t('tipSwitchToControl') : t('tipSwitchToViewer')">
        {{ isViewer ? t('viewerMode') : t('controlMode') }}
      </button>

      <div class="divider"></div>

      <label>{{ t('recipe') }}</label>

      <div class="recipe-apply-row">
        <div class="recipe-dropdown" :class="{ open: recipeDropdownOpen }" v-click-outside="closeRecipeDropdown">
          <button
            type="button"
            class="recipe-dropdown-trigger"
            :disabled="isViewer"
            :title="t('tipRecipeDropdown')"
            @click="recipeDropdownOpen = !recipeDropdownOpen"
          >
            <span>{{ selectedRecipe ? selectedRecipe.name : '—' }}</span>
            <svg width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
          </button>
          <div class="recipe-dropdown-menu" v-if="recipeDropdownOpen">
            <div
              class="recipe-dropdown-item"
              :class="{ selected: selectedRecipeId === null }"
              @click="selectRecipeItem(null)"
            >—</div>
            <div
              v-for="r in recipes"
              :key="r.id"
              class="recipe-dropdown-item"
              :class="{ selected: selectedRecipeId === r.id }"
              @click="selectRecipeItem(r.id)"
            >
              <span>{{ r.name }}</span>
              <span v-if="appliedRecipeId === r.id" class="recipe-item-dot"></span>
            </div>
          </div>
        </div>
        <button
          class="apply-recipe-btn"
          :class="{ applied: appliedRecipeId && appliedRecipeId === selectedRecipeId }"
          :disabled="isViewer || !selectedRecipeId"
          :title="t('tipApplyRecipe')"
          @click="applyRecipe"
        >
          <span class="apply-dot"></span>
        </button>
      </div>

    </div>

    <div class="right-bar">
      <div class="lang-switcher">
        <button :class="{ active: lang === 'zh' }" @click="setLang('zh')">简体</button>
        <button :class="{ active: lang === 'en' }" @click="setLang('en')">EN</button>
      </div>
      <button class="reload-btn" @click="() => window.location.reload()" title="Reset dashboard">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
      </button>
      <div class="robot-status-badge" :class="status">
        <span class="robot-status-dot"></span>
        <span>{{ t('robotStatus_' + status) }}</span>
      </div>
      <div class="status-box" :class="{ connected: isConnected, disconnected: !isConnected }">
        <div class="status-dot" :class="{ connected: isConnected, disconnected: !isConnected }"></div>
        <span>{{ isConnected ? t('connected') : t('disconnected') }}</span>
      </div>
    </div>

  </div>


  <div class="main">
    <div class="main-top">

      <!-- WORKSTATION -->
      <div class="workstation">

        <div class="title-worksation">
          <h4>{{ t('workstation') }}</h4>
        </div>

        <div class="robot-map">

          <!-- COORDINATES -->
          <div class="coordinates-panel">

            <div class="pose-status" :class="poseClass">{{ poseStatusText }}</div>

            <div class="value-grid">
              <div class="value-cell" v-for="axis in poseKeys" :key="axis">
                <span class="value-label">{{ axis.toUpperCase() }}</span>
                <span class="value-num">{{ displayPose[axis] }}</span>
              </div>
            </div>

            <div class="joints-title">{{ t('jointsTitle') }} <span class="pose-status inline" :class="jointsClass">{{ jointsStatusText }}</span></div>

            <div class="value-grid">
              <div class="value-cell" v-for="j in jointKeys" :key="j">
                <span class="value-label">{{ j.toUpperCase() }}</span>
                <span class="value-num">{{ displayJoints[j] }}</span>
              </div>
            </div>

            <div class="op-label" v-if="currentWaypoint">
              {{ currentWaypoint.label || ('#' + (stepIndex + 1)) }} ({{ stepIndex + 1 }}/{{ totalSteps }})
              <span class="need-capture-badge" v-if="needsCapture" :title="t('tipNeedCapture')">📸 {{ t('needCaptureBadge') }}</span>
            </div>

          </div>

        </div>

        <!-- STEP NAVIGATION -->
        <div class="step-nav" v-if="!isViewer">
          <button class="step-nav-btn back" @click="backStep" :disabled="!canBack || isRunning" :title="t('tipBack')">◀ {{ t('backBtn') }}</button>
          <button class="step-nav-btn next" @click="nextStep" :disabled="!canNext || isRunning" :title="t('tipNext')">{{ t('nextBtn') }} ▶</button>
        </div>

        <div class="manual-hint" v-if="!isViewer">
          <router-link to="/recipe" class="manual-link-btn">{{ t('navRecipe') }} →</router-link>
        </div>

      </div>

      <!-- RIGHT PANEL -->
      <div class="right-panel">

        <!-- CAMERA PANEL -->
        <div class="camera-panel">

          <div class="camera-title">
            {{ t('liveView') }}
          </div>

          <div class="camera-view">

            <!-- 1 card / 1 Capture Point của recipe đang chọn — số lượng bao nhiêu cũng được,
                 tự xuống dòng (CSS auto-fit) khi không đủ chỗ, không khóa cứng số cột. -->
            <div class="image-grid">
              <div class="shot-card" v-for="slot in captureSlots" :key="slot.label || '_'">
                <div class="image-slot">
                  <img v-if="slot.image" :src="slot.image" class="shot-img">
                  <div v-else class="slot-empty"><span>—</span></div>
                </div>
                <div class="shot-caption" v-if="slot.label">{{ t('capturedAtLabel')(slot.label) }}</div>
              </div>
            </div>

          </div>

        </div>


        <!-- CONTROL BUTTONS -->
        <div class="controls" v-if="!isViewer">

          <button class="btn sample" @click="captureImage" :disabled="capturing || !isConnected" :title="t('tipCapture')">{{ t('captureBtn') }}</button>

          <button class="btn light" :class="{ on: lightOn }" @click="toggleLight" :disabled="togglingLight || !isConnected" :title="t('tipLight')">{{ lightOn ? t('lightOffBtn') : t('lightOnBtn') }}</button>

          <button class="btn import" @click="importPointsFromRobot" :disabled="importingPoints || !isConnected" :title="t('tipImportPoints')">{{ t('importPointsBtn') }}</button>

          <button class="btn stop" @click="stopRun" :title="t('tipStop')">{{ t('stop') }}</button>

        </div>

      </div>
    </div>

    <div class="status-panel">
      <div class="status-title">
        {{ t('statusTitle') }}
      </div>
      <div class="status-content">
        <div
          v-for="(msg, i) in statusLog"
          :key="i"
          class="status-line"
          :class="msg.type"
        >{{ msg.text }}</div>
      </div>
    </div>
  </div>

</div>

</template>


<script>

import { useLangStore } from '../stores/lang'
import { mapState } from 'pinia'
import { apiBase, fetchRobotStatus, fetchCurrentPose, fetchCurrentJoints, moveRobot, poseStatusClass, BLANK_POSE, BLANK_JOINTS } from '../lib/robotApi'

export default {

computed: {
  ...mapState(useLangStore, ['lang', 'isViewer']),
  apiBase() { return apiBase() },
  selectedRecipe() { return this.recipes.find(r => r.id === this.selectedRecipeId) || null },
  // Pose có 3 mức: Live (TMRTS port 5895 đang stream 10Hz) / Approx (TMRTS không có,
  // nhưng pose vừa được xác nhận qua lệnh move gần nhất — vẫn đáng tin, không phải số giả) /
  // No data (chưa biết gì cả). Joints thì chỉ có Live vì không có cách đọc khớp qua lệnh move.
  poseClass() { return poseStatusClass(this.isConnected, this.monitorConnected || this.poseApprox) },
  poseStatusText() {
    if (!this.isConnected)      return this.t('poseDisconnected')
    if (this.monitorConnected)  return this.t('poseLive')
    if (this.poseApprox)        return this.t('poseApprox')
    return this.t('poseNoData') + (this.monitorError ? ` — ${this.monitorError}` : '')
  },
  jointsClass() { return poseStatusClass(this.isConnected, this.monitorConnected) },
  jointsStatusText() {
    if (!this.isConnected)     return this.t('poseDisconnected')
    if (this.monitorConnected) return this.t('poseLive')
    return this.t('poseNoData') + (this.monitorError ? ` — ${this.monitorError}` : '')
  },
  displayPose()   { return (this.isConnected && (this.monitorConnected || this.poseApprox)) ? this.pos : BLANK_POSE },
  displayJoints() { return (this.isConnected && this.monitorConnected) ? this.joints : BLANK_JOINTS },
  // Robot chạy theo waypoint tự do của recipe đang chọn — Next/Back đi từng bước qua danh sách này.
  waypoints() {
  const wps = this.selectedRecipe?.waypoints
  console.log(this.selectedRecipe)
  if (Array.isArray(wps)) return wps
  if (typeof wps === 'string') {
    try { return JSON.parse(wps) || [] } catch(e) { return [] }
  }
  return []
},
  totalSteps()     { return this.waypoints.length },
  currentWaypoint(){ return this.stepIndex >= 0 ? this.waypoints[this.stepIndex] : null },
  canBack()        { return this.stepIndex > 0 },
  canNext() {
  return this.totalSteps > 0 && this.stepIndex < this.totalSteps - 1
},
  // 1 ô ảnh / 1 Capture Point của recipe đang chọn — không có Capture Point nào thì
  // dùng 1 ô chung (ảnh chụp gần nhất, không gắn tên điểm cụ thể).
  capturePoints() { return this.waypoints.filter(wp => wp.capturePoint) },
  captureSlots() {
    if (this.capturePoints.length === 0) return [{ label: null, image: this.capturedImage }]
    return this.capturePoints.map(wp => ({ label: wp.label, image: this.capturedShots[wp.label] || null }))
  },
  // Đang đứng tại 1 waypoint được đánh dấu Capture Point nhưng chưa chụp ảnh cho điểm đó —
  // cần nhắc operator bấm nút Capture Image.
  needsCapture() {
    return !!(this.currentWaypoint?.capturePoint && !this.capturedShots[this.currentWaypoint.label])
  },
},

data(){
  return {
    recipes: [],
    robotIP: "",
    isConnected: false,
    statusLog: [],
    pos: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
    joints: { j1: 0, j2: 0, j3: 0, j4: 0, j5: 0, j6: 0 },
    poseKeys: ['x', 'y', 'z', 'rx', 'ry', 'rz'],
    jointKeys: ['j1', 'j2', 'j3', 'j4', 'j5', 'j6'],
    jointWarnings: [],
    monitorConnected: false,
    poseApprox: false,
    monitorError: null,
    posTimer: null,
    selectedRecipeId: null,
    appliedRecipeId: null,
    _lastPolledRecipeId: undefined,
    recipeDropdownOpen: false,
    isConnecting: false,
    criticalError: null,
    robotWarning: null,
    toast: { visible: false, message: '', type: 'ok' },
    stepIndex: -1,   // -1 = chưa tới điểm nào; chỉ số trong waypoints của recipe đang chọn
    capturedImage: null,   // dùng khi recipe không có Capture Point nào (ô ảnh chung)
    capturedShots: {},     // { [waypointLabel]: base64Image } — 1 ảnh / 1 Capture Point
    importingPoints: false,
    capturing: false,
    lightOn: false,
    togglingLight: false,
    isRunning: false,
    status: 'disconnected',
  }
},

beforeUnmount(){
  clearInterval(this.posTimer)
},

mounted(){
  this.loadRecipes()

  this.posTimer = setInterval(async () => {
    try {
      const data = await fetchRobotStatus(this.apiBase)
      if(data.serverStart){
        if(!this._serverStart) this._serverStart = data.serverStart
        else if(this._serverStart !== data.serverStart) { window.location.reload(); return }
      }
      const wasConnected = this.isConnected
      this.isConnected = !!data.connected
      if(wasConnected && !this.isConnected) {
        this.showToast(this.t('toastDisconnected'), 'error')
        this.lightOn = false   // robot mất kết nối — không còn chắc trạng thái đèn thật
      }
      if(data.robotIp && !this.robotIP) this.robotIP = data.robotIp
      this.status       = data.status
      this.isRunning    = !!data.running
      this.criticalError = data.criticalError
      this.robotWarning  = data.robotWarning
      if(data.currentRecipeId !== undefined) {
        if(data.currentRecipeId !== this._lastPolledRecipeId) {
          this.selectedRecipeId    = data.currentRecipeId
          this._lastPolledRecipeId = data.currentRecipeId
        }
        this.appliedRecipeId = data.currentRecipeId
      }
      if(data.sessionId){
        if(!this._sessionId) this._sessionId = data.sessionId
        else if(this._sessionId !== data.sessionId) {
          this._sessionId = data.sessionId
          this.capturedImage = null
          this.capturedShots = {}
        }
      }
    } catch(e) {
      // fetch lỗi nghĩa là không gọi được backend (backend tắt/sập) — phải coi như mất kết
      // nối hoàn toàn, không được giữ nguyên isConnected cũ (trước đây bug ở đây im lặng bỏ
      // qua lỗi, làm status kẹt ở "Connected" mãi dù backend đã tắt).
      if(this.isConnected) this.showToast(this.t('toastDisconnected'), 'error')
      this.isConnected = false
      this.status      = 'disconnected'
      this.lightOn     = false
    }

    try {
      const [poseData, jointData] = await Promise.all([
        fetchCurrentPose(this.apiBase),
        fetchCurrentJoints(this.apiBase),
      ])
      this.monitorConnected = !!poseData.connected
      this.poseApprox       = !!poseData.approx
      this.monitorError     = poseData.monitorError || null
      this.pos    = { x: poseData.x, y: poseData.y, z: poseData.z, rx: poseData.rx, ry: poseData.ry, rz: poseData.rz }
      this.joints = { j1: jointData.j1, j2: jointData.j2, j3: jointData.j3, j4: jointData.j4, j5: jointData.j5, j6: jointData.j6 }
      this.jointWarnings = jointData.warnings || []
    } catch(e) {
      this.monitorConnected = false
      this.poseApprox       = false
    }
  }, 300)
},

methods:{

  t(key) { return useLangStore().t(key) },

  setLang(l) { useLangStore().setLang(l) },

  async loadRecipes(){
    try {
      const res = await fetch(`${this.apiBase}/api/recipes`)
      this.recipes = await res.json()
    } catch(e) {}
  },

  selectRecipeItem(id) {
    this.selectedRecipeId   = id
    this.appliedRecipeId    = null
    this.recipeDropdownOpen = false
    this.stepIndex          = -1
    this.capturedShots      = {}   // recipe khác = Capture Point khác, ảnh cũ không còn liên quan
  },
  closeRecipeDropdown() { this.recipeDropdownOpen = false },

  async applyRecipe() {
    await this.loadRecipes()

    console.log("selectedRecipe =", JSON.parse(JSON.stringify(this.selectedRecipe)))
    if (!this.selectedRecipeId) return
    try {
      const res = await fetch(`${this.apiBase}/recipe/current`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipeId: this.selectedRecipeId })
      })
      if (res.ok) {
        this.appliedRecipeId = this.selectedRecipeId
        this.logKey('logRecipeApplied', [this.selectedRecipe?.name], 'ok')
        this.showToast(this.t('toastRecipeApplied')(this.selectedRecipe?.name), 'ok')
      } else {
        this.logKey('logRecipeFail', [res.status], 'error')
      }
    } catch(e) {
      this.logKey('logRecipeFail', [e.message], 'error')
    }
  },

  toggleViewer() {
    const store = useLangStore()
    store.isViewer = !store.isViewer
    localStorage.setItem('isViewer', store.isViewer)
  },

  log(text, type = "info"){
    this.statusLog.unshift({ text, type })
    if(this.statusLog.length > 50) this.statusLog.pop()
  },

  showToast(message, type = 'ok') {
    this.toast = { visible: true, message, type }
    clearTimeout(this._toastTimer)
    this._toastTimer = setTimeout(() => { this.toast.visible = false }, 3000)
  },

  logKey(key, params = [], type = "info") {
    const val = this.t(key)
    const text = typeof val === 'function' ? val(...params) : val
    this.log(text, type)
    fetch(`${this.apiBase}/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, params, level: type })
    }).catch(() => {})
  },

  async connectRobot(){
    if(!this.robotIP){ alert(this.t('alertIp')); return }
    if(this.isConnecting) return
    const action = this.isConnected ? "disconnect" : "connect"
    if(action === 'disconnect') {
      const msg = this.isRunning ? this.t('confirmDisconnectRunning') : this.t('confirmDisconnect')
      if(!confirm(msg)) return
    }
    this.isConnecting = true

    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 70000)
    let data
    try {
      const res = await fetch(`${this.apiBase}/robot/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: this.robotIP }),
        signal: abort.signal,
      })
      data = await res.json()
    } catch(e) {
      data = { success: false, error: e.name === 'AbortError' ? 'Timeout' : e.message }
    } finally {
      clearTimeout(timer)
      this.isConnecting = false
    }

    if(data.success){
      if(action === 'connect'){
        this.logKey('logConnected', [this.robotIP], "ok")
        this.showToast(this.t('toastConnected'), 'ok')
      }else{
        this.logKey('logDisconnected', [], "error")
        this.showToast(this.t('toastDisconnected'), 'error')
      }
    } else {
      this.logKey('logConnFail', [action, data.error || ""], "error")
    }
  },

  async captureImage(){
    if(this.capturing) return
    if(!this.isConnected){
      this.logKey('logNeedConnect', [], "error")
      return
    }
    this.capturing = true
    try {
      const res  = await fetch(`${this.apiBase}/api/camera/capture`, { method: 'POST' })
      const data = await res.json()
      if(data.image){
        if(this.currentWaypoint?.capturePoint){
          this.capturedShots = { ...this.capturedShots, [this.currentWaypoint.label]: data.image }
        } else {
          this.capturedImage = data.image
        }
        this.logKey('logCaptured', [], "ok")
      } else if(data.error) {
        this.logKey('logCaptureFail', [data.error], "error")
      }
    } catch(e) {
      this.logKey('logCaptureFail', [e.message], "error")
    }
    this.capturing = false
  },

  async toggleLight(){
    if(this.togglingLight || !this.isConnected) return
    this.togglingLight = true
    const next = !this.lightOn
    try {
      const res  = await fetch(`${this.apiBase}/api/camera/light`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: next }),
      })
      const data = await res.json()
      if(data.success) this.lightOn = next
      else this.logKey('logLightFail', [data.error || ''], 'error')
    } catch(e) {
      this.logKey('logLightFail', [e.message], 'error')
    }
    this.togglingLight = false
  },

  // Nhập các điểm P1..Pcount đã teach tay trên robot (nút Point vật lý / hand-guiding) thành
  // 1 recipe mới. PHẢI nhập đúng số lượng — đọc 1 Point không tồn tại làm robot báo alarm và
  // tự rời Listen Node (đã xác nhận thực tế trên robot), nên không tự dò mò số lượng được.
  async importPointsFromRobot(){
    if(this.importingPoints || !this.isConnected) return
    const input = prompt(this.t('promptPointCount'))
    if(input === null) return
    const count = parseInt(input, 10)
    if(!Number.isInteger(count) || count < 1){
      this.logKey('logImportFail', [this.t('errInvalidCount')], 'error')
      return
    }
    this.importingPoints = true
    try {
      const res  = await fetch(`${this.apiBase}/api/robot/import-points`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count }),
      })
      const data = await res.json()
      if(data.error){
        this.logKey('logImportFail', [data.error], 'error')
      } else if(data.points && data.points.length > 0){
        const names = data.points.map(p => p.name).join(', ')
        if(confirm(this.t('confirmImportPoints')(names))){
          const r2 = await fetch(`${this.apiBase}/api/robot/pending-import/save`, { method: 'POST' })
          const d2 = await r2.json()
          if(d2.id) this.showToast(this.t('toastImportSaved')(d2.name), 'ok')
          else this.logKey('logImportFail', [d2.error || ''], 'error')
        } else {
          await fetch(`${this.apiBase}/api/robot/pending-import/dismiss`, { method: 'POST' })
        }
      } else {
        this.logKey('logImportFail', [this.t('errNoPointsFound')], 'error')
      }
    } catch(e) {
      this.logKey('logImportFail', [e.message], 'error')
    }
    this.importingPoints = false
  },

  // Di chuyển robot tới waypoint[targetIndex] của recipe đang chọn. Next/Back chỉ khác
  // nhau ở targetIndex — mỗi lần bấm là 1 lệnh move đơn, không có sequence tự động.
 async goStep(targetIndex){
  if (!this.selectedRecipe) { alert(this.t('noRecipeSelected')); return }
  if (!this.isConnected)    { this.logKey('logNeedConnect', [], 'error'); return }
  if (this.isRunning) return

  const wp = this.waypoints[targetIndex]
  if (!wp) return

  const label = wp.label || `#${targetIndex + 1}`
  this.isRunning = true

  try {
    const data = await moveRobot(this.apiBase, wp, this.selectedRecipe.speed, label)

    if (data.success) {
      this.stepIndex = targetIndex
      // wp vừa move tới là Capture Point nhưng chưa có ảnh cho điểm này — nhắc operator
      // bấm nút Capture Image (không tự động chụp, theo đúng yêu cầu ban đầu).
      if (wp.capturePoint && !this.capturedShots[wp.label]) {
        this.logKey('logNeedCapture', [label], 'warn')
      }
    } else {
      this.logKey('logGoToFail', [label, data.error || ''], 'error')
    }
  } catch (e) {
    this.logKey('logGoToFail', [label, e.message], 'error')
  } finally {
    this.isRunning = false
  }
},
  nextStep(){ this.goStep(this.stepIndex + 1) },
  backStep(){ this.goStep(this.stepIndex - 1) },


  async stopRun(){
    await fetch(`${this.apiBase}/robot/stop`, { method: "POST" })
    this.isRunning = false
    this.logKey('logStopped', [], "error")
  },

}

}
</script>



<style scoped>
* { box-sizing: border-box; }

.recipe-apply-row { display: flex; align-items: center; gap: 6px; }

.recipe-dropdown { position: relative; flex: 1; min-width: 120px; }
.recipe-dropdown-trigger {
  width: 100%; height: 28px; padding: 0 8px;
  border: 1px solid #d1d5db; border-radius: 4px;
  background: #fff; font-size: 0.85rem; color: #111;
  display: flex; align-items: center; justify-content: space-between; gap: 6px;
  cursor: pointer; transition: border-color 0.15s; white-space: nowrap;
}
.recipe-dropdown-trigger span { flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; }
.recipe-dropdown-trigger:hover:not(:disabled) { border-color: #6b7280; }
.recipe-dropdown-trigger:disabled { opacity: 0.5; cursor: not-allowed; }
.recipe-dropdown.open .recipe-dropdown-trigger { border-color: #3b82f6; }

.recipe-dropdown-menu {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 200;
  background: #fff; border: 1px solid #d1d5db; border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.12); overflow: visible;
}
.recipe-dropdown-item {
  position: relative; padding: 6px 10px; font-size: 0.85rem;
  cursor: pointer; display: flex; align-items: center; justify-content: space-between;
  transition: background 0.1s;
}
.recipe-dropdown-item:hover { background: #f3f4f6; }
.recipe-dropdown-item.selected { background: #eff6ff; color: #1d4ed8; font-weight: 600; }
.recipe-item-dot {
  width: 7px; height: 7px; border-radius: 50%; background: #16a34a; flex-shrink: 0;
}

.apply-recipe-btn {
  width: 28px; height: 28px; border-radius: 50%;
  border: 2px solid #aaa; background: #fff;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: border-color 0.2s, background 0.2s;
  flex-shrink: 0;
}
.apply-recipe-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.apply-dot {
  width: 10px; height: 10px; border-radius: 50%;
  background: #ccc; transition: background 0.2s;
}
.apply-recipe-btn.applied { border-color: #16a34a; }
.apply-recipe-btn.applied .apply-dot { background: #16a34a; }

.viewer-toggle-btn {
  width: 120px; height: 36px; line-height: 32px;
  font-size: 0.85rem; font-weight: 600; white-space: nowrap;
  text-align: center; overflow: hidden;
  border: 2px solid #6b7280; background: transparent; color: #374151; cursor: pointer;
  transition: background 0.2s, color 0.2s, transform 0.1s;
}
.viewer-toggle-btn:active { transform: scale(0.92); }
.viewer-toggle-btn.active {
  border-color: #1e40af; background: #1e40af; color: #fff;
}
.toast {
  position: fixed; top: 24px; left: 50%; transform: translateX(-50%);
  padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 0.95rem;
  color: #fff; z-index: 9999; box-shadow: 0 4px 16px rgba(0,0,0,0.18);
  pointer-events: none;
}
.toast.ok    { background: #16a34a; }
.toast.error { background: #dc2626; }
.toast.info  { background: #2563eb; }
.toast-enter-active, .toast-leave-active { transition: opacity 0.3s, transform 0.3s; }
.toast-enter-from { opacity: 0; transform: translateX(-50%) translateY(-12px); }
.toast-leave-to   { opacity: 0; transform: translateX(-50%) translateY(-12px); }

.critical-banner {
  background: #dc2626; color: #fff;
  text-align: center; padding: 10px; font-weight: 700; font-size: 0.95rem;
  letter-spacing: 0.02em;
}
.robot-warning-banner {
  background: #f59e0b; color: #1a1a1a;
  text-align: center; padding: 8px; font-weight: 600; font-size: 0.9rem;
  cursor: pointer;
}
.robot-warning-banner:hover { background: #d97706; }
.joint-warning-banner {
  background: #fde68a; color: #92400e;
  text-align: center; padding: 8px; font-weight: 600; font-size: 0.85rem;
}
.viewer-banner {
  background: #1e40af; color: #fff;
  text-align: center; padding: 8px; font-weight: 600; font-size: 0.9rem;
}

.right-bar {
  display: flex; align-items: center; gap: 10px; padding-right: 20px;
}

.reload-btn {
  width: 30px; height: 30px; border-radius: 6px;
  border: 1px solid #ddd; background: #f5f5f5;
  color: #555; cursor: pointer; padding: 0;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s;
}
.reload-btn:hover { background: #e5e7eb; color: #111; }

.lang-switcher {
  display: flex; border: 1px solid #ddd; border-radius: 6px; overflow: hidden;
}
.lang-switcher button {
  padding: 0 12px; height: 32px; line-height: 32px;
  border: none; background: #f5f5f5; color: #555;
  font-size: 0.82rem; font-weight: 600; cursor: pointer; white-space: nowrap;
  transition: background 0.2s, color 0.2s, transform 0.1s;
}
.lang-switcher button:active {
  transform: scale(0.92);
}
.lang-switcher button.active {
  background: #1e40af; color: #fff;
}


/* TOP BAR */

.top-bar{
 display:flex;
 justify-content:space-between;
 align-items:center;
 border-bottom:1px solid #dcdcdc;
 font-size:14px;
 line-height:1;
 height:56px;
 min-height:56px;
 max-height:56px;
 padding:0;
 box-sizing:border-box;
 overflow:visible;
}

.left{
 display:flex;
 align-items:center;
 gap:6px;
 padding-left:25px;
}

.left > label {
 white-space:nowrap;
 min-width:60px;
}

.top-bar input{
 padding:0 10px;
 height:36px;
 border:1px solid #ccc;
 box-sizing:border-box;
}

.connect-btn{
 background:#1e6bd6;
 color:white;
 border:none;
 padding:0;
 width:110px;
 height:36px;
 line-height:36px;
 text-align:center;
 cursor:pointer;
}

button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.divider{
 width:1px;
 height:35px;
 background:#ccc;
 margin:0 10px;
}


/* ROBOT STATUS BADGE */

.robot-status-badge {
  display: flex; align-items: center; gap: 6px;
  padding: 0 12px; height: 36px; border-radius: 6px;
  font-size: 0.8rem; font-weight: 600; margin-right: 8px;
  background: #f3f4f6; color: #6b7280; border: 1.5px solid #d1d5db;
}
.robot-status-badge.idle               { background: #dcfce7; color: #15803d; border-color: #86efac; }
.robot-status-badge.moving             { background: #dbeafe; color: #1d4ed8; border-color: #93c5fd; }
.robot-status-badge.paused             { background: #ffedd5; color: #c2410c; border-color: #fdba74; }
.robot-status-badge.error              { background: #fee2e2; color: #b91c1c; border-color: #fca5a5; }
.robot-status-badge.disconnected       { background: #f3f4f6; color: #6b7280; border-color: #d1d5db; }

.robot-status-dot {
  width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex-shrink: 0;
}
.robot-status-badge.moving .robot-status-dot {
  animation: blink 1s infinite;
}
@keyframes blink {
  0%, 100% { opacity: 1; } 50% { opacity: 0.3; }
}

/* STATUS */

.status-box{
 display:flex;
 align-items:center;
 justify-content:center;
 gap:8px;
 padding:0;
 width:130px;
 height:36px;
 margin-right:15px;
 border:2px solid #999;
 background:#eeeeee;
}

.status-box span{
 color:#777;
}

.status-box.connected{
 border:2px solid rgb(26,127,55);
 background:rgb(218,251,225);
}

.status-box.connected span{
 color:rgb(26,127,55);
}

.status-dot{
 width:12px;
 height:12px;
 border-radius:50%;
 border:2px solid black;
 background:#bfbfbf;
}

.status-dot.connected{
 background:#2ecc71;
}


/* MAIN */

.main{
 display:flex;
 flex-direction:column;
 gap:15px;
 padding-top:20px;
 margin-left:10px;
}

.main-top{
 display:flex;
 gap:20px;
}

.status-panel{
 border:1px solid #bfc7cf;
 background:#eef1f4;
}

.status-title{
 padding:10px;
 text-align:center;
 border-bottom:1px solid #bfc7cf;
 background:#dfe3e8;
 color:#6b7785;
}

.status-content{
 height:160px;
 background:#f7f9fb;
 overflow-y:auto;
 padding:6px 10px;
 display:flex;
 flex-direction:column;
 gap:3px;
}

.status-line{
 font-size:12px;
 font-family:monospace;
 color:#444;
}

.status-line.ok{ color:#2a9d2a; }
.status-line.error{ color:#d61e2c; }
.status-line.warn{ color:#d97706; }

/* WORKSTATION */

.workstation{
 border:1px solid #ccc;
 width:440px;
 flex-shrink:0;
}

.title-worksation h4{
 height:32px;
 line-height:32px;
 padding:0 20px;
 margin:0;
 border-bottom:1px solid #ccc;
 background:#f2f4f7;
 font-weight:500;
 overflow:hidden;
}

.robot-map{
 margin:8px 15px 10px 15px;
 padding:10px;
 border:1px solid #ccc;
 background:#e9edf2;
}


/* COORDINATES */

.coordinates-panel{
 position:relative;
 padding-top:10px;
 padding-left: 15px;
}

.pose-status{
 font-size:11px;
 font-weight:600;
 margin-bottom:6px;
}
.pose-status.ok   { color:#15803d; }
.pose-status.warn { color:#b45309; }
.pose-status.err  { color:#b91c1c; }
.pose-status.inline{ margin-bottom:0; font-weight:600; }

.joints-title{
 font-size:11px;
 font-weight:600;
 color:#555;
 margin-top:8px;
 margin-bottom:5px;
 display:flex;
 align-items:center;
 gap:8px;
}

.value-grid{
 display:grid;
 grid-template-columns:repeat(3,1fr);
 gap:4px;
 padding-bottom:6px;
}

.value-cell{
 display:flex;
 flex-direction:column;
 align-items:center;
 background:#fff;
 border:1px solid #ccc;
 border-radius:4px;
 padding:3px 1px;
}

.value-label{
 font-size:0.62rem;
 color:#888;
 font-weight:600;
}

.value-num{
 font-size:0.72rem;
 font-family:monospace;
}

.op-label{
 margin-top:8px;
 font-size:12px;
 font-weight:600;
 color:#1e6bd6;
}

.need-capture-badge{
 margin-left:6px;
 padding:2px 8px;
 background:#d97706;
 color:#fff;
 border-radius:10px;
 font-size:11px;
 font-weight:700;
 white-space:nowrap;
}

.manual-hint{
 padding:12px 15px;
}

.manual-link-btn{
 display:block;
 text-align:center;
 background:#1e6bd6;
 color:white;
 text-decoration:none;
 padding:10px;
 border-radius:4px;
 font-weight:600;
}


/* RIGHT PANEL */

.right-panel{
 flex:1;
}


/* CAMERA PANEL */

.camera-panel{
 border:1px solid #bfc7cf;
 background:#eef1f4;
}

.camera-title{
 height:32px;
 line-height:32px;
 padding:0 15px;
 border-bottom:1px solid #bfc7cf;
 font-weight:600;
 background:#dfe3e8;
 overflow:hidden;
}

.camera-view{
 position:relative;
 background:#d5d9de;
 border:4px solid #fff;
 padding:6px;
}

/* auto-fit: tự co số cột theo bao nhiêu Capture Point thực tế có, tự xuống dòng khi
   không đủ chỗ — không khóa cứng số lượng (2, 5, hay bao nhiêu cũng chạy được). */
.image-grid{
 display:grid;
 grid-template-columns:repeat(auto-fit, minmax(110px, 1fr));
 gap:8px;
}

.shot-card{
 display:flex;
 flex-direction:column;
}

.shot-caption{
 margin-top:4px;
 font-size:0.75rem;
 font-weight:600;
 color:#1e6bd6;
 text-align:center;
}

.image-slot{
 height:min(220px, 32vh);
 background:#b8c1cc;
 border:2px solid #9aa3ad;
 overflow:hidden;
 display:flex;
 align-items:center;
 justify-content:center;
}

.slot-empty{
 font-size:28px;
 font-weight:700;
 color:#7a8591;
}

.shot-img{
 width:100%;
 height:100%;
 object-fit:contain;
 display:block;
}


/* CONTROL BUTTONS */

.controls{
 display:flex;
 gap:15px;
 margin-top:15px;
 flex-wrap:wrap;
}

.btn{
 flex:1;
 min-width:120px;
 height:58px;
 padding:0 18px;
 font-size:18px;
 font-weight:500;
 border:none;
 color:white;
 cursor:pointer;
 white-space:nowrap;
}

.sample{
 background:#4c74b9;
}

.light{
 background:#6b7280;
}
.light.on{
 background:#d97706;
}

.import{
 background:#0d9488;
}

.stop{
 background:#d61e2c;
}

/* STEP NAVIGATION */

.step-nav{
 display:flex;
 gap:10px;
 padding:0 15px 12px 15px;
}

.step-nav-btn{
 flex:1;
 height:42px;
 border:none;
 color:white;
 font-size:15px;
 font-weight:600;
 cursor:pointer;
 border-radius:4px;
}

.step-nav-btn.back{ background:#6b7280; }
.step-nav-btn.next{ background:#1e6bd6; }
.step-nav-btn:disabled{ opacity:0.4; cursor:not-allowed; }
</style>
