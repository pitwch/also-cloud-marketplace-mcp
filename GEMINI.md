# ALSO Cloud Marketplace MCP — Gemini CLI

## Tool selection (mandatory)

| Question | Tool |
|---|---|
| Company by name | `find_companies` |
| Subscriptions of one company | `list_company_subscriptions` |
| All Azure Plan / RI / Savings Plans | `list_azure_subscriptions` |
| One known subscription accountId | `get_subscription` (compact unless `fullDetail=true`) |

**Do not** use `get_reports`, `execute_report`, `get_owned_marketplaces`, or local source files to discover companies or subscriptions.

**Do not** call `validate_session` before every request — login is automatic.

**Do not** call `create_subscription` / write tools unless the user explicitly asks to **order** or **book** a product (e.g. Reserved Instance). Analysis and recommendations only until then.

## Compact responses

`get_subscriptions` / `get_subscription` return short summaries by default. Pass `fullDetail=true` only when raw Fields are required. Secrets such as `InitialPassword` are redacted.

## After updating this MCP

Restart Gemini CLI (or reload the MCP server) so it picks up new tools and instructions. Stale sessions keep calling old bloated tools.
