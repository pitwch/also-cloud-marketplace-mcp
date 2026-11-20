/** Compact views so models are not flooded with Fields / PriceableItems. */
import { searchCompanies, type CompanyFields } from './company-search.js';

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

/** Plain-language next step for known vendor provisioning errors. */
export function provisioningHint(error: string): string | undefined {
  if (/900428|re-attest/i.test(error)) {
    return 'Microsoft requires a new Microsoft Customer Agreement attestation. Run the custom action INITIATEMCAATTESTATION on the Microsoft tenant subscription (execute_account_custom_action) or let the customer re-attest in the Microsoft 365 admin center, then retry the failed provisioning in the ALSO portal.';
  }
  return undefined;
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
    ...(s.ScheduledTerminationDate ? { terminationDate: s.ScheduledTerminationDate } : {}),
    ...(typeof s.ErrorDetails === 'string' && s.ErrorDetails.trim()
      ? {
          provisioningError: s.ErrorDetails.replace(/\s+/g, ' ').trim().slice(0, 600),
          ...(provisioningHint(s.ErrorDetails) ? { provisioningHint: provisioningHint(s.ErrorDetails) } : {}),
        }
      : {}),
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

const LEGAL_FORMS =
  /\b(ag|gmbh|sa|sarl|s\s?a\s?r\s?l|sagl|kg|og|ug|ltd|llc|inc|co|kmg|gmbh\s?&\s?co|e\s?v|klg|genossenschaft|stiftung|verein)\b/g;

/** Normalised company name for duplicate detection (case, umlauts, punctuation, legal form). */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9&\s]/g, ' ')
    .replace(LEGAL_FORMS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type DuplicateGroup = {
  normalizedName: string;
  companies: Array<{ accountId: unknown; companyName: unknown; accountState?: unknown }>;
};

/** Groups companies whose names are equal after normalisation (e.g. "DEMO AG" vs "Demo AG"). */
export function findNameDuplicates(companies: unknown[]): DuplicateGroup[] {
  const groups = new Map<string, DuplicateGroup>();
  for (const c of companies) {
    const r = asRecord(c);
    if (!r) continue;
    const raw = String(r.companyName ?? r.CompanyName ?? '');
    const key = normalizeCompanyName(raw);
    if (!key) continue;
    const g = groups.get(key) ?? { normalizedName: key, companies: [] };
    g.companies.push({
      accountId: r.accountId ?? r.AccountId,
      companyName: raw,
      accountState: r.accountState ?? r.AccountState,
    });
    groups.set(key, g);
  }
  return [...groups.values()].filter((g) => g.companies.length > 1);
}

export const DUPLICATE_HINT =
  'Some companies have near-identical names (possible duplicate customer accounts). Check accountId / customerId before acting.';

const RESERVATION_RE = /reserved|reservation|savings\s*plan/i;

/** Azure Reserved Instance or Savings Plan (not the plain Azure Plan). */
export function isReservationSubscription(summary: unknown): boolean {
  const s = asRecord(summary);
  if (!s) return false;
  return RESERVATION_RE.test(`${s.serviceName ?? ''} ${s.serviceDisplayName ?? ''}`);
}

/**
 * Companies matching a name, abbreviation ("BP" → "Beispiel …"), initials,
 * customer ID, domain or small typo. matchMode "fuzzy" means only
 * abbreviation/typo suggestions were found (see company-search.ts).
 */
export function searchCompaniesByName(list: unknown, name: string) {
  const arr = Array.isArray(list) ? list : [];
  const companies = arr
    .map(summarizeCompany)
    .filter((c): c is ReturnType<typeof summarizeCompany> & CompanyFields => asRecord(c) !== null);
  return searchCompanies(companies, name);
}

export function filterCompaniesByName(list: unknown, name: string) {
  return searchCompaniesByName(list, name).matches;
}
