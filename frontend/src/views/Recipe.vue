<template>

<div class="recipe-page">

<div class="page-header">
<p>{{ t('recipeTitle') }}</p>
<button class="add-btn" @click="createRecipe" :disabled="isViewer" :title="t('tipAddRecipe')">{{ t('addRecipe') }}</button>
</div>

<div v-if="!connected" class="not-connected-banner">{{ t('recipeNotConnected') }}</div>
<div v-if="jointWarnings.length" class="joint-warning-banner">⚠️ {{ jointWarnings.join(' · ') }}</div>

<div class="recipe-layout">

<!-- LEFT LIST -->
<div class="recipe-list">

<div class="list-header">
<span>{{ t('colName') }}</span>
<span>{{ t('colActions') }}</span>
</div>

<div
v-for="recipe in recipes"
:key="recipe.id"
class="recipe-item"
:class="{active:editingId===recipe.id}"
>
<div class="recipe-name">{{ recipe.name }}</div>
<div class="actions">
<button class="edit-btn" @click="editRecipe(recipe)" :disabled="isViewer" :title="t('tipEditRecipe')">{{ t('editBtn') }}</button>
<button class="delete-btn" @click="deleteRecipe(recipe.id)" :disabled="isViewer" :title="t('tipDeleteRecipe')">{{ t('deleteBtn') }}</button>
</div>
</div>

</div>


<!-- RIGHT PANEL -->
<div class="recipe-editor">

<div class="editor-header">
<span>{{ t('editorTitle') }}</span>
<div class="edit-tag" v-if="editingId">{{ t('editingTag') }}</div>
</div>

<div class="editor-body">

<div class="form-row">
<label>{{ t('fieldName') }}</label>
<input class="full-input" v-model="form.name" :disabled="isViewer"/>
<div class="error" v-if="nameError">{{ nameError }}</div>
</div>

<div class="form-row-inline">
<div class="form-col">
<label>{{ t('fieldSpeed') }}</label>
<input class="num-input" v-model.number="form.speed" :disabled="isViewer"/>
</div>
</div>

<!-- LIVE POSE / JOINTS -->
<div class="live-section">
  <div class="live-title">{{ t('liveReadoutTitle') }} <span class="pose-status" :class="poseClass">{{ poseStatusText }}</span></div>
  <div class="value-grid">
    <div class="value-cell" v-for="axis in poseKeys" :key="axis">
      <span class="value-label">{{ axis.toUpperCase() }}</span>
      <span class="value-num">{{ displayPose[axis] }}</span>
    </div>
  </div>
  <div class="live-title">{{ t('jointsTitle') }} <span class="pose-status" :class="jointsClass">{{ jointsStatusText }}</span></div>
  <div class="value-grid">
    <div class="value-cell" v-for="j in jointKeys" :key="j">
      <span class="value-label">{{ j.toUpperCase() }}</span>
      <span class="value-num">{{ displayJoints[j] }}</span>
    </div>
  </div>
</div>

<!-- JOG FINE-TUNE -->
<div class="jog-section" v-if="!isViewer">
  <div class="jog-title">{{ t('jogTitle') }}</div>
  <div class="step-row">
    <label>{{ t('stepLabel') }}</label>
    <button v-for="s in stepOptions" :key="s" class="step-btn" :class="{ active: step === s }" @click="step = s">{{ s }}</button>
  </div>
  <div class="jog-grid">
    <div class="jog-axis" v-for="axis in poseKeys" :key="axis">
      <button class="jog-btn" :disabled="!connected || jogging || isRunning" @click="jog(axis, -1)">−</button>
      <span class="axis-label">{{ axis.toUpperCase() }}</span>
      <button class="jog-btn" :disabled="!connected || jogging || isRunning" @click="jog(axis, 1)">+</button>
    </div>
  </div>
</div>

<!-- WAYPOINT LIST (tự do — số lượng/tên/giá trị do người dùng tự đặt) -->
<div class="waypoint-title">{{ t('waypointTableTitle') }}</div>
<table class="waypoint-table">
  <thead>
    <tr>
      <th>#</th>
      <th>{{ t('colPoint') }}</th>
      <th>X</th><th>Y</th><th>Z</th><th>Rx</th><th>Ry</th><th>Rz</th>
      <th>{{ t('colCapturePoint') }}</th>
      <th>{{ t('colActions') }}</th>
    </tr>
  </thead>
  <tbody>
    <tr v-for="(wp, i) in form.waypoints" :key="i">
      <td>{{ i + 1 }}</td>
      <td><input class="label-input" v-model="wp.label" :placeholder="t('labelPlaceholder')" :disabled="isViewer"></td>
      <td v-for="axis in poseKeys" :key="axis">
        <input class="cell-input" type="number" v-model.number="wp[axis]" :disabled="isViewer">
      </td>
      <td>
        <input type="checkbox" v-model="wp.capturePoint" :disabled="isViewer" :title="t('capturePointTip')">
      </td>
      <td class="wp-actions">
        <button class="wp-btn" :disabled="isViewer || i === 0" :title="t('moveUpTip')" @click="moveWaypoint(i, -1)">↑</button>
        <button class="wp-btn" :disabled="isViewer || i === form.waypoints.length - 1" :title="t('moveDownTip')" @click="moveWaypoint(i, 1)">↓</button>
        <button
          class="wp-btn save"
          :disabled="isViewer || !poseTrusted || savingIndex === i"
          :title="t('saveCurrentPoseTip')"
          @click="saveCurrentPose(i)"
        >{{ savingIndex === i ? '...' : t('saveCurrentPoseBtn') }}</button>
        <button
          class="wp-btn go"
          :disabled="isViewer || !connected || movingIndex === i || isRunning"
          :title="t('goToTip')(wp.label || ('#' + (i + 1)))"
          @click="goToPoint(i)"
        >{{ movingIndex === i ? '...' : t('goToBtn')(wp.label || ('#' + (i + 1))) }}</button>
        <button class="wp-btn delete" :disabled="isViewer" :title="t('deleteWaypointTip')" @click="deleteWaypoint(i)">✕</button>
      </td>
    </tr>
  </tbody>
</table>

<button class="add-waypoint-btn" :disabled="isViewer" :title="t('addWaypointTip')" @click="addWaypoint">{{ t('addWaypointBtn') }}</button>
</div>


<div class="button-bar">
<button class="save-btn" @click="saveEdit" :disabled="isViewer || !editingId" :title="t('tipSaveRecipe')">{{ t('saveBtn') }}</button>
<button class="cancel-btn" @click="cancelEdit" :disabled="isViewer" :title="t('tipCancelRecipe')">{{ t('cancelBtn') }}</button>
<button class="new-btn" @click="saveAsNew" :disabled="isViewer" :title="t('tipSaveAsRecipe')">{{ t('saveAsBtn') }}</button>
</div>


</div>

</div>

</div>

</template>



<script>

import { useLangStore } from '../stores/lang'
import { mapState } from 'pinia'
import { apiBase, fetchRobotStatus, fetchCurrentPose, fetchCurrentJoints, moveRobot, poseStatusClass, BLANK_POSE, BLANK_JOINTS } from '../lib/robotApi'

export default{

computed: {
  ...mapState(useLangStore, ['isViewer']),
  apiBase() { return apiBase() },
  // Pose có 3 mức (xem Home.vue): Live / Approx (theo lệnh move gần nhất, đáng tin để teach
  // điểm) / No data. Joints chỉ có Live vì không đọc được khớp qua lệnh move.
  poseClass() { return poseStatusClass(this.connected, this.monitorConnected || this.poseApprox) },
  poseStatusText() {
    if (!this.connected)       return this.t('poseDisconnected')
    if (this.monitorConnected) return this.t('poseLive')
    if (this.poseApprox)       return this.t('poseApprox')
    return this.t('poseNoData') + (this.monitorError ? ` — ${this.monitorError}` : '')
  },
  jointsClass() { return poseStatusClass(this.connected, this.monitorConnected) },
  jointsStatusText() {
    if (!this.connected)       return this.t('poseDisconnected')
    if (this.monitorConnected) return this.t('poseLive')
    return this.t('poseNoData') + (this.monitorError ? ` — ${this.monitorError}` : '')
  },
  // Có pose đáng tin để teach điểm (Save Current Pose / Add Waypoint) khi live HOẶC approx.
  poseTrusted()   { return this.connected && (this.monitorConnected || this.poseApprox) },
  displayPose()   { return this.poseTrusted ? this.pos    : BLANK_POSE },
  displayJoints() { return (this.connected && this.monitorConnected) ? this.joints : BLANK_JOINTS },
},

data(){
return{

recipes:[],
editingId:null,
nameError:"",

form:{
  name: "",
  speed: 50,
  waypoints: [],   // [{ label, x, y, z, rx, ry, rz }, ...] — tự do, người dùng tự thêm/xoá/sắp xếp
},

poseKeys: ['x', 'y', 'z', 'rx', 'ry', 'rz'],
jointKeys: ['j1', 'j2', 'j3', 'j4', 'j5', 'j6'],
jointWarnings: [],

connected: false,
poseApprox: false,
monitorError: null,
monitorConnected: false,
isRunning: false,
pos: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
joints: { j1: 0, j2: 0, j3: 0, j4: 0, j5: 0, j6: 0 },

step: 5,
stepOptions: [1, 5, 20],
jogging: false,
savingIndex: null,
movingIndex: null,
posTimer: null,

}

},

mounted(){
  this.loadRecipes()

  this.posTimer = setInterval(async () => {
    try {
      const data = await fetchRobotStatus(this.apiBase)
      this.connected = !!data.connected
      this.isRunning = !!data.running
    } catch (e) {
      // backend không gọi được (tắt/sập) — không được giữ nguyên connected cũ
      this.connected = false
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
    } catch (e) {
      this.monitorConnected = false
      this.poseApprox       = false
    }
  }, 300)
},

beforeUnmount(){
  clearInterval(this.posTimer)
},

methods:{

t(key) { return useLangStore().t(key) },

logKey(key, params = [], type = "info") {
  const val = this.t(key)
  const text = typeof val === 'function' ? val(...params) : val
  fetch(`${this.apiBase}/logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, params, level: type })
  }).catch(() => {})
  return text
},

async loadRecipes(){
  try {
    const res = await fetch(`${this.apiBase}/api/recipes`)
    this.recipes = await res.json()
  } catch (e) {}
},


createRecipe(){
  this.editingId = null
  this.nameError = ""
  this.form = { name: "", speed: 50, waypoints: [] }
},


editRecipe(recipe){
  this.editingId = recipe.id
  this.nameError = ""
  this.form = JSON.parse(JSON.stringify({
    name: recipe.name, speed: recipe.speed, waypoints: recipe.waypoints || [],
  }))
},


async saveEdit(){
  console.log("========== SAVE EDIT CLICK ==========")
  console.log("editingId =", this.editingId)
  console.log("form =", JSON.parse(JSON.stringify(this.form)))
  console.log("waypoints =", JSON.parse(JSON.stringify(this.form.waypoints)))
  console.log("waypoint count =", this.form.waypoints?.length)
  if(!this.editingId) return
  this.nameError=""

  const duplicated=this.recipes.find(
    r=>r.name===this.form.name && r.id!==this.editingId
  )
  if(duplicated){
    this.nameError=this.t('errDuplicate')
    return
  }

  await fetch(`${this.apiBase}/api/recipes/${this.editingId}`,{
    method:"PUT",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify(this.form)
  })

  await this.loadRecipes()
  alert(this.t('alertSaved'))
},


cancelEdit(){
  const hasData = this.form.name || this.form.waypoints.length
  if(hasData){
    const ok=confirm(this.t('confirmCancel'))
    if(!ok) return
  }
  this.createRecipe()
},


async saveAsNew(){
  console.log("========== SAVE AS NEW CLICK ==========")
  console.log("form =", JSON.parse(JSON.stringify(this.form)))
  console.log("waypoints =", JSON.parse(JSON.stringify(this.form.waypoints)))
  console.log("waypoint count =", this.form.waypoints?.length)

  this.nameError=""

  if(!this.form.name){
    this.nameError = this.t('errNameRequired')
    return
  }

  const duplicated=this.recipes.find(
    r=>r.name===this.form.name
  )
  if(duplicated){
    this.nameError=this.t('errDuplicate')
    return
  }

  const res = await fetch(`${this.apiBase}/api/recipes`,{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify(this.form)
  })

  const data = await res.json().catch(() => null)

  console.log("SAVE AS NEW RESPONSE =", data)

  await this.loadRecipes()

  console.log("RECIPES AFTER SAVE AS NEW =", JSON.parse(JSON.stringify(this.recipes)))

  const created = this.recipes.find(r => r.id === data?.id)
  if(created) this.editRecipe(created)
},


async deleteRecipe(id){
  const ok=confirm(this.t('confirmDelete'))
  if(!ok) return

  await fetch(`${this.apiBase}/api/recipes/${id}`,{ method:"DELETE" })

  await this.loadRecipes()
  if(this.editingId===id){
    this.createRecipe()
  }
},

// Thêm 1 waypoint mới = chụp pose thật của robot lúc này. Chỉ thay đổi state local
// (form.waypoints) — phải bấm Save/Save as New ở dưới mới ghi vào DB.
addWaypoint(){
  console.log("ADD WAYPOINT CLICK")
  console.log("before =", JSON.parse(JSON.stringify(this.form.waypoints)))

  const nextIndex = this.form.waypoints.length + 1

  const pose = this.poseTrusted
    ? { ...this.pos }
    : { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }

  this.form.waypoints.push({
    label: `Point ${nextIndex}`,
    ...pose,
    capturePoint: false,
  })
},

deleteWaypoint(i){
  this.form.waypoints.splice(i, 1)
},

moveWaypoint(i, dir){
  const j = i + dir
  if(j < 0 || j >= this.form.waypoints.length) return
  const arr = this.form.waypoints
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
},

// Ghi đè 1 waypoint có sẵn bằng pose thật hiện tại của robot (giữ nguyên label).
saveCurrentPose(i){
  if(!this.poseTrusted) return
  const wp = this.form.waypoints[i]
  this.form.waypoints[i] = { ...wp, ...this.pos }
  this.logKey('logSaveWaypointOk', [wp.label || `#${i + 1}`], 'ok')
},

// Test: di chuyển robot tới 1 waypoint trong danh sách, để xác nhận đúng vị trí.
async goToPoint(i){
  const wp = this.form.waypoints[i]
  if(!wp) return
  const label = wp.label || `#${i + 1}`

  this.movingIndex = i
  try {
    const data = await moveRobot(this.apiBase, wp, this.form.speed, label)
    if(!data.success) this.logKey('logGoToFail', [label, data.error || ''], 'error')
  } catch (e) {
    this.logKey('logGoToFail', [label, e.message], 'error')
  }
  this.movingIndex = null
},

async jog(axis, dir){
  if(this.jogging) return
  this.jogging = true
  try {
    const target = { ...this.pos, [axis]: this.pos[axis] + dir * this.step }
    const data = await moveRobot(this.apiBase, target, 20, `jog ${axis}`)
    if(data.success) this.pos = { ...this.pos, ...data.pos }
    else this.logKey('logJogFail', [data.error || ''], 'error')
  } catch (e) {
    this.logKey('logJogFail', [e.message], 'error')
  }
  this.jogging = false
},

}

}

</script>



<style scoped>

* { box-sizing: border-box; }

.page-header{
display:flex;
justify-content:space-between;
align-items:center;
margin-bottom:8px;
padding-left:15px;
border-bottom:1px solid #ccc;
}

.add-btn{
background:#1e6bd6;
color:white;
border:none;
padding:10px 18px;
cursor:pointer;
}

.not-connected-banner {
  background: #f59e0b; color: #1a1a1a;
  text-align: center; padding: 8px; font-weight: 600; font-size: 0.9rem;
  margin: 8px 15px; border-radius: 4px;
}
.joint-warning-banner {
  background: #fde68a; color: #92400e;
  text-align: center; padding: 8px; font-weight: 600; font-size: 0.85rem;
  margin: 8px 15px; border-radius: 4px;
}

.recipe-layout{
display:flex;
gap:20px;
padding-left:8px;
}

.recipe-list{
width:28%;
border:1px solid #ccc;
background:white;
align-self:flex-start;
}

.list-header{
display:flex;
justify-content:space-between;
padding:12px;
background:#f1f3f6;
border-bottom:1px solid #ccc;
font-weight:600;
}

.recipe-item{
display:flex;
justify-content:space-between;
align-items:center;
padding:16px;
border-bottom:1px solid #eee;
}

.recipe-item.active{
background:#d9e9f7;
border-left:5px solid #1e6bd6;
}

.actions{
display:flex;
gap:10px;
}

.edit-btn{
background:#f3f4f6;
border:1px solid #ccc;
padding:6px 12px;
cursor:pointer;
}

.delete-btn{
border:2px solid red;
color:red;
background:white;
padding:6px 12px;
cursor:pointer;
}

.recipe-editor{
width:72%;
border:1px solid #ccc;
background:white;
display:flex;
flex-direction:column;
}

.editor-header{
display:flex;
justify-content:space-between;
align-items:center;
padding:12px;
background:#f1f3f6;
border-bottom:1px solid #ccc;
}

.edit-tag{
border:1px solid #1e6bd6;
color:#1e6bd6;
padding:3px 10px;
}

.editor-body{
padding:20px;
flex:1;
}

.form-row{
margin-bottom:18px;
}

.form-row label{
display:block;
margin-bottom:8px;
}

.full-input{
width:96%;
padding:12px;
border:1px solid #cfd6df;
background:#f4f6f9;
}

.form-row-inline{
display:flex;
gap:20px;
margin-bottom:18px;
}
.form-col{ width:160px; }
.form-col label{ display:block; margin-bottom:8px; }
.num-input{
width:100%;
padding:10px;
border:1px solid #cfd6df;
background:#f4f6f9;
}

.error{
color:#e53935;
font-size:12px;
margin-top:5px;
}

button:disabled {
opacity: 0.4;
cursor: not-allowed;
}

/* LIVE READOUT */

.live-section{
background:#eef1f4;
border:1px solid #bfc7cf;
padding:10px 12px;
margin-bottom:16px;
}
.live-title{
font-size:0.8rem;
font-weight:600;
color:#444;
margin-bottom:8px;
display:flex;
align-items:center;
gap:10px;
}
.pose-status{ font-size:11px; font-weight:600; }
.pose-status.ok   { color:#15803d; }
.pose-status.warn { color:#b45309; }
.pose-status.err  { color:#b91c1c; }

.value-grid{
display:grid;
grid-template-columns:repeat(6,1fr);
gap:5px;
margin-bottom:6px;
}
.value-cell{
display:flex;
flex-direction:column;
align-items:center;
background:#fff;
border:1px solid #ccc;
border-radius:4px;
padding:4px 2px;
}
.value-label{ font-size:0.65rem; color:#888; font-weight:600; }
.value-num{ font-size:0.78rem; font-family:monospace; }

/* JOG */

.jog-section{
margin-bottom:18px;
}
.jog-title{
font-size:0.8rem;
font-weight:600;
color:#444;
margin-bottom:8px;
}
.step-row{ display:flex; align-items:center; gap:8px; margin-bottom:10px; }
.step-row label{ font-size:0.85rem; color:#555; }
.step-btn{
width:40px; height:30px; border:1px solid #ccc; background:#fff; cursor:pointer;
}
.step-btn.active{ background:#1e6bd6; color:#fff; border-color:#1e6bd6; }

.jog-grid{
display:grid;
grid-template-columns:repeat(6,1fr);
gap:8px;
}
.jog-axis{
display:flex;
align-items:center;
justify-content:center;
gap:4px;
border:1px solid #ddd;
border-radius:4px;
padding:4px;
background:#fafafa;
}
.axis-label{ font-weight:600; font-size:0.75rem; color:#444; min-width:18px; text-align:center; }
.jog-btn{
width:26px; height:26px; border:1px solid #999; background:#fff; cursor:pointer; font-size:14px; padding:0;
}
.jog-btn:disabled{ opacity:0.4; cursor:not-allowed; }

/* WAYPOINT TABLE */

.waypoint-title{
font-size:0.85rem;
font-weight:600;
color:#333;
margin-bottom:8px;
}

.waypoint-table{
width:100%;
border-collapse:collapse;
font-size:0.82rem;
margin-bottom:10px;
}
.waypoint-table th, .waypoint-table td{
border:1px solid #ddd;
padding:6px 4px;
text-align:center;
}
.waypoint-table th{
background:#f1f3f6;
font-weight:600;
}
.label-input{
width:100%;
padding:5px 6px;
border:1px solid #ccc;
border-radius:3px;
font-size:0.8rem;
}
.cell-input{
width:70px;
padding:5px 4px;
border:1px solid #ccc;
border-radius:3px;
font-size:0.8rem;
text-align:center;
}
.wp-actions{ display:flex; gap:4px; justify-content:center; flex-wrap:wrap; }
.wp-btn{
border:1px solid #999; background:#fff; padding:5px 8px; cursor:pointer; font-size:0.75rem; white-space:nowrap; border-radius:3px;
}
.wp-btn.save{ border-color:#1e6bd6; color:#1e6bd6; }
.wp-btn.go{ border-color:#2fa14f; color:#2fa14f; }
.wp-btn.delete{ border-color:#d61e2c; color:#d61e2c; }
.wp-btn:disabled{ opacity:0.4; cursor:not-allowed; }

.add-waypoint-btn{
width:100%;
background:#1e6bd6;
color:#fff;
border:none;
padding:10px;
cursor:pointer;
font-size:0.85rem;
border-radius:4px;
}

/* BUTTON BAR */

.button-bar{
display:flex;
gap:15px;
padding:15px;
border-top:1px solid #ddd;
}

.save-btn{
flex:1;
background:#2fa14f;
color:white;
border:none;
padding:14px;
cursor:pointer;
}

.cancel-btn{
flex:1;
background:#e5e5e5;
border:none;
padding:14px;
cursor:pointer;
}

.new-btn{
flex:1;
border:2px solid #1e6bd6;
background:white;
color:#1e6bd6;
padding:14px;
cursor:pointer;
}

</style>
