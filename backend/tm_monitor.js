/**
 * TM Robot RTRS Monitor — port 5895 (TMRTS protocol)
 * Subscribes to TCP_Value and receives pushed Cartesian position at 10 Hz.
 */

const net = require("net")

const RTRS_PORT = 5895

// TODO(verify): "Joint_Angle" is the commonly documented TM Expression Editor / External
// Control system variable for the 6 current joint angles (degrees). It has NOT been
// confirmed against this robot's actual TM5-700 manual. If joint values never populate,
// check the [TMMonitor] warning logged below (it prints the raw packet) and correct this
// name to match the real system variable from TMflow > Expression Editor > System Variables.
const JOINT_VAR = "Joint_Angle"

const VISION_VARS = [
  "detectbuttonOnBoard_Shape_Pattern_1_DetectObjectX_TM",
  "detectbuttonOnBoard_Shape_Pattern_1_DetectObjectY_TM",
  "detectbuttonOnBoard_Shape_Pattern_1_DetectObjectR_TM",
]

function checksum(raw) {
  // raw is a Buffer; XOR bytes between '$' and '*'
  const start = raw.indexOf(0x24) + 1  // after '$'
  const end   = raw.lastIndexOf(0x2A)  // before '*'
  let cs = 0
  for (let i = start; i < end; i++) cs ^= raw[i]
  return cs.toString(16).padStart(2, "0").toUpperCase()
}

function buildPacket(header, dataBuf) {
  const prefix = Buffer.from(`$${header},${dataBuf.length},`, "utf8")
  const suffix = Buffer.from(",*", "utf8")
  const raw    = Buffer.concat([prefix, dataBuf, suffix])
  return Buffer.concat([raw, Buffer.from(checksum(raw) + "\r\n", "utf8")])
}

class TMMonitor {
  constructor() {
    this.socket    = null
    this.buffer    = Buffer.alloc(0)
    this.connected = false
    this.pos       = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
    // true sau khi pos được xác nhận thật từ robot — qua TMRTS stream (this.connected)
    // HOẶC qua 1 lệnh move vừa hoàn tất thành công (xem /api/robot/move trong server.js).
    // Dùng làm fallback "approx pose" khi TMRTS (port 5895) không khả dụng.
    this.poseKnown = false
    this.joints    = { j1: 0, j2: 0, j3: 0, j4: 0, j5: 0, j6: 0 }
    this.vision    = { x: 0, y: 0, r: 0 }
    this._id       = 0
    this._connectedAt  = 0
    this._jointWarned  = false
  }

  connect(ip) {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket()
      this.socket.setTimeout(5000)
      this.socket.on("data",    d  => this._onData(d))
      this.socket.on("close",   () => { this.connected = false })
      this.socket.on("error",   e  => reject(e))
      this.socket.on("timeout", () => reject(new Error("RTRS timeout")))
      this.socket.connect(RTRS_PORT, ip, () => {
        this.connected     = true
        this._connectedAt  = Date.now()
        this._jointWarned  = false
        this.socket.setTimeout(30000)  // longer idle timeout after connected
        this._configure()
        console.log(`[TMMonitor] Connected to ${ip}:${RTRS_PORT} — streaming TCP_Value + ${JOINT_VAR} at 10Hz`)
        resolve()
      })
    })
  }

  disconnect() {
    if (this.connected && this.socket) {
      try { this._sendText(7, "0") } catch (_) {}
    }
    if (this.socket) { this.socket.destroy(); this.socket = null }
    this.connected = false
    this.pos       = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
    this.poseKnown = false
    this.joints    = { j1: 0, j2: 0, j3: 0, j4: 0, j5: 0, j6: 0 }
  }

  // ── send helpers ────────────────────────────────────────────────────────────

  _sendText(mode, data) {
    this._id++
    const payload = Buffer.from(`${this._id},${mode},${data}`, "utf8")
    this.socket.write(buildPacket("TMRTS", payload))
  }

  _sendBin(mode, dataBuf) {
    this._id++
    const prefix = Buffer.from(`${this._id},${mode},`, "utf8")
    this.socket.write(buildPacket("TMRTS", Buffer.concat([prefix, dataBuf])))
  }

  // ── configure streaming ─────────────────────────────────────────────────────

  _configure() {
    // Mode 9: subscribe TCP_Value (system var — luôn hoạt động)
    this._subscribeVar("TCP_Value")

    // Mode 9: subscribe Joint_Angle (6 current joint angles, degrees)
    this._subscribeVar(JOINT_VAR)

    // Sau khi stream start, subscribe thêm vision vars từng cái một
    setTimeout(() => this._subscribeVision(), 500)

    // Mode 8: 100ms interval
    this._sendText(8, "100")

    // Mode 7: start streaming
    this._sendText(7, "1")
  }

  _subscribeVar(varName) {
    const nb  = Buffer.from(varName, "utf8")
    const buf = Buffer.from([0x01, 0x00, nb.length & 0xff, (nb.length >> 8) & 0xff])
    this._sendBin(9, Buffer.concat([buf, nb]))
  }

  _subscribeVision() {
    if (!this.connected) return
    for (const varName of VISION_VARS) this._subscribeVar(varName)
  }

  // ── data parsing ────────────────────────────────────────────────────────────

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    let crlf
    while ((crlf = this.buffer.indexOf("\r\n")) >= 0) {
      const packet = this.buffer.slice(0, crlf)
      this.buffer  = this.buffer.slice(crlf + 2)
      this._parsePacket(packet)
    }
  }

  // Tìm varName trong packet, đọc `count` float32 LE ngay sau 2-byte value_len.
  // Trả về array float[] nếu thấy đủ dữ liệu, ngược lại null.
  _extractFloats(buf, varName, count) {
    const nameBuf = Buffer.from(varName, "utf8")
    const idx = buf.indexOf(nameBuf)
    if (idx < 0) return null
    const fs = idx + nameBuf.length + 2   // skip 2-byte value_len
    if (fs + count * 4 > buf.length) return null
    const vals = []
    for (let i = 0; i < count; i++) vals.push(buf.readFloatLE(fs + i * 4))
    return vals
  }

  _parsePacket(buf) {
    if (buf.indexOf("$TMRTS") !== 0) return

    // ── TCP_Value (position) ─────────────────────────────────────────────────
    const tcpVals = this._extractFloats(buf, "TCP_Value", 6)
    if (tcpVals) {
      this.pos = {
        x:  +tcpVals[0].toFixed(2),
        y:  +tcpVals[1].toFixed(2),
        z:  +tcpVals[2].toFixed(2),
        rx: +tcpVals[3].toFixed(2),
        ry: +tcpVals[4].toFixed(2),
        rz: +tcpVals[5].toFixed(2),
      }
      this.poseKnown = true
    }

    // ── Joint_Angle (current joint angles, degrees) ──────────────────────────
    const jointVals = this._extractFloats(buf, JOINT_VAR, 6)
    if (jointVals) {
      this.joints = {
        j1: +jointVals[0].toFixed(2),
        j2: +jointVals[1].toFixed(2),
        j3: +jointVals[2].toFixed(2),
        j4: +jointVals[3].toFixed(2),
        j5: +jointVals[4].toFixed(2),
        j6: +jointVals[5].toFixed(2),
      }
    } else if (!this._jointWarned && Date.now() - this._connectedAt > 3000) {
      this._jointWarned = true
      console.warn(
        `[TMMonitor] System variable "${JOINT_VAR}" not found in TMRTS stream after 3s — ` +
        `joint angles will stay unavailable. Verify the correct variable name in TMflow > ` +
        `Expression Editor > System Variables (or the TM5-700 External Control manual) and ` +
        `update JOINT_VAR in tm_monitor.js. Raw packet sample: ${buf.toString("utf8").slice(0, 200)}`
      )
    }

    // ── Vision variables (X, Y, R) ───────────────────────────────────────────
    const vals = []
    for (const varName of VISION_VARS) {
      const nb  = Buffer.from(varName, "utf8")
      const idx = buf.indexOf(nb)
      if (idx < 0) { vals.push(null); continue }
      const vs = idx + nb.length + 2   // skip 2-byte value_len
      if (vs + 4 > buf.length) { vals.push(null); continue }
      vals.push(buf.readFloatLE(vs))
    }
    if (vals[0] !== null) {
      this.vision = {
        x: Math.round(vals[0]),
        y: Math.round(vals[1]),
        r: vals[2] !== null ? +vals[2].toFixed(1) : 0,
      }
    }
  }
}

module.exports = { TMMonitor }
