# OpenCode Top Secret

OpenCode Top Secret is a local plugin that masks selected credential and personal-data patterns in model context before requests are dispatched. It supports the OpenCode V1 and V2 plugin APIs and is provider-neutral: it does not call or depend on a provider-specific API.

> **Status and security disclaimer:** This is a best-effort prototype, not an approved security control. It does not guarantee that sensitive data will be kept from a model provider and must not be treated as a security boundary or a substitute for approved data-handling and secret-management policies. Compatibility with provider-specific integrations and live end-to-end traffic has not been confirmed.

## Intended deployment

The plugin exposes the legacy OpenCode V1 entry point and the OpenCode V2 setup entry point. Each version uses its own context hooks to redact text before normal model dispatch. Since this happens in OpenCode's shared plugin pipeline, the plugin does not select or call a provider API and should work with providers that use that pipeline.

This is not a claim of tested compatibility with every provider: provider-specific plugins, custom transports, or code paths that bypass OpenCode's normal context hooks may behave differently. Verify the hooks after OpenCode updates and test with the actual provider, model, and options before relying on the plugin.

## What it redacts

The redactor applies patterns for:

- Some common credentials, including API keys, JWTs, private keys, bearer/basic credentials, credential-bearing URLs, and credential assignments.
- Email addresses and common UK telephone-number formats.
- Values of process environment variables whose names suggest a secret, token, password, API key, or credential, when those values appear in scanned text. It does not read `.env` files.

Placeholders use random opaque tokens. The reversible mapping stays in memory; it is not persisted or logged, and it is lost when OpenCode restarts. Restoring a placeholder reintroduces its original value locally.

## OpenCode version-specific hook and response behavior

For OpenCode V2, the plugin requires the `context` hook and aborts setup if it cannot register it. It also attempts to register `compaction`, `generate`, and `title` hooks, plus `tool.execute.before` and `http.response` hooks; these additional hooks are best-effort. OpenCode V1 uses the legacy `server` plugin hooks instead.

The HTTP response hook restores placeholders only in parseable JSON responses. **SSE responses are not restored.** If a provider configuration streams responses, placeholders may remain in the streamed response. Outbound masking and local response restoration are separate behaviors.

The plugin exposes both entry points. Each runtime uses its matching API (`server` for V1 and `setup` for V2); the legacy implementation is not a fallback if V2 setup fails.

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

Tests use Node’s built-in test runner and cover selected redaction/restoration cases, V1 and V2 hook paths, provider-neutral context handling, and V2 setup failure when the required context hook is unavailable. They are **not** OpenCode integration tests and do not verify traffic to live providers, actual provider request payloads, or end-to-end coverage.

## Limitations

- Pattern matching can miss sensitive values and produce false positives.
- Content outside the fields inspected by the hooks may not be redacted. Images, attachments, encoded values, and unlabelled or otherwise unrecognized identifiers may not be protected.
- Optional V2 hooks are best-effort; tool-input and JSON-response restoration are not guaranteed. SSE response restoration is not implemented. V1 and V2 use distinct plugin APIs, so compatibility should be verified against the target OpenCode release. Provider-specific integrations and transports that bypass the shared context pipeline are not covered by the provider-neutral design.
- The in-memory mapping is shared within a plugin instance, not isolated per session; identical values reuse placeholders. Restarting OpenCode loses the mapping.
- Restoring values into tool inputs or local responses means plaintext is present again in those places.

## Before relying on it

1. Agree the data classes and identifier formats with the appropriate security and privacy owners. Use synthetic examples when developing patterns.
2. Test with the target OpenCode V1 and V2 releases and the actual provider/model configuration, verifying outbound redaction and the response format (JSON or SSE). Test tool calls if they are used.
3. Review whether matching credentials from process environment variables is appropriate for the deployment.
4. Obtain independent security review and establish release controls, ownership, and an incident/disable procedure.
