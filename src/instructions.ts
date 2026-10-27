/** Guidance returned to MCP hosts so models pick efficient tools. */
export const SERVER_INSTRUCTIONS = `
ALSO Cloud Marketplace MCP — REQUIRED tool choice rules:

NEVER:
- Do NOT call get_reports / execute_report / get_owned_marketplaces to find companies or list subscriptions.
- Do NOT read local source files (also-client.ts, api-catalog.ts, …) to discover tools.
- Do NOT call validate_session before every request (login is automatic).
- Do NOT call get_subscriptions without needing it — prefer list_company_subscriptions / list_azure_subscriptions.
- Do NOT create/update subscriptions (create_subscription, etc.) unless the user explicitly asks to ORDER/BOOK something.

ALWAYS:
1) Company by name → find_companies OR list_company_subscriptions(companyName=…)
2) Subscriptions of one company → list_company_subscriptions (compact by design)
3) All Azure Plan / RI / Savings Plan across customers → list_azure_subscriptions
4) get_subscriptions / get_subscription return COMPACT summaries by default. Only pass fullDetail=true if the user explicitly needs raw Fields.

Writes require an explicit user confirmation to order/book.
`.trim();
