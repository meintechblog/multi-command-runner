# Security Notes

## High-Risk Capability

`multi-command-runner` executes arbitrary shell commands (`bash -lc`) configured in the UI.
Treat this as a privileged administrative tool.

## Minimum Recommendations

- Run only in trusted/private networks
- Do not expose directly to the internet
- Place behind authentication/reverse proxy if remote access is needed
- Restrict host/container permissions
- Keep backups of `data/` and secret material

## Built-in HTTP Basic Auth

The application supports built-in HTTP Basic auth for UI and API endpoints.

- Enable by setting both:
  - `MULTI_COMMAND_RUNNER_AUTH_USER`
  - `MULTI_COMMAND_RUNNER_AUTH_PASSWORD`
- If only one of the two values is set, auth remains disabled (warning logged).
- The install script bootstraps these values by default unless `ENABLE_BASIC_AUTH=0` is used.

## Notification Credential Storage

Notification service credentials are encrypted at rest in the SQLite state.

- Storage format: `enc:v1:<token>` (Fernet)
- Key source priority:
  1. `MULTI_COMMAND_RUNNER_SECRET_KEY` environment variable
  2. `data/.credentials.key` (auto-generated fallback)

Without access to the encryption key, encrypted credentials cannot be decrypted.

## API Exposure Model

- `GET /api/state` returns masked credential placeholders (`__SECRET_SET__`)
- Actual secrets are decrypted server-side only when needed for send/test operations
- Optional HTTP Basic auth protects all non-static routes when configured

## Operational Caveats

- If you rotate/remove keys without re-encrypt migration, existing encrypted credentials become unusable
- Access to both the app runtime and key source still grants effective credential access
- No built-in user auth/role model is implemented in this project

## Suggested Hardening Roadmap

- Add per-user access control and role separation (current auth is single shared credential)
- Add CSRF/session protection if browser-exposed outside localhost
- Add audit logging with actor/source metadata
- Add network policy/firewall restrictions
