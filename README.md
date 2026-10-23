# ALSO Cloud Marketplace MCP

MCP-Server für die **ALSO Cloud Marketplace Simple API** — damit KI-Assistenten (Cursor, Claude, Gemini CLI, OpenAI Codex, …) direkt auf Companies, Subscriptions, Users, Invoices usw. zugreifen können.

| | |
|---|---|
| **Protokoll** | [Model Context Protocol](https://modelcontextprotocol.io) (stdio) |
| **API** | [MarketplaceSimpleAPI 1.0.0](https://app.swaggerhub.com/apis-docs/MarketplaceSimpleAPI/MarketplaceSimpleAPI/1.0.0) |
| **Stack** | TypeScript / Node.js 20+ |
| **SDK-Library** | [go-also-cloud-wrapper](https://github.com/pitwch/go-also-cloud-wrapper) (gleiche Auth & Marketplaces) |

---

## Schnellstart

```bash
git clone https://github.com/pitwch/also-cloud-marketplace-mcp.git
cd also-cloud-marketplace-mcp
npm install
npm run build
```

Benötigte Umgebungsvariablen:

| Variable | Beispiel | Pflicht |
|----------|----------|---------|
| `ALSO_CLOUD_MARKETPLACE` | `Switzerland` oder `https://marketplace.also.ch` | ja |
| `ALSO_CLOUDUSER` | `you@example.com` | ja |
| `ALSO_CLOUDPW` | `••••••••` | ja |
| `ALSO_CLOUD_TIMEOUT_MS` | `30000` | nein |
| `ALSO_CLOUD_API_PREFIX` | `/SimpleAPI/.../rest` | nein |

`ALSO_CLOUD_MARKETPLACE` akzeptiert eine **volle URL** oder einen **Country-Key**:  
`Switzerland`, `Germany`, `Austria`, `Debug`, …

---

## Installation in Clients

Überall gilt: Server lokal starten (stdio), Credentials als `env` setzen.  
Pfad unten durch deinen Clone ersetzen, z. B. `C:/DEV/also-cloud-marketplace-mcp` oder `/home/you/also-cloud-marketplace-mcp`.

### Empfohlene Variante (gebaut)

```text
command: node
args:    [<REPO>/dist/index.js]
```

### Alternative (ohne Build, via tsx)

```text
command: npx
args:    [tsx, <REPO>/src/index.ts]
```

Voraussetzung: zuvor `npm install` im Repo.

---

### Cursor

1. **Settings → MCP → Add new MCP server** (oder `mcp.json` bearbeiten).
2. Eintrag hinzufügen:

```json
{
  "mcpServers": {
    "also-cloud": {
      "command": "node",
      "args": ["C:/DEV/also-cloud-marketplace-mcp/dist/index.js"],
      "env": {
        "ALSO_CLOUD_MARKETPLACE": "Switzerland",
        "ALSO_CLOUDUSER": "you@example.com",
        "ALSO_CLOUDPW": "your-password"
      }
    }
  }
}
```

3. Server aktivieren / Cursor neu laden.
4. Im Chat Tools von `also-cloud` nutzen, z. B. *„Liste Companies unter Parent 12345“*.

---

### Claude Desktop

1. Config öffnen: **Settings → Developer → Edit Config**  
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`  
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
2. Gleichen `mcpServers`-Block wie bei Cursor einfügen.
3. Claude Desktop **vollständig neu starten**.
4. Im Chat das Hammer-/Tools-Icon prüfen — `also-cloud` sollte erscheinen.

---

### Claude Code (CLI)

```bash
claude mcp add also-cloud --env ALSO_CLOUD_MARKETPLACE=Switzerland --env ALSO_CLOUDUSER=you@example.com --env ALSO_CLOUDPW=secret -- node /path/to/also-cloud-marketplace-mcp/dist/index.js
```

Prüfen:

```bash
claude mcp list
```

---

### Gemini CLI

Config in `~/.gemini/settings.json` (oder projektbezogen `.gemini/settings.json`):

```json
{
  "mcpServers": {
    "also-cloud": {
      "command": "node",
      "args": ["/path/to/also-cloud-marketplace-mcp/dist/index.js"],
      "env": {
        "ALSO_CLOUD_MARKETPLACE": "Switzerland",
        "ALSO_CLOUDUSER": "you@example.com",
        "ALSO_CLOUDPW": "your-password"
      }
    }
  }
}
```

Oder per CLI:

```bash
gemini mcp add also-cloud --env ALSO_CLOUD_MARKETPLACE=Switzerland --env ALSO_CLOUDUSER=you@example.com --env ALSO_CLOUDPW=secret -- node /path/to/also-cloud-marketplace-mcp/dist/index.js
```

Docs: [MCP servers with Gemini CLI](https://geminicli.com/docs/tools/mcp-server/)

---

### OpenAI — Codex CLI / ChatGPT Desktop / IDE

Codex nutzt **TOML** (`~/.codex/config.toml`), geteilt mit ChatGPT Desktop & Codex-IDE:

```toml
[mcp_servers.also-cloud]
command = "node"
args = ["/path/to/also-cloud-marketplace-mcp/dist/index.js"]

[mcp_servers.also-cloud.env]
ALSO_CLOUD_MARKETPLACE = "Switzerland"
ALSO_CLOUDUSER = "you@example.com"
ALSO_CLOUDPW = "your-password"
```

Oder:

```bash
codex mcp add also-cloud \
  --env ALSO_CLOUD_MARKETPLACE=Switzerland \
  --env ALSO_CLOUDUSER=you@example.com \
  --env ALSO_CLOUDPW=secret \
  -- node /path/to/also-cloud-marketplace-mcp/dist/index.js

codex mcp list
```

In der TUI: `/mcp` zeigt verbundene Server.

**Hinweis ChatGPT Web:** Custom MCP dort braucht i. d. R. einen **öffentlichen HTTPS-Endpoint** (Remote/Tunnel), kein lokales stdio. Für lokalen Betrieb Codex CLI / Desktop verwenden.

Docs: [OpenAI MCP / Codex](https://learn.chatgpt.com/docs/extend/mcp)

---

### VS Code (GitHub Copilot / MCP)

Je nach Extension analog Cursor: MCP-Server mit `command`/`args`/`env` eintragen.  
Pfad auf `dist/index.js` zeigen und Credentials setzen.

---

## Verwendung (Beispiele)

Nach der Anbindung kannst du natürlichsprachlich fragen:

- *„Welche Marketplaces gibt es?“* → `list_marketplaces`
- *„Zeig Companies unter Parent 523525“* → `get_companies`
- *„Hole Subscriptions für Account …“* → `get_subscriptions`
- *„Latest Invoices für März 2026“* → `get_latest_invoices_for_period`
- *„Lege einen User unter Company X an“* → `create_user` (Write)

Discovery aller API-Endpoints:

- Tool `list_api_endpoints` (optional Filter `tag`, `onlyReadable`)

---

## Tools (Überblick)

~58 Tools. Vollständige Liste inkl. Risiko-Flags: Tool **`list_api_endpoints`**.

### Session & Meta
| Tool | Zweck |
|------|--------|
| `list_marketplaces` | Country-Keys → Base-URLs (ohne Login) |
| `list_api_endpoints` | Katalog der Simple-API |
| `validate_session` / `clear_session` | Session prüfen / verwerfen |
| `api_request` | Escape Hatch (u. a. destruktive Endpoints) |

### Lesen
| Bereich | Tools |
|---------|--------|
| Company / Reseller / Dept / User | `get_*`, `get_*_by_vat_id`, Listen |
| Subscriptions | `get_subscription(s)`, `get_subscription_with_addons`, `get_possible_services_for_parent` |
| Catalog | `get_owned_marketplaces`, `list_marketplace_services`, `get_available_services_for_marketplace`, `get_service_information` |
| Billing | `get_reports`, `execute_report`, `get_latest_invoices*`, `get_preview_invoices`, `get_invoice_aggregation_report` |
| Sonst | `get_credit_limit`, `get_security_roles`, `get_special_deal` |

### Schreiben (gezielt freigeschaltet)
| Bereich | Tools |
|---------|--------|
| Accounts | `create_*` / `update_*` für Company, Reseller, Department, User |
| Subscriptions | `get_fields_for_service`, `validate_subscription_fields`, `create_subscription`, `update_subscription` |
| Actions | `get_account_custom_actions`, `execute_account_custom_action`, `retry_last_failed_provisioning` |
| Upgrade / Renew | `get_possible_services_for_upgrade`, `get_subscription_fields_for_*`, `execute_subscription_upgrade`, `configure_subscription_renew`, `reset_default_renew_values` |
| Credit / Deal | `set_credit_limit`, `list_credit_check_orders_for_approval`, `approve_*` / `decline_credit_check_order`, `set_special_deal` |

### Nur über `api_request` (destruktiv / selten)
`TerminateAccount`, `DeleteMarketplace*`, `DeleteSpecialDeal`, Marketplace-Create/Delete, …  
→ bewusst **kein** eigenes Tool, damit die KI sie nicht versehentlich aufruft.

---

## Entwicklung

```bash
npm run dev        # stdio via tsx
npm run typecheck
npm run build
npm start          # node dist/index.js
```

**Wichtig:** Auf stdout nur MCP-JSON-RPC schreiben — Logs nur mit `console.error`.

---

## Sicherheit

- Credentials nie committen; nur in Client-`env` oder lokaler `.env` (nicht für stdio-Hosts nötig, wenn `env` in der MCP-Config steht).
- Write-Tools ändern Produktivdaten — Clients mit Tool-Bestätigung nutzen (Cursor/Claude/Gemini Prompt).
- Destruktive Operationen bewusst hinter `api_request` belassen.

---

## Links

- Repo: https://github.com/pitwch/also-cloud-marketplace-mcp  
- Go-Wrapper: https://github.com/pitwch/go-also-cloud-wrapper  
- Swagger: https://app.swaggerhub.com/apis-docs/MarketplaceSimpleAPI/MarketplaceSimpleAPI/1.0.0  

## License

MIT © Pedrett IT+Web AG
