<template>

<div class="live-camera">

  <div class="live-title">{{ t('liveTitle') }}</div>
  <div class="live-hint">{{ t('liveHint') }}</div>

  <div class="live-body">

    <div class="live-view">
      <img v-if="frame" :src="frame" class="live-img">
      <div v-else class="live-empty">{{ liveError ? t('liveError')(liveError) : t('liveConnecting') }}</div>
    </div>

    <div class="live-side">

      <div class="conn-row">
        <input class="ip-input" type="text" v-model="robotIP" :placeholder="t('ipPlaceholder')" :disabled="isConnected || isConnecting">
        <button class="btn connect" :class="{ on: isConnected }" @click="connectRobot" :disabled="isConnecting">
          {{ isConnecting ? '...' : (isConnected ? t('disconnect') : t('connect')) }}
        </button>
      </div>

      <div class="jog-row step-row">
        <label>{{ t('stepLabel') }}</label>
        <input type="number" v-model.number="step" min="0.01" step="0.01">
      </div>

      <div class="jog-form">
        <div class="jog-row" v-for="axis in axes" :key="axis">
          <label>{{ axis.toUpperCase() }}</label>
          <button class="step-btn" @click="bump(axis, -1)" :title="t('tipStepDown')">−</button>
          <input type="number" step="0.01" v-model.number="form[axis]">
          <button class="step-btn" @click="bump(axis, 1)" :title="t('tipStepUp')">+</button>
        </div>
        <div class="jog-row">
          <label>{{ t('speedLabel') }}</label>
          <input type="number" v-model.number="form.speed" min="1" max="100">
        </div>
      </div>

      <div class="jog-actions">
        <button class="btn ghost" @click="useCurrentPose" :disabled="!isConnected" :title="t('tipUseCurrentPose')">{{ t('useCurrentPoseBtn') }}</button>
        <button class="btn move" @click="moveToForm" :disabled="moving || !isConnected" :title="t('tipMoveHere')">{{ moving ? '...' : t('moveBtn') }}</button>
      </div>

      <button class="btn light" :class="{ on: lightOn }" @click="toggleLight" :disabled="togglingLight || !isConnected" :title="t('tipLight')">{{ lightOn ? t('lightOffBtn') : t('lightOnBtn') }}</button>

      <div class="live-msg" v-if="moveMsg">{{ moveMsg }}</div>

    </div>

  </div>

</div>

</template>

<script>

import { useLangStore } from '../stores/lang'
import { mapState } from 'pinia'
import { apiBase, fetchRobotStatus, fetchCurrentPose, moveRobot } from '../lib/robotApi'

export default {

computed: {
  ...mapState(useLangStore, ['lang', 'isViewer']),
  apiBase() { return apiBase() },
},

data(){
  return {
    axes: ['x', 'y', 'z', 'rx', 'ry', 'rz'],
    form: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, speed: 30 },
    step: 1,
    frame: null,
    liveError: null,
    lightOn: false,
    togglingLight: false,
    _liveActive: false,
    robotIP: "",
    isConnected: false,
    isConnecting: false,
    moving: false,
    moveMsg: "",
    _statusTimer: null,
  }
},

mounted(){
  this._liveActive = true
  this.loopFrame()
  this.pollStatus()
  this._statusTimer = setInterval(() => this.pollStatus(), 1000)
},

beforeUnmount(){
  this._liveActive = false
  clearTimeout(this._liveTimer)
  clearInterval(this._statusTimer)
},

methods: {
  t(key) { return useLangStore().t(key) },

  // Tự gọi lại sau khi nhận xong frame trước (không dùng setInterval) — tránh chồng request
  // nếu 1 lần chụp chậm hơn khoảng nghỉ giữa các lần.
  async loopFrame(){
    if(!this._liveActive) return
    try {
      const res  = await fetch(`${this.apiBase}/api/camera/live-frame`)
      const data = await res.json()
      if(data.image){ this.frame = data.image; this.liveError = null }
      else if(data.error){ this.liveError = data.error }
    } catch(e) {
      this.liveError = e.message
    }
    if(this._liveActive) this._liveTimer = setTimeout(() => this.loopFrame(), 300)
  },

  async pollStatus(){
    try {
      const data = await fetchRobotStatus(this.apiBase)
      const wasConnected = this.isConnected
      this.isConnected = !!data.connected
      if(data.robotIp && !this.robotIP) this.robotIP = data.robotIp
      // Chỉ tự đổ tọa độ hiện tại vào form 1 LẦN ngay lúc vừa connect — không lặp lại liên
      // tục, kẻo đang gõ tay chỉnh tọa độ lại bị ghi đè mất.
      if(!wasConnected && this.isConnected) this.useCurrentPose()
    } catch(e) {
      this.isConnected = false
    }
  },

  async connectRobot(){
    if(!this.robotIP){ alert(this.t('alertIp')); return }
    if(this.isConnecting) return
    const action = this.isConnected ? "disconnect" : "connect"
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
    if(data.success) this.pollStatus()
    else this.moveMsg = data.error || ''
  },

  // Lấy XYZ/RxRyRz hiện tại của robot đổ vào form — để chỉnh nhẹ từ vị trí đang đứng thay
  // vì phải gõ lại từ đầu.
  async useCurrentPose(){
    try {
      const data = await fetchCurrentPose(this.apiBase)
      if(data.connected){
        for(const axis of this.axes) this.form[axis] = data[axis]
      }
    } catch(e) { /* ignore */ }
  },

  bump(axis, dir){
    const v = (this.form[axis] || 0) + dir * this.step
    this.form[axis] = Math.round(v * 100) / 100   // bỏ sai số float vụn (vd 1.0000000002)
  },

  async moveToForm(){
    if(this.moving || !this.isConnected) return
    this.moving  = true
    this.moveMsg = ""
    try {
      const pose = { x: this.form.x, y: this.form.y, z: this.form.z, rx: this.form.rx, ry: this.form.ry, rz: this.form.rz }
      const data = await moveRobot(this.apiBase, pose, this.form.speed, "LiveJog")
      this.moveMsg = data.success ? this.t('moveOk') : (data.error || this.t('moveFail'))
    } catch(e) {
      this.moveMsg = e.message
    }
    this.moving = false
  },

  async toggleLight(){
    if(this.togglingLight) return
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
    } catch(e) { /* đèn không bật/tắt được — robot có thể đang ở hand-guiding, không thể gửi script */ }
    this.togglingLight = false
  },
},

}

</script>

<style scoped>

.live-camera{
 padding:20px;
 display:flex;
 flex-direction:column;
 gap:12px;
}

.live-title{
 font-size:20px;
 font-weight:700;
}

.live-hint{
 font-size:13px;
 color:#666;
 max-width:700px;
}

.live-body{
 display:flex;
 gap:20px;
 flex-wrap:wrap;
}

.live-view{
 width:600px;
 max-width:100%;
 height:min(450px, 60vh);
 background:#1a1a1a;
 border:4px solid #fff;
 box-shadow:0 0 0 2px #ccc;
 display:flex;
 align-items:center;
 justify-content:center;
 overflow:hidden;
 flex-shrink:0;
}

.live-img{
 width:100%;
 height:100%;
 object-fit:contain;
 display:block;
}

.live-empty{
 color:#aaa;
 font-size:14px;
}

.live-side{
 display:flex;
 flex-direction:column;
 gap:14px;
 min-width:220px;
}

.conn-row{
 display:flex;
 gap:8px;
}

.ip-input{
 flex:1;
 padding:8px;
 font-size:14px;
 border:1px solid #ccc;
}

.jog-form{
 display:flex;
 flex-direction:column;
 gap:6px;
 background:#f6f8fa;
 border:1px solid #ddd;
 padding:10px;
}

.jog-row{
 display:flex;
 align-items:center;
 justify-content:space-between;
 gap:8px;
}

.jog-row label{
 font-size:13px;
 font-weight:600;
 color:#555;
 width:50px;
}

.jog-row input{
 flex:1;
 padding:6px;
 font-size:14px;
 border:1px solid #ccc;
 text-align:right;
}

.step-row{
 background:#f6f8fa;
 border:1px solid #ddd;
 padding:8px 10px;
}

.step-btn{
 width:30px;
 height:30px;
 flex:none;
 border:1px solid #ccc;
 background:#fff;
 font-size:16px;
 font-weight:700;
 line-height:1;
 cursor:pointer;
 color:#333;
}
.step-btn:hover{ background:#e8edf3; }

.jog-actions{
 display:flex;
 gap:8px;
}

.live-msg{
 font-size:13px;
 color:#1e6bd6;
}

.btn{
 height:44px;
 padding:0 16px;
 font-size:14px;
 font-weight:500;
 border:none;
 color:#fff;
 cursor:pointer;
 flex:1;
}

.connect{ background:#1e6bd6; }
.connect.on{ background:#d61e2c; }
.move{ background:#1e6bd6; }
.ghost{ background:#6b7280; }
.light{ background:#6b7280; }
.light.on{ background:#d97706; }
.btn:disabled{ opacity:0.5; cursor:not-allowed; }

</style>
