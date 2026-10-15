# OpenCode Top Secret

OpenCode Top Secret is a local plugin that masks selected credential and personal-data patterns in model context before requests are dispatched.

> **Status and security disclaimer:** This is a best-effort prototype, not an approved security control. It does not guarantee that sensitive data will be kept from a model provider and must not be treated as a security boundary or a substitute for approved data-handling and secret-management policies. Live end-to-end compatibility with a LightLLM deployment has not been confirmed.

## Intended deployment

OpenCode V2 sends model requests through LightLLM’s OpenAI-compatible API. Redaction is performed at OpenCode’s `context` hook before model dispatch; the plugin does not call LightLLM directly.

The intended target is the latest OpenCode V2 release. Older OpenCode versions and other model providers are out of scope. Before relying on an OpenCode update, verify that the hooks used here still work. The LightLLM integration still requires end-to-end testing with the actual endpoint, model, and options in use.

LightLLM documentation: [OpenAI API usage](https://lightllm-en.readthedocs.io/en/latest/tutorial/openai.html) and [function calling](https://lightllm-en.readthedocs.io/en/latest/tutorial/function_calling.html).

## What it redacts

The redactor applies patterns for:

- Some common credentials, including API keys, JWTs, private keys, bearer/basic credentials, credential-bearing URLs, and credential assignments.
- Email addresses and common UK telephone-number formats.
- Values of process environment variables whose names suggest a secret, token, password, API key, or credential, when those values appear in scanned text. It does not read `.env` files.

Placeholders use random opaque tokens. The reversible mapping stays in memory; it is not persisted or logged, and it is lost when OpenCode restarts. Restoring a placeholder reintroduces its original value locally.

## OpenCode V2 hook and response behavior

The plugin requires the V2 `context` hook and aborts setup if it cannot register it. It also attempts to register `compaction`, `generate`, and `title` hooks, plus `tool.execute.before` and `http.response` hooks; these additional hooks are best-effort.

The HTTP response hook restores placeholders only in parseable JSON responses. **SSE responses are not restored.** LightLLM documents SSE streaming; if the OpenCode–LightLLM configuration streams responses, placeholders may remain in the streamed response. Outbound masking and local response restoration are separate behaviors.

The source retains a legacy server implementation, but the current OpenCode V2 runtime uses the V2 `setup` entry point; the legacy implementation is not a fallback for V2.

## Install globally from GitHub

Install the package directly from its Git URL:

```sh
opencode plugin add 'git+https://github.com/mjbeswick/opencode-top-secret.git'
```

OpenCode records the Git package in the global configuration and installs it through Bun. Your existing Git credentials must allow access to the repository. Restart OpenCode after installation and verify that the plugin loads before relying on it.

To check for and install updates:

```sh
opencode plugin check
opencode plugin update 'git+https://github.com/mjbeswick/opencode-top-secret.git'
```

## Disable

Set `OPENCODE_TOP_SECRET_OFF=1` in the environment used to launch OpenCode:

```sh
export OPENCODE_TOP_SECRET_OFF=1
```

Unset the variable or set it to a value other than `1` to enable the plugin.

## Development and tests

Requires Node.js 20 or later; there are no runtime dependencies. From the project root, run:

```sh
npm test
```

Tests use Node’s built-in test runner and cover selected redaction/restoration cases, a basic legacy hook path, and V2 setup failure when the required context hook is unavailable. They are **not** OpenCode integration tests and do not verify traffic to a live LightLLM endpoint, actual provider request payloads, or end-to-end coverage.

## Limitations

- Pattern matching can miss sensitive values and produce false positives.
- Content outside the fields inspected by the hooks may not be redacted. Images, attachments, encoded values, and unlabelled or otherwise unrecognized identifiers may not be protected.
- Optional V2 hooks are best-effort; tool-input and JSON-response restoration are not guaranteed. SSE response restoration is not implemented.
- The in-memory mapping is shared within a plugin instance, not isolated per session; identical values reuse placeholders. Restarting OpenCode loses the mapping.
- Restoring values into tool inputs or local responses means plaintext is present again in those places.

## Before relying on it

1. Agree the data classes and identifier formats with the appropriate security and privacy owners. Use synthetic examples when developing patterns.
2. Test with the latest OpenCode V2 release and the actual LightLLM endpoint/model, verifying outbound redaction and the response format (JSON or SSE). Test tool calls if they are used.
3. Review whether matching credentials from process environment variables is appropriate for the deployment.
4. Obtain independent security review and establish release controls, ownership, and an incident/disable procedure.
