/**
 * TM Robot External Control Client (Listen Node)
 * Protocol: TCP Socket, Port 5890
 */

const net = require("net")

const ROBOT_PORT      = 5890
const CONNECT_TIMEOUT = 5000   // ms — connection attempt
const IDLE_TIMEOUT    = 600000 // ms — idle after connected (10 phút)

// ── Checksum ───────────────────────────────────────────────────────────────

function calcChecksum(raw) {
  const inner = raw.slice(1, raw.lastIndexOf("*"))
  let cs = 0
  for (const b of Buffer.from(inner, "utf8")) cs ^= b
  return cs.toString(16).padStart(2, "0").toUpperCase()
}

function buildPacket(header, data) {
  const len = Buffer.byteLength(data, "utf8")
  const raw = `$${header},${len},${data},*`
  return raw + calcChecksum(raw) + "\r\n"
}

function parseLine(line) {
  line = line.trim()
  if (!line.startsWith("$")) return null
  const m = line.match(/^\$([^,]+),(\d+),(.+),\*([0-9A-Fa-f]{2})$/)
  if (!m) return null
  return { header: m[1], length: parseInt(m[2]), data: m[3], cs: m[4] }
}

// ── TMClient ───────────────────────────────────────────────────────────────

class TMClient {
  constructor(ip = "127.0.0.1", port = ROBOT_PORT) {
    this.ip           = ip
    this.port         = port
    this.socket       = null
    this.buffer       = ""
    this.connected    = false
    this.running      = false
    this._socketGen   = 0     // tăng mỗi lần disconnect — để waitForListenNode detect socket thay đổi
    // Separate queues per packet type — prevents cross-contamination
    this.tmsctQueue   = []   // buffered TMSCT / CPERR packets
    this.tmstaQueue   = []   // buffered TMSTA packets
    this.tmsctWaiters = []
    this.tmstaWaiters = []
    this._scriptBusy  = false  // mutex cho sendScript() — tránh 2 script (move + echo pose) đụng nhau trên cùng kênh TMSCT
  }

  // ── connect / disconnect ────────────────────────────────────────────────

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket()

      const timer = setTimeout(() => {
        if (this.socket) this.socket.destroy()
        reject(new Error(`無法連線到 ${this.ip}:${this.port}，請確認 IP 是否正確`))
      }, CONNECT_TIMEOUT)

      this.socket.on("data",  (d) => this._onData(d))
      this.socket.on("close", ()  => {
        this.connected = false
        this.socket    = null
        this._rejectAllWaiters(new Error("Socket disconnected"))
      })
      this.socket.on("error", (e) => { clearTimeout(timer); reject(e) })
      this.socket.connect(this.port, this.ip, () => {
        clearTimeout(timer)
        if (!this.socket) return
        this.connected = true
        this.socket.setTimeout(IDLE_TIMEOUT)
        this.socket.on("timeout", () => {
          console.warn("[Socket] idle timeout")
          this.disconnect()
        })
        resolve()
      })
    })
  }

  disconnect() {
    this._socketGen++                                              // invalidate mọi waitForListenNode đang chạy
    this._rejectAllWaiters(new Error("Disconnected"))
    if (this.socket) { this.socket.destroy(); this.socket = null }
    this.connected    = false
    this.running      = false
    this.buffer       = ""
    this.tmsctQueue   = []
    this.tmstaQueue   = []
  }

  // ── routing ─────────────────────────────────────────────────────────────

  _onData(data) {
    const raw = data.toString("utf8")
    this.buffer += raw
    while (this.buffer.includes("\r\n")) {
      const idx  = this.buffer.indexOf("\r\n")
      const line = this.buffer.slice(0, idx)
      this.buffer = this.buffer.slice(idx + 2)
      const pkt = parseLine(line)
      if (pkt) this._route(pkt)
      else if (line.trim()) console.log(`[RAW] unparse: ${JSON.stringify(line)}`)
    }
  }

  _rejectAllWaiters(err) {
    ;[...this.tmsctWaiters, ...this.tmstaWaiters].forEach(w => w.reject(err))
    this.tmsctWaiters = []
    this.tmstaWaiters = []
  }

  _route(pkt) {
    if (pkt.header === "TMSCT" || pkt.header === "CPERR") {
      if (this.tmsctWaiters.length > 0) {
        this.tmsctWaiters.shift().resolve(pkt)
      } else {
        this.tmsctQueue.push(pkt)
      }
    } else if (pkt.header === "TMSTA") {
      if (this.tmstaWaiters.length > 0) {
        this.tmstaWaiters.shift().resolve(pkt)
      } else {
        this.tmstaQueue.push(pkt)
      }
    } else {
      console.log(`[PKT←] unknown header, dropped`)
    }
  }

  _recvTyped(queue, waiters, timeout) {
    if (queue.length > 0) return Promise.resolve(queue.shift())
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.findIndex(w => w.resolve === resolve)
        if (idx >= 0) waiters.splice(idx, 1)
        reject(new Error("Receive timeout"))
      }, timeout)
      waiters.push({ resolve: pkt => { clearTimeout(timer); resolve(pkt) }, reject })
    })
  }

  recvTMSCT(timeout = 30000) {
    return this._recvTyped(this.tmsctQueue, this.tmsctWaiters, timeout)
  }

  recvTMSTA(timeout = 60000) {
    return this._recvTyped(this.tmstaQueue, this.tmstaWaiters, timeout)
  }

  sendRaw(header, data) {
    if (!this.socket) throw new Error('Socket disconnected')
    this.socket.write(buildPacket(header, data))
  }

  // ── wait for Listen Node ────────────────────────────────────────────────

  // Chỉ poll cho đến khi robot vào Listen Node — KHÔNG tự reconnect
  async waitForListenNode(maxWaitMs = 15000) {
    const myGen  = this._socketGen   // snapshot generation khi bắt đầu
    const deadline = Date.now() + maxWaitMs
    while (Date.now() < deadline) {
      // Socket bị disconnect() từ bên ngoài (manual connect, new session) → dừng ngay
      if (this._socketGen !== myGen)  throw new Error("Connection reset")
      if (this.running)               throw new Error("__RUN_STARTED__")
      if (!this.connected) {
        await new Promise(r => setTimeout(r, 300))
        continue
      }
      if (await this.queryListenMode()) return
      const pkt = await this.recvTMSCT(2000).catch(() => null)
      if (pkt && pkt.header === "TMSCT") {
        console.log("[Listen Node] Entered")
        return
      }
      await new Promise(r => setTimeout(r, 300))
    }
    throw new Error("Robot not in Listen Node")
  }

  async queryListenMode() {
    try { this.sendRaw("TMSTA", "00") } catch (_) { return false }
    const resp = await this.recvTMSTA(5000).catch(() => null)
    if (resp) {
      const parts = resp.data.split(",")
      const inMode = parts[1] && parts[1].toLowerCase() === "true"
      console.log(`[Status] External control mode: ${inMode ? "yes" : "no"}`)
      return inMode
    }
    return false
  }

  // ── send TMscript ───────────────────────────────────────────────────────

  // opts.quiet: bỏ log "sending"/"OK" cho script chạy lặp lại liên tục (echo pose 1s/lần) —
  // vẫn log timeout/CPERR/FAIL để không che mất lỗi thật, chỉ ẩn phần spam lúc chạy bình thường.
  async sendScript(scriptId, scriptLines, opts = {}) {
    // Chỉ 1 script được gửi/chờ phản hồi tại 1 thời điểm trên kênh TMSCT — nếu không, 2 lệnh
    // gửi gần nhau (ví dụ lệnh move và script echo pose định kỳ) có thể nhận nhầm response
    // của nhau (recvTMSCT lấy theo FIFO, không khớp theo scriptId).
    const quiet = !!opts.quiet
    while (this._scriptBusy) await new Promise(r => setTimeout(r, 20))
    this._scriptBusy = true
    try {
      this.tmsctQueue = []  // drain stale packets từ Listen Node entry cũ
      const data = `${scriptId},` + scriptLines.join("\r\n")
      if (!quiet) console.log(`[sendScript] sending ${scriptId}`)
      this.sendRaw("TMSCT", data)
      const resp = await this.recvTMSCT(30000)
      if (!resp) { console.log(`[TMSCT] timeout id=${scriptId}`); return false }
      if (resp.header === "CPERR") { console.log(`[CPERR] ${resp.data}`); return false }
      const ok = resp.data.includes(",OK")
      if (!quiet || !ok) console.log(`[TMSCT] ${ok ? "OK" : "FAIL"} id=${scriptId} — resp: ${resp.data}`)
      return ok
    } finally {
      this._scriptBusy = false
    }
  }

  // ── wait QueueTag ───────────────────────────────────────────────────────

  async waitQueueTag(tagId, pollInterval = 100, maxWait = 120000) {
    // Xả hết TMSTA cũ trong queue (broadcast tự động từ script trước, không liên quan đến script này)
    this.tmstaQueue = []

    const deadline = Date.now() + maxWait
    const start    = Date.now()
    console.log(`[Wait] QueueTag ${tagId}...`)
    let lastLogSec = 0
    while (true) {
      if (!this.running)
        throw new Error(`QueueTag ${tagId} aborted`)
      if (Date.now() > deadline)
        throw new Error(`QueueTag ${tagId} timeout — robot không phản hồi sau ${maxWait / 1000}s`)

      // Socket đang disconnect — chờ reconnect, không fail ngay
      if (!this.connected) {
        await new Promise(r => setTimeout(r, 200))
        continue
      }

      try { this.sendRaw("TMSTA", `01,${tagId}`) } catch (_) {
        await new Promise(r => setTimeout(r, 200))
        continue
      }

      const resp = await this.recvTMSTA(10000).catch(() => null)
      if (!resp) {
        await new Promise(r => setTimeout(r, 200))
        continue
      }

      const parts = resp.data.split(",")
      // parseInt để xử lý cả "1" lẫn "01" (robot đôi khi zero-pad tagId)
      if (parts.length >= 3 && parseInt(parts[1]) === tagId && parts[2].toLowerCase() === "true") {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1)
        console.log(`[QueueTag ${tagId}] Done (${elapsed}s)`)
        return
      }
      const elapsedSec = Math.floor((Date.now() - start) / 1000)
      if (elapsedSec > 0 && elapsedSec !== lastLogSec && elapsedSec % 5 === 0) {
        console.log(`[QueueTag ${tagId}] still waiting... ${elapsedSec}s`)
        lastLogSec = elapsedSec
      }
      await new Promise(r => setTimeout(r, pollInterval))
    }
  }

  // ── exit Listen Node ────────────────────────────────────────────────────

  async exitListen(passExit = true) {
    const cmd = passExit ? "ScriptExit(1)" : "ScriptExit(0)"
    await this.sendScript("exit", [cmd])
  }
}

module.exports = { TMClient }
