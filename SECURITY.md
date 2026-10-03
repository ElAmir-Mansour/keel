# Security policy

## Supported versions

Keel is a young project with a single line of development. Security fixes land on `main` and
are deployed to the live demo and included in the next release. Only the latest release and the
current `main` are supported; please reproduce against one of those before reporting.

| Version | Supported |
|---|---|
| `main` and the latest release (0.3.x) | yes |
| Older releases | no — upgrade |

## Reporting a vulnerability

**Do not open a public issue for a vulnerability.** Use GitHub's private vulnerability
reporting on this repository: open the **Security** tab and click **Report a vulnerability**,
or go directly to https://github.com/ElAmir-Mansour/keel/security/advisories/new. The report is
visible only to the maintainer until a fix is published.

Please include what you found, where (file, route or screen), how to reproduce it, and what you
believe the impact is. A proof of concept helps; sending it through the private form keeps it off
the public record.

You can expect an acknowledgement within a few days. Confirmed issues are fixed on `main`,
noted in `CHANGELOG.md`, and published as a security advisory with credit to the reporter unless
you prefer otherwise.

## Trust model

Knowing what Keel does and does not do makes it easier to judge what is a vulnerability.

**Local-first.** All workspace data (notes, issues, decisions, risks, timelines, settings) lives
in the browser's IndexedDB. There is no account system, no server database and no telemetry.
Whoever can use the browser profile can read the data; Keel does not add encryption at rest on
top of what the operating system and browser provide.

**Assistant and the bring-your-own key.** The user's Anthropic API key is stored in the
browser's `localStorage` and sent with each request in the `x-keel-api-key` header to Keel's one
API route, `src/app/api/ai/route.ts`. That route relays the single turn to Anthropic's API and
streams the reply back. It does not store or log the key or the conversation. Tool calls the
model proposes are executed in the browser only after the user approves each one.

**Server-side key is off by default.** A deployment may provide `ANTHROPIC_API_KEY` for all
visitors, but it is honoured only when `KEEL_ALLOW_SERVER_KEY=true` is also set. The key alone is
ignored, so a public instance cannot spend the operator's credits by accident. An operator who
sets both on a publicly reachable instance has opted into that exposure; it is not a Keel
vulnerability.

**Local folder bridge.** The routes under `src/app/api/local/*` are active only when
`KEEL_LOCAL_DIR` is set, and every one of them refuses requests whose `Host` header is not
`localhost`, `127.0.0.1`, `[::1]` or a `.localhost` name, answering 404. They read Markdown under
`<dir>/vault` and JSON bundles under `<dir>/import` and nothing outside that folder. A hosted
deployment should leave `KEEL_LOCAL_DIR` unset.

**Sync.** Optional and bring-your-own: the user supplies a Supabase project URL and anon key,
which are stored in the browser. `supabase/schema.sql` enables row-level security so each row is
readable and writable only by the user who owns it. Gaps in that schema are in scope.

**GitHub integration.** Optional. The browser calls `api.github.com` directly for the
repositories the user lists, with an optional token the user supplies, kept in `localStorage`.
A fine-grained read-only token is recommended and documented in Settings.

**Semantic search.** Optional. When enabled, the embedding library and model are downloaded from
a public CDN and run in the browser; no text is sent anywhere.

**Markdown rendering.** Notes are rendered with `react-markdown`, which escapes HTML by default.
Script execution through note content, wikilinks or imported files would be a vulnerability.

### In scope

- Cross-site scripting or script execution through notes, imports, timeline text or the assistant.
- Leakage of a user's API key, GitHub token or Supabase credentials to anywhere other than the
  service they belong to.
- Any way for a non-localhost request to reach the local folder bridge, or for the bridge to read
  or write outside `KEEL_LOCAL_DIR`.
- Row-level security gaps in `supabase/schema.sql`.
- Serving the operator's Anthropic key when `KEEL_ALLOW_SERVER_KEY` is not `true`.

### Out of scope

- Security of the user's own Anthropic, Supabase or GitHub accounts.
- Deployments that set `KEEL_ALLOW_SERVER_KEY=true` on a public instance, as warned in the README.
- Access to data by someone who already controls the browser profile or the machine.
- Vulnerabilities in dependencies that are not reachable from Keel; report those upstream, though
  a note here is welcome so the dependency can be updated.
