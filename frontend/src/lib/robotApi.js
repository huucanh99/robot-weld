// Helpers dùng chung cho Home.vue và Recipe.vue — gọi các API monitoring/move của robot.
// Tách riêng để 2 trang không lặp lại logic fetch giống nhau khi poll pose/joints/status.

export function apiBase() {
  return `http://${window.location.hostname}:3000`
}

export async function fetchRobotStatus(base) {
  const r = await fetch(`${base}/api/robot/status`)
  return r.json()
}

export async function fetchCurrentPose(base) {
  const r = await fetch(`${base}/api/robot/current-pose`)
  return r.json()
}

export async function fetchCurrentJoints(base) {
  const r = await fetch(`${base}/api/robot/current-joints`)
  return r.json()
}

export async function moveRobot(base, pose, speed, label) {
  const r = await fetch(`${base}/api/robot/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pose, speed, label }),
  })
  return r.json()
}

// "ok"   = robot connected + TMRTS monitor streaming thật
// "warn" = robot connected nhưng monitor chưa có dữ liệu (mới connect, hoặc lỗi)
// "err"  = robot chưa connect
export function poseStatusClass(connected, monitorConnected) {
  if (!connected)         return 'err'
  if (!monitorConnected)  return 'warn'
  return 'ok'
}

export const BLANK_POSE   = { x: '—', y: '—', z: '—', rx: '—', ry: '—', rz: '—' }
export const BLANK_JOINTS = { j1: '—', j2: '—', j3: '—', j4: '—', j5: '—', j6: '—' }
