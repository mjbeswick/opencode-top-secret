import { randomBytes } from "node:crypto"

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\b(?:sk|pk)[_-][A-Za-z0-9_-]{16,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:ghcr|npm|pypi|hf)_[A-Za-z0-9_-]{20,}\b/gi,
  /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp|ftp|sftp|ssh):\/\/[^\s"'<>\]]{3,}/gi,
  /\b[a-z][a-z0-9+.-]*:\/\/([^\s\/@:]+:[^\s\/@:]*)@/gi,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /"?[a-z0-9_-]*(?:password|passwd|pwd|secret|token|api_?key|access_?key|client_?secret)[a-z0-9_-]*"?\s*[=:]\s*["']?([^\s"'`,;(){}\[\]]{6,})["']?(?![\w.(])(?!\s*[=:])/gi,
]

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
const PHONE = /(?<!\d)(?:\+?44\s?(?:\(0\)\s?)?|0)(?:7\d{3}|[12]\d{2})[\s.-]?\d{3}[\s.-]?\d{3,4}(?!\d)/g

function entriesFromEnv(env) {
  return Object.entries(env)
    .filter(([key, value]) => /secret|token|password|api.?key|credential/i.test(key) && typeof value === "string" && value.length >= 6)
    .map(([, value]) => value)
    .sort((a, b) => b.length - a.length)
}

/**
 * Create an in-memory reversible redactor. Original values are never logged or persisted.
 * The mapping is deliberately scoped to one process/plugin instance.
 */
export function createRedactor({ env = process.env, extraValues = [] } = {}) {
  const valueToToken = new Map()
  const tokenToValue = new Map()
  const configuredValues = [...new Set([...entriesFromEnv(env), ...extraValues.filter((v) => typeof v === "string" && v.length >= 6)])]
    .sort((a, b) => b.length - a.length)
  const prefix = `[[OTS_${randomBytes(8).toString("hex").toUpperCase()}_`
  let sequence = 0

  function replaceValue(value, category) {
    if (!value) return value
    let token = valueToToken.get(value)
    if (!token) {
      token = `${prefix}${category}_${++sequence}]]`
      valueToToken.set(value, token)
      tokenToValue.set(token, value)
    }
    return token
  }

  function redact(input) {
    if (typeof input !== "string" || input.length === 0) return input
    let output = input
    // Exact known environment/configured credentials first; no substring matching
    // inside longer identifiers.
    for (const value of configuredValues) {
      output = output.split(value).join(replaceValue(value, "SECRET"))
    }
    for (const pattern of SECRET_PATTERNS) {
      pattern.lastIndex = 0
      output = output.replace(pattern, (match, capture) => {
        if (capture && pattern.source.includes("\\/\\/([^\\s")) {
          const index = match.indexOf(capture)
          return match.slice(0, index) + replaceValue(capture, "SECRET") + match.slice(index + capture.length)
        }
        if (capture && /password|passwd|pwd|secret|token|api_?key|access_?key|client_?secret/i.test(match)) {
          const index = match.lastIndexOf(capture)
          return match.slice(0, index) + replaceValue(capture, "SECRET") + match.slice(index + capture.length)
        }
        return replaceValue(match, "SECRET")
      })
    }
    output = output.replace(EMAIL, (value) => replaceValue(value, "EMAIL"))
    output = output.replace(PHONE, (value) => replaceValue(value, "PHONE"))
    return output
  }

  function restore(input) {
    if (typeof input !== "string" || input.length === 0) return input
    let output = input
    for (const [token, value] of tokenToValue) output = output.split(token).join(value)
    return output
  }

  function containsToken(input) {
    if (typeof input !== "string") return false
    for (const token of tokenToValue.keys()) if (input.includes(token)) return true
    return false
  }

  return { redact, restore, containsToken }
}

export function redactDeep(value, redactor, depth = 0) {
  if (depth > 20 || value == null) return value
  if (typeof value === "string") return redactor.redact(value)
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, redactor, depth + 1))
  if (typeof value === "object") {
    const output = {}
    for (const [key, item] of Object.entries(value)) {
      output[redactor.redact(key)] = redactDeep(item, redactor, depth + 1)
    }
    return output
  }
  return value
}

export function restoreDeep(value, redactor, depth = 0) {
  if (depth > 20 || value == null) return value
  if (typeof value === "string") return redactor.restore(value)
  if (Array.isArray(value)) return value.map((item) => restoreDeep(item, redactor, depth + 1))
  if (typeof value === "object") {
    const output = {}
    for (const [key, item] of Object.entries(value)) {
      output[redactor.restore(key)] = restoreDeep(item, redactor, depth + 1)
    }
    return output
  }
  return value
}
