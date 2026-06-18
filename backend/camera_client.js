/**
 * TM EIH Camera gRPC Client
 * Protocol: gRPC, Port 15567
 */

const grpc       = require("@grpc/grpc-js")
const protoLoader = require("@grpc/proto-loader")
const path       = require("path")

const CAMERA_PORT = 15567
const PROTO_DIR   = path.join(__dirname, "proto")

function loadStub(ip) {
  const pkgDef = protoLoader.loadSync(
    path.join(PROTO_DIR, "EIHCameraAPI.proto"),
    {
      keepCase:    true,
      longs:       String,
      enums:       String,
      defaults:    true,
      oneofs:      true,
      includeDirs: [PROTO_DIR],
    }
  )
  const pkg  = grpc.loadPackageDefinition(pkgDef)
  const stub = new pkg.TmEIHCamera.EIHCameraApi(
    `${ip}:${CAMERA_PORT}`,
    grpc.credentials.createInsecure(),
    { "grpc.max_receive_message_length": 20 * 1024 * 1024 }
  )
  return stub
}

function call(stub, method, req = {}) {
  return new Promise((resolve, reject) => {
    stub[method](req, (err, res) => {
      if (err) reject(err)
      else resolve(res)
    })
  })
}

class CameraClient {
  constructor(ip = "169.254.243.189") {
    this.ip   = ip
    this.stub = null
  }

  connect() {
    this.stub = loadStub(this.ip)
  }

  disconnect() {
    if (this.stub) {
      grpc.closeClient(this.stub)
      this.stub = null
    }
  }

  async isConnected() {
    if (!this.stub) this.connect()
    const res = await call(this.stub, "isCameraConnected")
    return res
  }

  async capture() {
    if (!this.stub) this.connect()
    const res = await call(this.stub, "getImageData")
    const b64 = Buffer.from(res.EncodeString).toString("base64")
    return `data:image/png;base64,${b64}`
  }
}

module.exports = { CameraClient }
