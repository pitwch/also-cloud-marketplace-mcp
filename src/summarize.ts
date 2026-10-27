/** Compact views so models are not flooded with Fields / PriceableItems. */

const INTERESTING_FIELD_NAMES = new Set(
  [
    'TenantId',
    'TenantID',
    'MicrosoftTenantId',
    'Domain',
    'AzureSubscriptionId',
    'InitialAzureSubscriptionID',
    'SubscriptionId',
    'SubscriptionName',
    'PlanName',
    'Name',
    'ReservationName',
    'ReservationID',
    'SKU',
    'Sku',
    'Quantity',
    'QuantityVcores',
    'Region',
    'Term',
    'StartDate',
    'EndDate',
    'EffectiveDateTime',
    'ExpirationDate',
    'BillingCycle',
    'Billingcycle',
    'BillingType',
    'OfferId',
    'ProductId',
    'CustomerTenantId',
    'Managedresources',
    'Unmanagedresources',
    'CurrentforecastvalueEndcustomer',
    'MonthlybillforecastEndcustomer',
    'HourlyCommitment',
    'OcpSubscriptionId',
  ].map((s) => s.toLowerCase()),
);

const SECRET_FIELD_NAMES = new Set(
  ['initialpassword', 'password', 'secret', 'apikey', 'apitoken'].map((s) =>
    s.toLowerCase(),
  ),
);

const AZURE_SERVICE_RE =
  /azure\s*plan|azure\s*reserved|reserved\s*instance|savings\s*plan|alsoazureplan/i;

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
    if (SECRET_FIELD_NAMES.has(name.toLowerCase())) continue;
    const value = f.Value;
    if (value === undefined || value === null || value === '') continue;
    if (INTERESTING_FIELD_NAMES.has(name.toLowerCase())) {
      out[name] = value;
    }
  }
  return out;
}

/** Remove secrets from a full API subscription/company payload. */
export function redactSecrets(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw.map(redactSecrets);
  const r = asRecord(raw);
  if (!r) return raw;
  const copy: Record<string, unknown> = { ...r };
  if (Array.isArray(copy.Fields)) {
    copy.Fields = copy.Fields.map((item) => {
      const f = asRecord(item);
      if (!f || f.Name == null) return item;
      if (SECRET_FIELD_NAMES.has(String(f.Name).toLowerCase())) {
        return { ...f, Value: '[REDACTED]' };
      }
      return item;
    });
  }
  return copy;
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
    companyAccountId: s.CompanyAccountId,
    accountState: s.AccountState,
    serviceName: s.ServiceName ?? null,
    serviceDisplayName:
      s.ServiceDisplayName ?? s.DisplayName ?? s.FriendlyName ?? null,
    vendor: s.VendorDisplayName ?? null,
    billingStartDate: s.BillingStartDate ?? null,
    contractEndDate: s.ContractEndDate ?? null,
    provisioningStatus: s.ProvisioningStatus ?? null,
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

export function isAzureRelatedSubscription(summary: unknown): boolean {
  const s = asRecord(summary);
  if (!s) return false;
  const hay = `${s.serviceName ?? ''} ${s.serviceDisplayName ?? ''}`;
  return AZURE_SERVICE_RE.test(hay);
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
