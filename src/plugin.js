import { createRedactor, restoreDeep } from "./redactor.js"

const PLUGIN_ID = "opencode-top-secret"
const NOTICE = "[OpenCode Top Secret] Sensitive values may appear as opaque placeholders. Preserve placeholders exactly; do not infer or reconstruct their values."

function addTextSlots(event, slots) {
  for (const message of event?.messages ?? []) {
    const parts = message?.parts ?? message?.content
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part && (part.type === "text" || part.type === "reasoning") && typeof part.text === "string") {
          slots.push({ get: () => part.text, set: (value) => { part.text = value } })
        } else if (part && typeof part.text === "string" && !["file", "media"].includes(part.type)) {
          slots.push({ get: () => part.text, set: (value) => { part.text = value } })
        } else if (part?.type === "tool" && part.state) {
          for (const key of ["output", "error", "raw"]) {
            if (typeof part.state[key] === "string") slots.push({ get: () => part.state[key], set: (value) => { part.state[key] = value } })
          }
          if (part.state.input && typeof part.state.input === "object") {
            slots.push({
              get: () => JSON.stringify(part.state.input),
              set: (value) => { part.state.input = JSON.parse(value) },
            })
          }
        } else if (part?.type === "tool-call" && part.input && typeof part.input === "object") {
          slots.push({ get: () => JSON.stringify(part.input), set: (value) => { part.input = JSON.parse(value) } })
        } else if (part?.type === "tool-result" && typeof part.result?.value === "string") {
          slots.push({ get: () => part.result.value, set: (value) => { part.result.value = value } })
        }
      }
    } else if (typeof message?.content === "string") {
      slots.push({ get: () => message.content, set: (value) => { message.content = value } })
    } else if (typeof message?.text === "string") {
      slots.push({ get: () => message.text, set: (value) => { message.text = value } })
    }
  }
}

function addSystemSlots(event, slots) {
  const system = event?.system
  if (!Array.isArray(system)) return
  for (let index = 0; index < system.length; index++) {
    const item = system[index]
    if (typeof item === "string") slots.push({ get: () => system[index], set: (value) => { system[index] = value } })
    else if (item && typeof item.text === "string") slots.push({ get: () => item.text, set: (value) => { item.text = value } })
  }
}

function maskContext(event, redactor) {
  const slots = []
  addSystemSlots(event, slots)
  addTextSlots(event, slots)
  // Text slots share one mapping. Separating with a random token is unnecessary here:
  // redaction runs independently per slot and the redactor's map is shared.
  for (const slot of slots) slot.set(redactor.redact(slot.get()))
  if (Array.isArray(event?.system) && !event.system.some((item) => typeof item === "string" ? item.includes(PLUGIN_ID) : item?.text?.includes(PLUGIN_ID))) {
    if (event.system.some((item) => typeof item === "string")) event.system.push(NOTICE)
    else event.system.push({ type: "text", text: NOTICE })
  }
}

async function registerHook(ctx, name, callback) {
  try {
    await ctx.session.hook(name, callback)
    return true
  } catch {
    return false
  }
}

async function legacyServer(ctx) {
  if (process.env.OPENCODE_TOP_SECRET_OFF === "1") return {}
  const redactor = createRedactor()
  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      try {
        const slots = []
        addTextSlots({ messages: output.messages }, slots)
        for (const slot of slots) slot.set(redactor.redact(slot.get()))
      } catch (error) {
        throw new Error(`[${PLUGIN_ID}] Message redaction failed; request blocked.`, { cause: error })
      }
    },
    "experimental.chat.system.transform": async (_input, output) => {
      try {
        const event = { system: output.system }
        maskContext(event, redactor)
        output.system = event.system
      } catch (error) {
        throw new Error(`[${PLUGIN_ID}] System redaction failed; request blocked.`, { cause: error })
      }
    },
    "tool.execute.before": async (_input, output) => {
      output.args = restoreDeep(output.args, redactor)
    },
    "experimental.text.complete": async (_input, output) => {
      if (typeof output.text === "string") output.text = redactor.restore(output.text)
    },
    event: async ({ event }) => {
      // Legacy API session titles are written after generation; restore before UI rewrite.
      if (event?.type !== "session.updated") return
      const info = event.properties?.info
      if (typeof info?.title !== "string" || !redactor.containsToken(info.title)) return
      const title = redactor.restore(info.title)
      try {
        await ctx.client.session.update({ path: { id: info.id }, body: { title } })
      } catch {
        // Never log the title, which could contain restored personal information.
        await ctx.client.app.log({ body: { service: PLUGIN_ID, level: "warn", message: "Could not restore a session title." } }).catch(() => {})
      }
    },
  }
}

async function setupV2(v2) {
  if (process.env.OPENCODE_TOP_SECRET_OFF === "1") return () => {}
  const redactor = createRedactor()
  const mask = (event) => {
    try {
      maskContext(event, redactor)
    } catch (error) {
      throw new Error(`[${PLUGIN_ID}] Context redaction failed; request blocked.`, { cause: error })
    }
  }
  if (!await registerHook(v2, "context", mask)) {
    throw new Error(`[${PLUGIN_ID}] Required context hook is unavailable; plugin setup aborted.`)
  }
  for (const name of ["compaction", "generate", "title"]) await registerHook(v2, name, mask)
  try {
    await v2.tool.hook("execute.before", async (event) => {
      if (!event?.input) return
      const restored = restoreDeep(event.input, redactor)
      try { event.input = restored } catch { /* immutable payload: placeholder remains safer than plaintext exposure */ }
    })
  } catch { /* Hook not available in this OpenCode version. */ }
  try {
    await v2.session.hook("http.response", async (event) => {
      const response = event?.response
      if (!response?.body) return
      const contentType = response.headers?.get?.("content-type") ?? ""
      if (!/application\/(?:[^;]+\+)?json/i.test(contentType)) return
      const text = await response.clone().text()
      if (!redactor.containsToken(text)) return
      let parsed
      try { parsed = JSON.parse(text) } catch { return }
      const restored = restoreDeep(parsed, redactor)
      const headers = new Headers(response.headers)
      headers.delete("content-length")
      headers.delete("content-encoding")
      event.response = new Response(JSON.stringify(restored), { status: response.status, statusText: response.statusText, headers })
    })
  } catch { /* No safe response hook: placeholders remain unreplaced. */ }
  return () => {}
}

// Keep both plugin APIs in one package: `server` is used by the legacy plugin
// loader; `setup` is the V2 entry point. Do not treat this as proof that every
// request/response transport is covered.
export default Object.assign(legacyServer, {
  id: PLUGIN_ID,
  server: legacyServer,
  setup: setupV2,
})
