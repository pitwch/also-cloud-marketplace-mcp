/** Compact views so models are not flooded with Fields / PriceableItems. */

const INTERESTING_FIELD_NAMES = new Set(
  [
    'TenantId',
    'TenantID',
    'Domain',
    'AzureSubscriptionId',
    'SubscriptionId',
    'SubscriptionName',
    'PlanName',
    'Name',
    'ReservationName',
    'SKU',
    'Sku',
    'Quantity',
    'Region',
    'Term',
    'StartDate',
    'EndDate',
    'BillingCycle',
    'OfferId',
    'ProductId',
    'CustomerTenantId',
  ].map((s) => s.toLowerCase()),
);

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function fieldMap(raw: Record<string, unknown>): Record<string, unknown> {
  const fields = raw.Fields;
  if (!Array.isArray(fields)) return {};
  const out: Record<string, unknown> = {};
  for (const item of fields) {
    const f = asRecord(item);
    if (!f || f.Name == null) continue;
    const name = String(f.Name);
    const value = f.Value;
    if (value === undefined || value === null || value === '') continue;
    if (INTERESTING_FIELD_NAMES.has(name.toLowerCase())) {
      out[name] = value;
    }
  }
  return out;
}

export function summarizeCompany(raw: unknown) {
  const c = asRecord(raw);
  if (!c) return raw;
  return {
    accountId: c.AccountId,
    parentAccountId: c.ParentAccountId,
    accountState: c.AccountState,
    companyName: c.CompanyName,
    customerId: c.CustomerId,
    contractId: c.ContractId,
    domain: c.Domain,
    email: c.Email,
    city: c.City,
    country: c.Country,
    currency: c.Currency,
    vatId: c.VATID,
  };
}

export function summarizeSubscription(raw: unknown) {
  const s = asRecord(raw);
  if (!s) return raw;
  const fields = fieldMap(s);
  return {
    accountId: s.AccountId,
    parentAccountId: s.ParentAccountId,
    accountState: s.AccountState,
    serviceName:
      s.ServiceName ?? s.Name ?? s.ProductName ?? s.ServiceDisplayName ?? null,
    displayName: s.DisplayName ?? s.FriendlyName ?? null,
    creationDate: s.CreationDate ?? s.BillingStartDate ?? null,
    fields: Object.keys(fields).length ? fields : undefined,
  };
}

export function summarizeSubscriptions(list: unknown, activeOnly = false) {
  const arr = Array.isArray(list) ? list : list == null ? [] : [list];
  let items = arr.map(summarizeSubscription);
  if (activeOnly) {
    items = items.filter((s) => {
      const st = asRecord(s)?.accountState;
      return String(st ?? '').toLowerCase() === 'active';
    });
  }
  return items;
}

export function filterCompaniesByName(list: unknown, name: string) {
  const q = name.trim().toLowerCase();
  const arr = Array.isArray(list) ? list : [];
  return arr
    .map(summarizeCompany)
    .filter((c) => {
      const n = String(asRecord(c)?.companyName ?? '').toLowerCase();
      return n.includes(q);
    });
}
