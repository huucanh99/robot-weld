try { process.stdout.setEncoding("utf8") } catch (_) {}
try { process.stderr.setEncoding("utf8") } catch (_) {}
require("dotenv").config()

let criticalError = null
let robotWarning  = null

const CONNECTION_ERRS = ['ECONNRESET','EPIPE','ECONNREFUSED','ETIMEDOUT','socket','Socket','listen','Listen','disconnect','destroyed','setTimeout','aborted','timeout']

function classifyError(msg) {
  if (CONNECTION_ERRS.some(k => msg.includes(k))) {
    robotWarning = msg
    console.warn("[RobotWarning]", msg)
  } else {
    criticalError = msg
    console.error("[CRITICAL]", msg)
  }
}

process.on("uncaughtException",  e => classifyError(e.message || String(e)))
process.on("unhandledRejection", e => classifyError(e?.message || String(e)))

const express = require("express")
const sqlite3 = require("sqlite3").verbose()
const cors    = require("cors")
const fs      = require("fs")
const { TMClient }       = require("./tm_client")
const { TMMonitor }      = require("./tm_monitor")
const { CameraClient }   = require("./camera_client")
const { VisionPCServer } = require("./vision_pc_server")
const { router: integrationRouter, init: initIntegration } = require("./integration_router")

const app = express()
app.use(cors())
app.use(express.json({ limit: "10mb" }))

const SERVER_START_TIME = Date.now()

const db = new sqlite3.Database("./database.db")

// 1 recipe = 1 object/model được inspect. Mỗi recipe có speed (tốc độ chạy) và
// 1 danh sách waypoint Cartesian TỰ DO (số lượng/tên do người dùng tự đặt), lưu
// dạng JSON array trong cột `waypoints`: [{ label, x, y, z, rx, ry, rz }, ...]
db.run(`CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  speed REAL
)`)
db.run("ALTER TABLE recipes ADD COLUMN waypoints TEXT DEFAULT '[]'", () => {})

db.run(`CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,
  key TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '[]'
)`)

const tmClient       = new TMClient()
const tmMonitor      = new TMMonitor()
const cameraClient   = new CameraClient()
const visionPCServer = new VisionPCServer()
// Robot là client tự connect tới đây qua TMflow Network Device "ntd_VisionPC" — lắng nghe
// ngay từ lúc backend start, không phụ thuộc /robot/connect (TMRTS port 5895 không mở được
// trên robot này nên dùng kênh TCP 8765 này thay thế cho pose/joints realtime).
visionPCServer.start()

const TAG_COUNTER_FILE = "./tagcounter"
function loadTagCounter() {
  try {
    const v = parseInt(fs.readFileSync(TAG_COUNTER_FILE, "utf8"))
    if (Number.isInteger(v) && v > 0) return v + 100  // skip past last run + buffer
  } catch (_) {}
  return 100
}
function saveTagCounter() {
  try { fs.writeFileSync(TAG_COUNTER_FILE, String(tagCounter)) } catch (_) {}
}
let tagCounter = loadTagCounter()

// ─── Joint safety limits ──────────────────────────────────────────────────────
// Placeholder ±180° range for all 6 joints — NOT the verified TM5-700 spec.
// Update real min/max via PUT /api/robot/joint-limits (persists to joint_limits.json)
// once you confirm the actual safe range from the TM5-700 manual / TMflow.
const JOINT_LIMITS_FILE = "./joint_limits.json"
const DEFAULT_JOINT_LIMITS = {
  verified: false,
  warningMarginDeg: 10,
  limits: {
    j1: { min: -180, max: 180 }, j2: { min: -180, max: 180 }, j3: { min: -180, max: 180 },
    j4: { min: -180, max: 180 }, j5: { min: -180, max: 180 }, j6: { min: -180, max: 180 },
  },
}
function loadJointLimits() {
  try {
    return JSON.parse(fs.readFileSync(JOINT_LIMITS_FILE, "utf8"))
  } catch (_) {
    fs.writeFileSync(JOINT_LIMITS_FILE, JSON.stringify(DEFAULT_JOINT_LIMITS, null, 2))
    return DEFAULT_JOINT_LIMITS
  }
}
function saveJointLimits() {
  fs.writeFileSync(JOINT_LIMITS_FILE, JSON.stringify(jointLimits, null, 2))
}
let jointLimits = loadJointLimits()
if (!jointLimits.verified) {
  console.warn(
    `[JointLimits] Using PLACEHOLDER limits (${JSON.stringify(jointLimits.limits)}) — ` +
    `these are NOT confirmed against the real TM5-700 spec. Joint-limit warnings will be ` +
    `misleading until you set the real min/max via PUT /api/robot/joint-limits or edit ${JOINT_LIMITS_FILE}.`
  )
}

// Trả về danh sách warning string cho các joint đang gần limit (trong phạm vi warningMarginDeg)
function getJointWarnings(joints) {
  const margin = jointLimits.warningMarginDeg ?? 10
  const warnings = []
  for (const k of ["j1", "j2", "j3", "j4", "j5", "j6"]) {
    const limit = jointLimits.limits[k]
    const v = joints[k]
    if (!limit || v == null) continue
    const distToMin = v - limit.min
    const distToMax = limit.max - v
    if (distToMin <= margin) warnings.push(`${k.toUpperCase()} is near joint limit (${distToMin.toFixed(1)}° from min ${limit.min}°)`)
    else if (distToMax <= margin) warnings.push(`${k.toUpperCase()} is near joint limit (${distToMax.toFixed(1)}° from max ${limit.max}°)`)
  }
  return warnings
}

function computeRobotStatus() {
  if (criticalError)       return "error"
  if (!tmClient.connected) return "disconnected"
  if (robotPaused)         return "paused"
  if (tmClient.running)    return "moving"
  return "idle"
}

let robotPaused        = false
let currentRecipeId    = null
let lastCapturedImage  = null
let integrationRecipe  = null
let sessionId          = Date.now()
let monitorError       = null   // lý do TMRTS monitor (port 5895) chưa connect được — hiện ra dashboard để debug

function resetSession() {
  robotPaused       = false
  lastCapturedImage = null
  tagCounter        = 100
  saveTagCounter()
  tmClient.running = false
  sessionId = Date.now()
  console.log("[Session] Reset — new session", sessionId)
}

// Pose cố định dùng riêng cho /robot/home (an toàn chung, độc lập với recipe đang chọn)
const POS_HOME = { x: 500, y: 0, z: 400, rx: 180, ry: 0, rz: 84 }

// TCP cố định cho mọi lệnh move/đọc pose của app — KHÔNG dựa vào TCP đang active sẵn trên
// robot, vì TCP có thể bị đổi (ví dụ project robot tự đổi qua tool "bit" cho công việc khác),
// làm cùng 1 bộ X/Y/Z/Rx/Ry/Rz bị hiểu sai, J6 xoay lệch hoàn toàn so với lúc teach điểm.
const APP_TCP = "HandCamera"

// ─── Recipe waypoints helpers ─────────────────────────────────────────────────
// waypoints là 1 array tự do: [{ label, x, y, z, rx, ry, rz }, ...] — số lượng/tên
// do người dùng tự thêm/xoá/đặt tên trong trang Recipe, không cố định cấu trúc.
function parseWaypoints(json) {
  try {
    const arr = JSON.parse(json || "[]")
    return Array.isArray(arr) ? arr : []
  } catch (_) {
    return []
  }
}

function serializeRecipe(row) {
  return { ...row, waypoints: parseWaypoints(row.waypoints) }
}

// ─── Robot connection endpoints ───────────────────────────────────────────────
let _manualConnecting  = false   // manual /robot/connect call in progress

app.post("/robot/connect", async (req, res) => {
  const { ip = "127.0.0.1" } = req.body

  if (_manualConnecting) return res.status(400).json({ error: "Already connecting" })

  _manualConnecting = true
  tmClient.ip = ip

  // Reset sạch mọi trạng thái cũ — coi như task mới hoàn toàn
  tmClient.disconnect()
  resetSession()

  const deadline = Date.now() + 60000
  let lastErr = "Connect timeout"

  while (Date.now() < deadline) {
    try {
      await tmClient.connect()
      await tmClient.waitForListenNode(10000)
      resetSession()

      // Cũng kết nối TMRTS monitor (port 5895) để stream pose/joint real-time —
      // nếu chỉ mở Listen Node (5890) thì dashboard sẽ luôn hiện 0,0,0,0,0,0.
      try {
        if (tmMonitor.connected) tmMonitor.disconnect()
        await tmMonitor.connect(ip)
        monitorError = null
        console.log("[Connect] TMRTS monitor connected — pose/joint display now live")
      } catch (monErr) {
        monitorError = monErr.message
        console.warn("[Connect] TMRTS monitor connect failed — pose/joint will show 'No data':", monErr.message)
      }

      // Network Device ntd_VisionPC (TMflow project) chỉ tự auto-open khi chạy flow project
      // bình thường qua Start node — không tự mở khi robot ở Listen Node/External Script
      // Control (chính là mode đang dùng ở đây). Phải gọi socket_open() rõ ràng mỗi lần
      // connect để kênh port 8765 (VisionPCServer) nhận được data từ robot.
      try {
        const opened = await tmClient.sendScript("openVisionPC", ['socket_open("ntd_VisionPC")'])
        console.log(opened
          ? "[Connect] Sent socket_open(\"ntd_VisionPC\") — port 8765 channel should be live"
          : "[Connect] socket_open(\"ntd_VisionPC\") script was rejected by robot — check device name in TMflow")
      } catch (sockErr) {
        console.warn("[Connect] Failed to send socket_open(\"ntd_VisionPC\"):", sockErr.message)
      }

      sendWebhook("arm_ready")
      _manualConnecting = false
      return res.json({ success: true })
    } catch (e) {
      lastErr = e.message
      tmClient.disconnect()
      console.log("[Connect] Retry:", e.message)
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  _manualConnecting = false
  res.status(500).json({ error: lastErr })
})

// Kết nối chỉ TMRTS monitor (không cần Listen Node) — tiện để debug riêng pose stream
app.post("/monitor/connect", async (req, res) => {
  const { ip } = req.body
  if (!ip) return res.status(400).json({ error: "IP required" })

  try {
    if (tmMonitor.connected) tmMonitor.disconnect()
    await tmMonitor.connect(ip)
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post("/robot/disconnect", (req, res) => {
  tmClient.disconnect()
  tmMonitor.disconnect()
  res.json({ success: true })
})

// ─── Robot monitoring endpoints — frontend poll mỗi 300-500ms ────────────────

app.get("/api/robot/status", (req, res) => {
  res.json({
    status: computeRobotStatus(),
    connected: tmClient.connected,
    monitorConnected: tmMonitor.connected,
    robotIp: tmClient.connected ? tmClient.ip : null,
    running: tmClient.running,
    paused: robotPaused,
    currentRecipeId,
    serverStart: SERVER_START_TIME,
    sessionId,
    criticalError,
    robotWarning,
    monitorError,
  })
})

// Cartesian pose hiện tại. Ưu tiên dữ liệu mới nhận từ port 8765 (TMflow Network Device
// ntd_VisionPC) — kênh thay thế cho TMRTS (port 5895, không mở được trên robot này).
// connected=false nghĩa là chưa có nguồn nào stream được dữ liệu thật — đừng hiểu nhầm là
// robot đang ở 0,0,0,0,0,0.
app.get("/api/robot/current-pose", (req, res) => {
  if (visionPCServer.isPoseFresh()) {
    const { ts, ...pose } = visionPCServer.pose
    return res.json({
      ...pose,
      connected: true,
      approx: false,
      robotConnected: tmClient.connected,
      status: computeRobotStatus(),
      monitorError,
      source: "networkDevice",
    })
  }
  res.json({
    ...tmMonitor.pos,
    connected: tmMonitor.connected,   // true = pose đang stream thật 10Hz qua TMRTS (port 5895)
    // Fallback khi TMRTS không khả dụng: pose vẫn đáng tin nếu đã được xác nhận qua lệnh move
    // gần nhất (QueueTag done) — không phải live nhưng không phải số giả 0,0,0,0,0,0.
    approx: !tmMonitor.connected && tmMonitor.poseKnown && tmClient.connected,
    robotConnected: tmClient.connected,
    status: computeRobotStatus(),
    monitorError,
    source: "tmrtsFallback",
  })
})

// Joint angles hiện tại (J1-J6, độ) — dùng để theo dõi khoảng cách tới joint limit.
// Ưu tiên port 8765 (Network Device) nếu có data mới, fallback về TMRTS (luôn rỗng nếu
// port 5895 không mở, giữ lại để không phá nếu sau này TMRTS hoạt động được).
app.get("/api/robot/current-joints", (req, res) => {
  if (visionPCServer.isJointsFresh()) {
    const { ts, ...joints } = visionPCServer.joints
    return res.json({
      ...joints,
      connected: true,
      robotConnected: tmClient.connected,
      status: computeRobotStatus(),
      warnings: getJointWarnings(joints),
      jointLimits,
      source: "networkDevice",
    })
  }
  const joints = tmMonitor.joints
  res.json({
    ...joints,
    connected: tmMonitor.connected,
    robotConnected: tmClient.connected,
    status: computeRobotStatus(),
    warnings: tmMonitor.connected ? getJointWarnings(joints) : [],
    jointLimits,
    source: "tmrtsFallback",
  })
})

// Trạng thái TCP server port 8765 (Network Device ntd_VisionPC) — dùng để debug riêng
// kênh này mà không cần xem console log backend.
app.get("/api/robot/network-monitor/status", (req, res) => {
  res.json(visionPCServer.getNetworkStatus())
})

app.get("/api/robot/joint-limits", (req, res) => {
  res.json(jointLimits)
})

app.put("/api/robot/joint-limits", (req, res) => {
  const { limits, warningMarginDeg, verified } = req.body || {}
  if (limits) jointLimits.limits = limits
  if (typeof warningMarginDeg === "number") jointLimits.warningMarginDeg = warningMarginDeg
  if (typeof verified === "boolean") jointLimits.verified = verified
  saveJointLimits()
  console.log("[JointLimits] Updated:", JSON.stringify(jointLimits))
  res.json({ success: true, jointLimits })
})

app.post("/recipe/current", (req, res) => {
  const { recipeId } = req.body
  currentRecipeId = recipeId ?? null
  res.json({ ok: true })
})

// ─── Shared run helpers ────────────────────────────────────────────────────────

// Wrap script lines with QueueTag(1,0) at start (clear stale) and QueueTag(1,1) at end (signal done)
function tagWrap(lines) {
  return ["QueueTag(1,0)", ...lines, "QueueTag(1,1)"]
}

// Wait 150ms (for QueueTag clear to execute), then poll until QueueTag(1) is true
async function waitTag(scriptId, maxWait = 60000) {
  await new Promise(r => setTimeout(r, 150))
  try {
    await tmClient.waitQueueTag(1, 100, maxWait)
    return true
  } catch (e) {
    console.warn(`[${scriptId}] waitTag: ${e.message}`)
    return false
  }
}
async function sendWebhook(event, cell = null, message = null) {
  const url = process.env.WEBHOOK_URL
  if (!url) return true
  try {
    const body = { event, timestamp: new Date().toISOString() }
    if (cell)    body.currentCell = cell
    if (message) body.message     = message
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })
    return true
  } catch (e) {
    console.warn(`[webhook] ${event} failed:`, e.message)
    return false
  }
}

app.post("/robot/pause", (req, res) => {
  if (!tmClient.running) return res.status(400).json({ error: "Not running" })
  robotPaused = true
  res.json({ success: true })
})

app.post("/robot/resume", (req, res) => {
  robotPaused = false
  res.json({ success: true })
})

app.post("/robot/stop", async (req, res) => {
  tmClient.running = false
  robotPaused      = false

  try {
    if (tmClient.connected) {
      await tmClient.sendScript("abort", ["StopAndClearBuffer(0)"])
    }
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post("/robot/home", async (req, res) => {
  if (!tmClient.connected) return res.status(400).json({ error: "Robot not connected" })
  if (tmClient.running)    return res.status(400).json({ error: "Already running" })

  const { speed = 100 } = req.body || {}
  tmClient.running = true
  try {
    const t = ++tagCounter
    const homePos = `${POS_HOME.x},${POS_HOME.y},${POS_HOME.z},${POS_HOME.rx},${POS_HOME.ry},${POS_HOME.rz}`
    const ok = await tmClient.sendScript(`home${t}`, tagWrap([
      `ChangeTCP("${APP_TCP}")`,
      `PTP("CPP",{${homePos}},${speed},0,0,false)`
    ]))
    if (!ok || !await waitTag(`home${t}`)) {
      tmClient.running = false
      return res.status(500).json({ error: "Home move failed" })
    }
    tmClient.running = false
    await echoPoseOnce()
    res.json({ success: true })
  } catch (e) {
    tmClient.running = false
    res.status(500).json({ error: e.message })
  }
})

// ─── Camera endpoints ─────────────────────────────────────────────────────────

app.post("/camera/connect", (req, res) => {
  const { ip } = req.body
  if (ip) cameraClient.ip = ip
  cameraClient.connect()
  res.json({ success: true })
})

app.get("/camera/status", async (req, res) => {
  try {
    const r = await cameraClient.isConnected()
    res.json({
      isCameraConnected: r.isCameraConnected,
      connection_message: r.connection_message,
      serverReachable: true,
    })
  } catch (e) {
    // code 12 = server reachable but camera not initialized
    const serverReachable = e.code === 12 || (e.message && e.message.includes("12"))
    res.json({
      isCameraConnected: false,
      serverReachable,
      connection_message: e.message,
    })
  }
})

app.post("/api/camera/capture", async (req, res) => {
  // Bật đèn camera (Robot[0].InstantCameraLight, ghi qua Listen Node) ngay trước khi chụp
  // cho ảnh rõ, tự tắt lại sau — không có cảm biến để biết "trời tối" nên cứ bật mỗi lần chụp.
  const canControlLight = tmClient.connected
  if (canControlLight) {
    try { await tmClient.sendScript("lightOn", ["Robot[0].InstantCameraLight = 1"]) }
    catch (e) { console.warn("[Camera] Failed to turn on light:", e.message) }
  }
  try {
    console.log("[Camera] Capturing image...")
    const image = await cameraClient.capture()
    lastCapturedImage = image
    console.log("[Camera] Image captured")
    res.json({ image })
  } catch (e) {
    console.warn("[Camera] Capture failed:", e.message)
    res.status(500).json({ error: e.message })
  } finally {
    if (canControlLight) {
      try { await tmClient.sendScript("lightOff", ["Robot[0].InstantCameraLight = 0"]) }
      catch (e) { console.warn("[Camera] Failed to turn off light:", e.message) }
    }
  }
})

// Trang "Live Camera" — chụp liên tục (FE tự gọi lặp lại) để xem hình gần như live trong
// lúc cầm tay robot di chuyển (hand-guiding) đi tìm vị trí trước khi nhấn nút Point. Không
// đụng đèn ở đây (dùng nút bật/tắt đèn riêng đã có), không log từng frame — tránh spam.
app.get("/api/camera/live-frame", async (req, res) => {
  try {
    const image = await cameraClient.capture()
    res.json({ image })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Bật/tắt đèn camera thủ công (Robot[0].InstantCameraLight), độc lập với lúc chụp ảnh.
app.post("/api/camera/light", async (req, res) => {
  const { on } = req.body || {}
  if (!tmClient.connected) return res.status(400).json({ error: "Robot not connected" })
  try {
    await tmClient.sendScript("lightToggle", [`Robot[0].InstantCameraLight = ${on ? 1 : 0}`])
    console.log(`[Camera] Light ${on ? "ON" : "OFF"} (manual)`)
    res.json({ success: true, on: !!on })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get("/camera/latest", (req, res) => {
  res.json({ image: lastCapturedImage })
})

// ─── Generic single-point move ────────────────────────────────────────────────
// Dùng cho mọi việc di chuyển 1 điểm: jog (frontend tính target = pos hiện tại +
// delta), test 1 waypoint, và Next/Back đi qua từng waypoint của recipe.
// `label` là optional, chỉ để log cho dễ debug (vd "Approach", "jog +x").
app.post("/api/robot/move", async (req, res) => {
  const { pose, speed = 30, label = "point" } = req.body || {}

  if (!tmClient.connected) return res.status(400).json({ error: "Robot not connected" })
  if (tmClient.running)    return res.status(400).json({ error: "Already running" })
  if (!pose || ["x", "y", "z", "rx", "ry", "rz"].some(k => typeof pose[k] !== "number")) {
    return res.status(400).json({ error: "pose must include numeric x,y,z,rx,ry,rz" })
  }

  tmClient.running = true
  try {
    const tag = ++tagCounter
    const posStr = `${pose.x},${pose.y},${pose.z},${pose.rx},${pose.ry},${pose.rz}`
    console.log(`[Move] -> ${label} (${posStr}) speed=${speed}`)

    const ok = await tmClient.sendScript(`move${tag}`, tagWrap([
      `ChangeTCP("${APP_TCP}")`,
      `PTP("CPP",{${posStr}},${speed},0,0,false)`
    ]))

    if (!ok) {
      tmClient.running = false
      return res.status(500).json({ error: `Move to ${label} failed` })
    }

    const done = await waitTag(`move${tag}`, 60000)
    if (!done) {
      tmClient.running = false
      return res.status(500).json({ error: `Move to ${label} timeout waiting QueueTag` })
    }

    // TMRTS (port 5895) có thể không khả dụng — coi pose vừa đến (xác nhận qua QueueTag) là
    // "đã biết thật", dùng làm fallback hiển thị khi không có stream real-time.
    tmMonitor.pos = { x: pose.x, y: pose.y, z: pose.z, rx: pose.rx, ry: pose.ry, rz: pose.rz }
    tmMonitor.poseKnown = true
    tmClient.running = false
    console.log(`[Move] Reached ${label}`)
    await echoPoseOnce()
    res.json({ success: true, pos: tmMonitor.pos })
  } catch (e) {
    tmClient.running = false
    res.status(500).json({ error: e.message })
  }
})

// ─── Recipe CRUD ────────────────────────────────────────────────────────────────
// 1 recipe = 1 object/model: tên + speed + 1 danh sách waypoint tự do
// ([{ label, x, y, z, rx, ry, rz }, ...] — người dùng tự thêm/xoá/đặt tên trong Recipe.vue).

app.get("/api/recipes", (req, res) => {
  db.all("SELECT * FROM recipes", (err, rows) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json(rows.map(serializeRecipe))
  })
})

app.get("/api/recipes/:id", (req, res) => {
  db.get("SELECT * FROM recipes WHERE id = ?", [req.params.id], (err, row) => {
    if (err)  return res.status(500).json({ error: err.message })
    if (!row) return res.status(404).json({ error: "Recipe not found" })
    res.json(serializeRecipe(row))
  })
})

app.post("/api/recipes", (req, res) => {
  const { name, speed = 50, waypoints = [] } = req.body || {}
  if (!name) return res.status(400).json({ error: "name required" })
  db.run(
    "INSERT INTO recipes (name, speed, waypoints) VALUES (?,?,?)",
    [name, speed, JSON.stringify(waypoints)],
    function (err) {
      if (err) return res.status(500).json({ error: err.message })
      res.json({ id: this.lastID })
    }
  )
})

app.put("/api/recipes/:id", (req, res) => {
  const { name, speed, waypoints = [] } = req.body || {}
  db.run(
    "UPDATE recipes SET name=?, speed=?, waypoints=? WHERE id=?",
    [name, speed, JSON.stringify(waypoints), req.params.id],
    err => {
      if (err) return res.status(500).json({ error: err.message })
      res.json({ success: true })
    }
  )
})

app.delete("/api/recipes/:id", (req, res) => {
  db.run("DELETE FROM recipes WHERE id=?", [req.params.id], err => {
    if (err) return res.status(500).json({ error: err.message })
    res.json({ success: true })
  })
})

// ─── Logs ────────────────────────────────────────────────────────────────────

app.post("/logs", (req, res) => {
  const { key, params = [], level = "info" } = req.body
  db.run(
    "INSERT INTO logs (ts, level, key, params) VALUES (?,?,?,?)",
    [Date.now(), level, key, JSON.stringify(params)],
    err => err ? res.status(500).json(err) : res.json({ ok: true })
  )
})

app.get("/logs", (req, res) => {
  const limit = parseInt(req.query.limit) || 500
  db.all(
    "SELECT * FROM logs ORDER BY ts DESC LIMIT ?",
    [limit],
    (err, rows) => err ? res.status(500).json(err) : res.json(rows)
  )
})

app.delete("/logs", (req, res) => {
  db.run("DELETE FROM logs", err => err ? res.status(500).json(err) : res.json({ ok: true }))
})

initIntegration({
  tmClient, tmMonitor,
  get robotPaused()      { return robotPaused },      set robotPaused(v)      { robotPaused = v },
  get integrationRecipe(){ return integrationRecipe }, set integrationRecipe(v){ integrationRecipe = v },
  get currentRecipeId()  { return currentRecipeId },  set currentRecipeId(v)  { currentRecipeId = v },
}, db)
app.use("/integration", integrationRouter)

// ─── Echo pose/joints qua Listen Node ─────────────────────────────────────────
// ntd_VisionPC (TMflow Network Device) chỉ tự kết nối/gửi khi chạy flow project bình
// thường (qua Start node) — không tự gửi khi robot ở Listen Node. Nên ngay khi 1 lệnh
// move hoàn thành, backend tự gửi 1 lần script đọc pose/joint thật (Robot[0].CoordRobot /
// Robot[0].Joint) rồi robot echo lại qua socket_sendline tới port 8765 (VisionPCServer).
// Không khai báo biến local (float[] p = ...) — Listen Node giữ local variable giữa các
// lần gửi script trong cùng session, khai báo lại biến đã tồn tại sẽ lỗi ERROR;<dòng>
// (xác nhận trong manual TMscript §15.2, mục 4: "Because int var_i has been declared, an
// error occurred"). Dùng trực tiếp Robot[0].CoordRobot[i]/Robot[0].Joint[i] để tránh hẳn.
// ChangeTCP ở đầu — Robot[0].CoordRobot phụ thuộc TCP đang active, phải ép về APP_TCP
// trước khi đọc để pose echo ra luôn đúng frame, khớp với frame lúc move/teach điểm.
const ECHO_POSE_SCRIPT = [
  `ChangeTCP("${APP_TCP}")`,
  'socket_sendline("ntd_VisionPC", "POSE," + (string)Robot[0].CoordRobot[0] + "," + (string)Robot[0].CoordRobot[1] + "," + (string)Robot[0].CoordRobot[2] + "," + (string)Robot[0].CoordRobot[3] + "," + (string)Robot[0].CoordRobot[4] + "," + (string)Robot[0].CoordRobot[5])',
  'socket_sendline("ntd_VisionPC", "JOINTS," + (string)Robot[0].Joint[0] + "," + (string)Robot[0].Joint[1] + "," + (string)Robot[0].Joint[2] + "," + (string)Robot[0].Joint[3] + "," + (string)Robot[0].Joint[4] + "," + (string)Robot[0].Joint[5])',
]
async function echoPoseOnce() {
  try {
    await tmClient.sendScript("echoPose", ECHO_POSE_SCRIPT, { quiet: true })
  } catch (e) {
    console.warn("[EchoPose] Failed:", e.message)
  }
}

// Nền chậm 1s/lần để vẫn có số liệu khi robot đứng yên (không move) — cộng với
// echoPoseOnce() gọi ngay sau mỗi move ở trên cho cảm giác phản hồi nhanh lúc vừa tới điểm.
setInterval(() => {
  if (!tmClient.connected || tmClient.running) return
  echoPoseOnce()
}, 1000)

// Dò Point["P1"], "P2"... có sẵn trong Point Manager của project robot — cho phép người
// không biết nhập tay XYZ vẫn tạo được điểm: cầm tay robot (hand-guiding) di chuyển, nhấn
// nút Point trên tay robot để lưu vào project, rồi mình tự dò thấy sau khi Connect, hỏi
// người dùng có muốn lưu thành recipe mới không (không cần sửa flow TMflow).
// Dừng dò sau MAX_POINT_MISSES lần liên tiếp không tồn tại (không có API liệt kê tổng số
// point trong tài liệu, nên phải dò tuần tự P1, P2, P3...).
// QUAN TRỌNG: tuyệt đối không đọc Point["Pn"] với n vượt quá số điểm thật sự có trong
// project — đã xác nhận thực tế trên robot là đọc 1 Point không tồn tại làm robot báo
// alarm (fault) và tự rời khỏi Listen Node ngay lập tức (kéo cả kênh ntd_VisionPC rớt theo),
// không phải chỉ là 1 lỗi script vô hại như tài liệu mô tả chung. Vì TMscript không có hàm
// kiểm tra "Point có tồn tại không" và không có try/catch, KHÔNG dò mò số lượng nữa — bắt
// người dùng tự nhập đúng số điểm vừa teach (count), chỉ đọc chính xác P1..Pcount.
const MAX_POINT_COUNT = 30
let pendingImportPoints = []

async function scanRobotPoints(count) {
  visionPCServer.clearTaughtPoints()
  const found = []
  for (let i = 1; i <= count; i++) {
    if (tmClient.running) break   // đang move thì nhường kênh, không tranh script với lệnh move
    const name = `P${i}`
    // Chỉ echo nếu point được teach bằng đúng TCP của app (HandCamera) — point teach bằng
    // tool khác (ví dụ "bit") sẽ sai frame nếu đem thẳng vào recipe, nên bỏ qua, không đoán.
    const ok = await tmClient.sendScript(`probe${name}`, [
      `if (Point["${name}"].TCPName == "${APP_TCP}") {`,
      `socket_sendline("ntd_VisionPC", "TAUGHT,${name}," + (string)Point["${name}"].Value[0] + "," + (string)Point["${name}"].Value[1] + "," + (string)Point["${name}"].Value[2] + "," + (string)Point["${name}"].Value[3] + "," + (string)Point["${name}"].Value[4] + "," + (string)Point["${name}"].Value[5])`,
      `}`,
    ])
    if (!ok) {
      console.warn(`[ScanPoints] ${name} không đọc được (không tồn tại?) — dừng dò, kiểm tra robot có bị alarm không`)
      break
    }
    await new Promise(r => setTimeout(r, 100))  // chờ data echo qua port 8765 kịp tới
    const p = visionPCServer.taughtPoints[name]
    if (p) found.push({ name, x: p.x, y: p.y, z: p.z, rx: p.rx, ry: p.ry, rz: p.rz })
  }
  pendingImportPoints = found
  console.log(found.length > 0
    ? `[ScanPoints] Found ${found.length} point(s) (TCP=${APP_TCP}) in robot project: ${found.map(p => p.name).join(", ")}`
    : "[ScanPoints] No matching points found in robot project")
  return found
}

// Người dùng tự bấm "Nhập điểm từ robot" và nhập đúng số điểm vừa teach — không tự quét.
app.post("/api/robot/import-points", async (req, res) => {
  const count = parseInt(req.body?.count, 10)
  if (!tmClient.connected) return res.status(400).json({ error: "Robot not connected" })
  if (!Number.isInteger(count) || count < 1 || count > MAX_POINT_COUNT) {
    return res.status(400).json({ error: `count phải từ 1 đến ${MAX_POINT_COUNT}` })
  }
  try {
    const found = await scanRobotPoints(count)
    res.json({ points: found })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Dashboard hỏi có điểm vừa quét được không (sau khi gọi import-points) để gợi ý lưu recipe.
app.get("/api/robot/pending-import", (req, res) => {
  res.json({ points: pendingImportPoints })
})

app.post("/api/robot/pending-import/dismiss", (req, res) => {
  pendingImportPoints = []
  res.json({ success: true })
})

// Tạo 1 recipe mới từ các điểm vừa dò được — tên tự tăng dần "Recipe N".
app.post("/api/robot/pending-import/save", (req, res) => {
  if (pendingImportPoints.length === 0) return res.status(400).json({ error: "No pending points" })
  db.all("SELECT name FROM recipes", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message })
    let n = 1
    const existing = new Set((rows || []).map(r => r.name))
    while (existing.has(`Recipe ${n}`)) n++
    const waypoints = pendingImportPoints.map(p => ({
      label: p.name, x: p.x, y: p.y, z: p.z, rx: p.rx, ry: p.ry, rz: p.rz, capturePoint: false,
    }))
    db.run(
      "INSERT INTO recipes (name, speed, waypoints) VALUES (?,?,?)",
      [`Recipe ${n}`, 50, JSON.stringify(waypoints)],
      function (err2) {
        if (err2) return res.status(500).json({ error: err2.message })
        pendingImportPoints = []
        res.json({ id: this.lastID, name: `Recipe ${n}` })
      }
    )
  })
})

app.listen(3000, () => {
  console.log("server running")
})
