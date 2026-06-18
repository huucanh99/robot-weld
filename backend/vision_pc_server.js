/**
 * TCP server nhận pose/joints/status realtime từ robot qua TMflow Network Device
 * "ntd_VisionPC" (robot configure sẵn IP=PC, port=8765) — kênh này vốn dùng cho vision,
 * tái dùng lại vì RTRS/TMRTS (port 5895) không mở được trên robot này.
 *
 * Khác với TMRTS: robot là CLIENT chủ động connect tới đây, không cần handshake/subscribe
 * gì cả — chỉ cần lắng nghe và parse message robot gửi.
 */

const net = require("net")

const PORT = 8765
const MAX_BUFFER_BYTES = 65536 // chặn buffer phình vô hạn nếu robot gửi sai không có newline

class VisionPCServer {
  constructor() {
    this.server          = null
    this.listening        = false
    this.clientConnected  = false
    this.lastMessageTime  = null
    this.lastRawMessage   = null
    this.listenError      = null

    this.pose   = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, ts: 0 }
    this.joints = { j1: 0, j2: 0, j3: 0, j4: 0, j5: 0, j6: 0, ts: 0 }
    this.status = { value: null, ts: 0 }
    this.taughtPoints = {} // { [pointName]: {x,y,z,rx,ry,rz,ts} } — dùng cho dò Point["P1"]... có sẵn trong project robot

    this._buffers      = new Map()  // socket -> leftover string chưa đủ 1 dòng
    this._connectedCount = 0
  }

  start() {
    if (this.server) return

    this.server = net.createServer(socket => this._onConnection(socket))

    this.server.on("error", err => {
      this.listening = false
      if (err.code === "EADDRINUSE") {
        console.error(`[VisionPCServer] Port ${PORT} is already in use — another process is occupying it. Stop that process or change PORT in vision_pc_server.js.`)
      } else {
        console.error(`[VisionPCServer] Server error: ${err.message}`)
      }
      this.listenError = err.message
    })

    this.server.listen(PORT, "0.0.0.0", () => {
      this.listening   = true
      this.listenError = null
      console.log(`[VisionPCServer] Listening on 0.0.0.0:${PORT}`)
    })
  }

  _onConnection(socket) {
    console.log(`[VisionPCServer] Client connected: ${socket.remoteAddress}:${socket.remotePort}`)
    this._connectedCount++
    this.clientConnected = true
    this._buffers.set(socket, "")

    socket.on("data", chunk => this._onData(socket, chunk))

    socket.on("close", () => {
      // Robot có thể gửi 1 message rồi đóng kết nối ngay, không kèm \n — xử lý phần
      // còn sót trong buffer như 1 dòng cuối, tránh mất data im lặng.
      const leftover = (this._buffers.get(socket) || "").trim()
      if (leftover) this._handleLine(leftover)

      this._buffers.delete(socket)
      this._connectedCount = Math.max(0, this._connectedCount - 1)
      this.clientConnected = this._connectedCount > 0
      console.log("[VisionPCServer] Client disconnected")
    })

    socket.on("error", err => {
      console.warn("[VisionPCServer] Socket error:", err.message)
    })
  }

  _onData(socket, chunk) {
    let buf = (this._buffers.get(socket) || "") + chunk.toString("utf8")

    let idx
    while ((idx = buf.search(/\r?\n/)) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + (buf[idx] === "\r" ? 2 : 1))
      if (line) this._handleLine(line)
    }

    if (buf.length > MAX_BUFFER_BYTES) {
      console.warn("[VisionPCServer] Buffer exceeded max size without a newline — discarding (check robot message framing)")
      buf = ""
    }
    this._buffers.set(socket, buf)
  }

  _handleLine(line) {
    this.lastMessageTime = Date.now()
    this.lastRawMessage  = line

    // Format CSV "POSE,x,y,z,rx,ry,rz" / "JOINTS,j1..j6" — backend tự gửi script echo
    // pose/joint qua Listen Node (xem ECHO_POSE_SCRIPT trong server.js), tránh phải dựng
    // JSON literal trong TMscript (không có cách escape " được xác nhận trong tài liệu).
    // Không log raw — chạy mỗi giây, bóp chết log thật cần quan sát (vd lỗi dò Point).
    if (line.startsWith("POSE,") || line.startsWith("JOINTS,")) {
      this._handleCsvLine(line, { quiet: true })
      return
    }

    console.log("[VisionPCServer] Raw message:", line)

    // "TAUGHT,<pointName>,x,y,z,rx,ry,rz" — kết quả dò Point["P1"]... có sẵn trong project
    // robot (xem scanRobotPoints trong server.js), khác POSE/JOINTS vì có thêm tên point.
    if (line.startsWith("TAUGHT,")) {
      const parts = line.split(",")
      const name  = parts[1]
      const nums  = parts.slice(2).map(Number)
      if (name && nums.length === 6 && !nums.some(Number.isNaN)) {
        this.taughtPoints[name] = { x: nums[0], y: nums[1], z: nums[2], rx: nums[3], ry: nums[4], rz: nums[5], ts: Date.now() }
        console.log("[VisionPCServer] Parsed taught point:", name, this.taughtPoints[name])
      } else {
        console.warn("[VisionPCServer] Malformed TAUGHT line:", line)
      }
      return
    }

    let data
    try {
      data = JSON.parse(line)
    } catch (_) {
      return // không phải JSON — đã log raw ở trên để debug, bỏ qua phần parse tiếp
    }
    if (!data || typeof data !== "object") return

    if (data.type === "pose") {
      this.pose = {
        x: Number(data.x), y: Number(data.y), z: Number(data.z),
        rx: Number(data.rx), ry: Number(data.ry), rz: Number(data.rz),
        ts: Date.now(),
      }
      console.log("[VisionPCServer] Parsed pose:", this.pose)
    } else if (data.type === "joints") {
      this.joints = {
        j1: Number(data.j1), j2: Number(data.j2), j3: Number(data.j3),
        j4: Number(data.j4), j5: Number(data.j5), j6: Number(data.j6),
        ts: Date.now(),
      }
      console.log("[VisionPCServer] Parsed joints:", this.joints)
    } else if (data.type === "status") {
      this.status = { value: data.value, ts: Date.now() }
      console.log("[VisionPCServer] Parsed status:", this.status)
    }
  }

  _handleCsvLine(line, opts = {}) {
    const quiet = !!opts.quiet
    const parts = line.split(",")
    const tag   = parts[0]
    const nums  = parts.slice(1).map(Number)
    if (nums.length !== 6 || nums.some(Number.isNaN)) {
      console.warn("[VisionPCServer] Malformed CSV line (expected 6 numbers):", line)
      return
    }
    if (tag === "POSE") {
      this.pose = { x: nums[0], y: nums[1], z: nums[2], rx: nums[3], ry: nums[4], rz: nums[5], ts: Date.now() }
      if (!quiet) console.log("[VisionPCServer] Parsed pose:", this.pose)
    } else if (tag === "JOINTS") {
      this.joints = { j1: nums[0], j2: nums[1], j3: nums[2], j4: nums[3], j5: nums[4], j6: nums[5], ts: Date.now() }
      if (!quiet) console.log("[VisionPCServer] Parsed joints:", this.joints)
    }
  }

  // "Live" giờ nghĩa là: kênh port 8765 đang connected VÀ đã từng nhận được ít nhất 1 lần
  // data — không còn đòi hỏi data phải mới trong vài giây, vì giờ chỉ cập nhật mỗi khi
  // hoàn thành 1 move (có thể cách nhau lâu hơn), không spam liên tục nữa.
  isPoseFresh()   { return this.clientConnected && this.pose.ts   > 0 }
  isJointsFresh() { return this.clientConnected && this.joints.ts > 0 }

  clearTaughtPoints() { this.taughtPoints = {} }

  getNetworkStatus() {
    return {
      listening:        this.listening,
      clientConnected:  this.clientConnected,
      lastMessageTime:  this.lastMessageTime,
      lastRawMessage:   this.lastRawMessage,
      listenError:      this.listenError,
    }
  }
}

module.exports = { VisionPCServer }
