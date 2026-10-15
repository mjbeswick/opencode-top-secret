import test from "node:test"
import assert from "node:assert/strict"
import OpenCodeSecretGuard from "../src/plugin.js"

test("legacy hooks redact model-bound messages and restore local outputs", async () => {
  const plugin = await OpenCodeSecretGuard({
    client: {
      session: { update: async () => {} },
      app: { log: async () => {} },
    },
  })
  const secret = `sk-${"AbCdEf0123456789".repeat(2)}`
  const output = { messages: [{ parts: [{ type: "text", text: `Please use ${secret}` }] }] }
  await plugin["experimental.chat.messages.transform"]({}, output)
  const masked = output.messages[0].parts[0].text
  assert.equal(masked.includes(secret), false)

  const completion = { text: `The credential was ${masked.slice(masked.indexOf("[["))}` }
  await plugin["experimental.text.complete"]({}, completion)
  assert.equal(completion.text.includes(secret), true)

  const tool = { args: { value: masked } }
  await plugin["tool.execute.before"]({}, tool)
  assert.equal(tool.args.value.includes(secret), true)
})

test("V2 setup refuses to activate without the required context hook", async () => {
  await assert.rejects(
    OpenCodeSecretGuard.setup({ session: { hook: async () => { throw new Error("unsupported") } } }),
    /Required context hook is unavailable/,
  )
})
