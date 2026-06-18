const API_KEY = process.env.INTEGRATION_API_KEY

module.exports = function apiKeyMiddleware(req, res, next) {
  if (!API_KEY) return next()
  const key = req.headers["x-api-key"]
  if (key !== API_KEY) return res.status(401).json({ error: "Unauthorized" })
  next()
}
