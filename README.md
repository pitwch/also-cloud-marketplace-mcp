# ALSO Cloud Marketplace MCP

TypeScript [Model Context Protocol](https://modelcontextprotocol.io) server for the **ALSO Cloud Marketplace Simple API**.

Uses the same auth flow and marketplace URLs as [`go-also-cloud-wrapper`](https://github.com/pitwch/go-also-cloud-wrapper).

## Tools

Based on [MarketplaceSimpleAPI 1.0.0](https://app.swaggerhub.com/apis-docs/MarketplaceSimpleAPI/MarketplaceSimpleAPI/1.0.0) (~73 POST endpoints).

### Session / discovery
| Tool | Description |
|------|-------------|
| `list_marketplaces` | Static country keys → base URLs |
| `list_api_endpoints` | Full API catalog (+ optional tag / read-only filter) |
| `validate_session` | Login + `PingPong` |
| `clear_session` | Drop cached session token |
| `api_request` | Escape hatch for any endpoint (writes/destructive) |

### Accounts (read)
| Tool | API |
|------|-----|
| `get_company` / `get_companies` / `get_company_by_vat_id` | Company |
| `get_reseller` / `get_resellers` / `get_reseller_by_vat_id` | Reseller |
| `get_department` / `get_departments` | Departments |
| `get_user` / `get_users` | User |

### Subscriptions / catalog (read)
| Tool | API |
|------|-----|
| `get_subscription` / `get_subscriptions` / `get_subscription_with_addons` | Subscription |
| `get_possible_services_for_parent` | Subscription management |
| `get_owned_marketplaces` / `list_marketplace_services` / `get_available_services_for_marketplace` / `get_service_information` | Marketplaces |

### Billing / reports (read)
| Tool | API |
|------|-----|
| `get_reports` / `execute_report` | Reports |
| `get_latest_invoices` / `get_latest_invoices_for_period` / `get_preview_invoices` / `get_invoice_aggregation_report` | Invoices |

### Other reads
| Tool | API |
|------|-----|
| `get_credit_limit` / `get_security_roles` / `get_special_deal` | Credit / Security / Special Deal |

**Writes** (`Create*`, `Update*`, `TerminateAccount`, upgrades, …) are intentionally only via `api_request` so the model does not call them by accident.

## Requirements

- Node.js **20+**
- ALSO Cloud API user + password

## Setup

```bash
git clone https://github.com/pitwch/also-cloud-marketplace-mcp.git
cd also-cloud-marketplace-mcp
npm install
cp .env.example .env   # optional for local runs; Cursor uses env in mcp.json
```

## Cursor / Claude Desktop

Add to your MCP config (Cursor: MCP settings):

```json
{
  "mcpServers": {
    "also-cloud": {
      "command": "npx",
      "args": ["tsx", "C:/DEV/also-cloud-marketplace-mcp/src/index.ts"],
      "env": {
        "ALSO_CLOUD_MARKETPLACE": "Switzerland",
        "ALSO_CLOUDUSER": "you@example.com",
        "ALSO_CLOUDPW": "your-password"
      }
    }
  }
}
```

Or after `npm run build`:

```json
{
  "mcpServers": {
    "also-cloud": {
      "command": "node",
      "args": ["C:/DEV/also-cloud-marketplace-mcp/dist/index.js"],
      "env": {
        "ALSO_CLOUD_MARKETPLACE": "https://marketplace.also.ch",
        "ALSO_CLOUDUSER": "you@example.com",
        "ALSO_CLOUDPW": "your-password"
      }
    }
  }
}
```

`ALSO_CLOUD_MARKETPLACE` accepts a full URL or a country key (`Switzerland`, `Germany`, `Debug`, …).

## Development

```bash
npm run dev          # stdio server via tsx
npm run typecheck
npm run build
npm start
```

Do not write to stdout except for MCP JSON-RPC — use `console.error` for logs.

## Related

- Go library: https://github.com/pitwch/go-also-cloud-wrapper
- Swagger: https://app.swaggerhub.com/apis/MarketplaceSimpleAPI/MarketplaceSimpleAPI/1.0.0

## License

MIT © Pedrett IT+Web AG
