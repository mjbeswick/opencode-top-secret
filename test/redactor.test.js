import test from "node:test"
import assert from "node:assert/strict"
import { createRedactor, redactDeep, restoreDeep } from "../src/redactor.js"

test("redacts common credentials and restores their values locally", () => {
  const redactor = createRedactor({ env: {}, extraValues: [] })
  const secret = `sk-${"AbCdEf0123456789".repeat(2)}`
  const masked = redactor.redact(`Authorization: Bearer ${"a".repeat(24)} key=${secret}`)
  assert.equal(masked.includes(secret), false)
  assert.equal(masked.includes("Bearer "), false)
  assert.equal(redactor.restore(masked), `Authorization: Bearer ${"a".repeat(24)} key=${secret}`)
})

test("does not redact labelled business identifiers", () => {
  const redactor = createRedactor({ env: {} })
  const source = "Member ID: ABCD123456 location number=1234 terminal: 987654"
  assert.equal(redactor.redact(source), source)
})

test("uses configured environment credential values even without recognizable names", () => {
  const redactor = createRedactor({ env: { SERVICE_CREDENTIAL: "custom-secret-value" } })
  const masked = redactor.redact("credential=custom-secret-value")
  assert.equal(masked.includes("custom-secret-value"), false)
  assert.equal(redactor.restore(masked), "credential=custom-secret-value")
})

test("deep redacts/restores JSON-compatible structures", () => {
  const redactor = createRedactor({ env: {} })
  const source = { text: "Email alice@example.com", nested: ["token: abcdefghijklmnop"] }
  const masked = redactDeep(source, redactor)
  assert.equal(JSON.stringify(masked).includes("alice@example.com"), false)
  assert.deepEqual(restoreDeep(masked, redactor), source)
})

test("does not rewrite unrelated values", () => {
  const redactor = createRedactor({ env: {} })
  const source = "This is ordinary Mercury checkout documentation."
  assert.equal(redactor.redact(source), source)
})
