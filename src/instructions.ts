/** Guidance returned to MCP hosts so models pick efficient tools. */
export const SERVER_INSTRUCTIONS = `
ALSO Cloud Marketplace Simple API helper.

Preferred workflows (do these — do NOT invent detours via get_reports, execute_report, get_owned_marketplaces, or reading local source files):

1) "Which subscriptions does company X have?"
   → list_company_subscriptions with companyName (and parentAccountId / ALSO_CLOUD_PARENT_ACCOUNT_ID) OR accountId.
   Returns a compact list. Do not call raw get_subscriptions unless you need full Field dumps.

2) "Find company by name"
   → find_companies with name + parentAccountId.

3) Known accountId
   → get_company / get_subscriptions (set compact=true) / get_users as needed.

4) Session
   → Login is automatic. Only call validate_session if you suspect auth failure.

Writes: use create_* / update_* tools. Destructive ops (TerminateAccount, Delete*) only via api_request when explicitly requested.
`.trim();
