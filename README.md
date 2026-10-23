# ALSO Cloud Marketplace MCP

TypeScript [Model Context Protocol](https://modelcontextprotocol.io) server for the **ALSO Cloud Marketplace Simple API**.

Uses the same auth flow and marketplace URLs as [`go-also-cloud-wrapper`](https://github.com/pitwch/go-also-cloud-wrapper).

## Tools

| Tool | Description |
|------|-------------|
| `list_marketplaces` | Known country keys → base URLs |
| `validate_session` | Login + `PingPong` |
| `get_company` | `GetCompany` with `parentAccountId` |
| `api_request` | Generic GET/POST/PUT/PATCH/DELETE |
| `clear_session` | Drop cached session token |

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
