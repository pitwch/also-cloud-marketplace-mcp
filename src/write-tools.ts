import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { precheckSubscription } from './subscription-precheck.js';
import {
  alsoPost,
  jsonObject,
  READ_ONLY,
  registerAlsoPostTool,
  textResult,
  WRITE_CREATE,
  WRITE_IRREVERSIBLE,
  WRITE_UPDATE,
} from './tools-helpers.js';

const accountId = z.number().int().describe('ALSO Cloud Account ID');

/**
 * Request schemas follow MarketplaceSimpleAPI 1.0.0 (SwaggerHub). Objects stay
 * open (.loose()) so further API fields are passed through unchanged.
 */
const companyRoot = {
  CompanyName: z.string().describe('Company name'),
  Address: z.string().describe('Street and number'),
  City: z.string(),
  Zip: z.string().describe('Postal code'),
  Email: z.string().describe('Main e-mail address'),
  Domain: z.array(z.string()).describe('Domains, e.g. ["example.ch"]'),
  VATID: z.string().optional().describe('VAT / UID number'),
  CustomerId: z.string().optional().describe('Own customer number'),
  ContractId: z.string().optional(),
  PurchaseOrderNumber: z.string().optional(),
  ReferenceNumber: z.string().optional(),
  State: z.string().optional(),
  ContactPerson: z.string().optional(),
  ContactPhone: z.string().optional(),
  TechnicalContact: z.string().optional(),
  TechnicalEmail: z.string().optional(),
  Marketplaces: z.array(z.number().int()).optional().describe('Marketplace IDs, e.g. [101]'),
};

const companyUpdate = z
  .object({
    AccountId: z.number().int().describe('Account ID of the company to update'),
    ...companyRoot,
  })
  .loose()
  .describe(
    'UpdateCompany payload. Required by ALSO: AccountId, CompanyName, Address, City, Zip, Email, Domain — send current values (from get_company) for fields you do not change.',
  );

const companyCreate = z
  .object({
    ParentAccountId: z.number().int().describe('Parent (reseller) account; see get_my_account'),
    Country: z.string().describe('Country name, e.g. "Switzerland"'),
    ...companyRoot,
    Marketplaces: z.array(z.number().int()).describe('Marketplace IDs, e.g. [101] (get_owned_marketplaces)'),
    CreateDefaultAdminUser: z.boolean().optional(),
  })
  .loose()
  .describe('CreateCompany payload (MarketplaceSimpleAPI CompanyCreateRequest).');

const accountUpdate = (what: string) =>
  z
    .object({
      AccountId: z.number().int().describe(`Account ID of the ${what} to update (required)`),
    })
    .loose()
    .describe(
      `${what} update: AccountId + fields to change, field names as returned by the matching get_* tool.`,
    );

const userCreate = z
  .object({
    ParentAccountId: z.number().int().describe('Company Account ID the user belongs to'),
    Username: z.string().min(1).describe('Login name, usually the e-mail'),
    Email: z.string().min(1),
    FirstName: z.string().min(1),
    LastName: z.string().min(1),
  })
  .loose()
  .describe('CreateUser payload.');

const userUpdate = z
  .object({
    AccountId: z.number().int(),
    FirstName: z.string().min(1),
    LastName: z.string().min(1),
    Email: z.string().optional(),
  })
  .loose()
  .describe('UpdateUser payload (AccountId, FirstName, LastName required).');

/** Name → value map, as CreateSubscription / ValidateFields / upgrade / renew expect. */
const fieldValueMap = z
  .record(z.string(), z.unknown())
  .describe('Field name → value, e.g. {"SKU": "...", "QuantityVcores": 1}. Names from get_fields_for_service.');

const updateField = z
  .object({
    name: z.string().describe('Field name, e.g. "QuantityVcores"'),
    value: z.string().describe('New value as string'),
  })
  .loose();

const creditCheckOrder = z
  .object({
    RequestId: z
      .number()
      .int()
      .describe('RequestId from list_credit_check_orders_for_approval (required)'),
    Comment: z.string().optional().describe('Reason / comment for the decision'),
  })
  .loose()
  .describe(
    'One entry from list_credit_check_orders_for_approval (RequestId required, Comment recommended); other fields of that entry may be passed as-is.',
  );

const specialDeal = z
  .object({
    ChargeStreamId: z.number().int().describe('Charge stream the discount applies to'),
    ValidUntil: z.string().describe('Month/year, format "MM-YYYY", e.g. "02-2030"'),
    Comments: z.string().optional(),
    IsCustomCharge: z.boolean().optional(),
    LinkToPriceProtection: z.boolean().optional(),
    DiscountItems: z
      .array(
        z
          .object({
            PriceableItemId: z.number().int(),
            Discount: z.number().optional().describe('Discount in percent'),
            CustomCharge: z.number().optional().describe('Custom price (with IsCustomCharge=true)'),
          })
          .loose(),
      )
      .optional(),
  })
  .loose()
  .describe('SetSpecialDeal payload (ChargeStreamId and ValidUntil required).');

/**
 * Products with remote pricing (SKU priced live by Microsoft): ALSO answers
 * ValidateFields / CreateSubscription with "SimpleApi doesn't support services
 * with remote pricing fields" — verified live for Azure Reserved Instances.
 */
const REMOTE_PRICING_SERVICE_RE = /ReservedInstance|SavingsPlan/i;

/** CreateSubscription / ValidateFields want Fields as name → value object. */
function normalizeFields(acc: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(acc.Fields)) return acc;
  const obj: Record<string, unknown> = {};
  for (const f of acc.Fields as Array<Record<string, unknown>>) {
    const n = f.Name ?? f.name;
    if (n != null) obj[String(n)] = f.Value ?? f.value;
  }
  return { ...acc, Fields: obj };
}

/**
 * Targeted write tools. Destructive ops (TerminateAccount, Delete*) stay on api_request only.
 */
export function registerWriteTools(server: McpServer): void {
  // --- Account create / update ---

  registerAlsoPostTool(server, 'create_company', {
    title: 'Create company',
    description:
      'WRITE: CreateCompany — creates a new end-customer company (Kunde anlegen) under ParentAccountId. Verify with find_companies first to avoid duplicates. Only after explicit user confirmation.',
    endpoint: 'CreateCompany',
    annotations: WRITE_CREATE,
    inputSchema: z.object({
      companyAccount: companyCreate,
    }),
  });

  registerAlsoPostTool(server, 'update_company', {
    title: 'Update company',
    description: 'WRITE: UpdateCompany — changes master data (name, e-mail, address, VAT) of an existing company. Pass AccountId + only changed fields. Not for: subscriptions or credit limits.',
    endpoint: 'UpdateCompany',
    annotations: WRITE_UPDATE,
    inputSchema: z.object({
      company: companyUpdate,
    }),
  });

  registerAlsoPostTool(server, 'create_reseller', {
    title: 'Create reseller',
    description: 'WRITE: CreateReseller. Pass resellerAccount object.',
    endpoint: 'CreateReseller',
    annotations: WRITE_CREATE,
    inputSchema: z.object({
      resellerAccount: jsonObject.describe('ResellerAccount payload'),
    }),
  });

  registerAlsoPostTool(server, 'update_reseller', {
    title: 'Update reseller',
    description: 'WRITE: UpdateReseller. Pass reseller object with accountId and fields to change.',
    endpoint: 'UpdateReseller',
    annotations: WRITE_UPDATE,
    inputSchema: z.object({
      reseller: accountUpdate('Reseller'),
    }),
  });

  registerAlsoPostTool(server, 'create_department', {
    title: 'Create department',
    description: 'WRITE: CreateDepartment. Pass departmentAccount object.',
    endpoint: 'CreateDepartment',
    annotations: WRITE_CREATE,
    inputSchema: z.object({
      departmentAccount: jsonObject.describe('DepartmentAccount payload'),
    }),
  });

  registerAlsoPostTool(server, 'update_department', {
    title: 'Update department',
    description: 'WRITE: UpdateDepartment. Pass department object with accountId and fields to change.',
    endpoint: 'UpdateDepartment',
    annotations: WRITE_UPDATE,
    inputSchema: z.object({
      department: accountUpdate('Department'),
    }),
  });

  registerAlsoPostTool(server, 'create_user', {
    title: 'Create user',
    description: 'WRITE: CreateUser under selected parent. Pass userAccount object.',
    endpoint: 'CreateUser',
    annotations: WRITE_CREATE,
    inputSchema: z.object({
      userAccount: userCreate,
    }),
  });

  registerAlsoPostTool(server, 'update_user', {
    title: 'Update user',
    description: 'WRITE: UpdateUser. Pass user object with accountId and settings to change.',
    endpoint: 'UpdateUser',
    annotations: WRITE_UPDATE,
    inputSchema: z.object({
      user: userUpdate,
    }),
  });

  // --- Subscription lifecycle ---

  registerAlsoPostTool(server, 'get_fields_for_service', {
    title: 'Get fields for service',
    description:
      'GetFieldsForService — field definitions needed before CreateSubscription / ValidateFields. Remote choice lists (e.g. SKU, Region) may come back empty; load their values with get_remote_enums.',
    endpoint: 'GetFieldsForService',
    annotations: READ_ONLY,
    inputSchema: z.object({
      parentAccountId: z.number().int().describe('Parent account under which to add the service'),
      productName: z.string().min(1).describe('Internal service / product name'),
      secondaryParentId: z
        .number()
        .int()
        .optional()
        .describe('Optional secondary parent (e.g. some Microsoft subscriptions)'),
    }),
  });

  const subscriptionAccount = z
    .object({
      ParentAccountId: z
        .number()
        .int()
        .describe('Parent account: the company, but for Azure Reserved Instances / Savings Plans the customer Azure Plan subscription (precheck tells you the right ID)'),
      ServiceName: z
        .string()
        .min(1)
        .describe('Technical product name, e.g. "123456_AzureReservedInstanceforAzurePlanMonthlyBilled_12345"'),
      DependencyAccountId: z
        .number()
        .int()
        .optional()
        .describe('Dependency subscription, e.g. the Microsoft tenant subscription for Azure / RI products'),
      Fields: z
        .union([
          fieldValueMap,
          z.array(z.object({ Name: z.string(), Value: z.unknown() }).loose()),
        ])
        .describe(
          'Field name → value OBJECT as ALSO expects, e.g. {"SKU":"…","QuantityVcores":1}. A [{Name,Value}] list is converted automatically. For Azure RIs typically SKU, QuantityVcores, ProductCatalogue, ProductSegment, Product, ReservationName, Ordertype, ScopedSubscriptions (+ Region); values via get_remote_enums.',
        ),
      ContractId: z.string().optional(),
      PurchaseOrderNumber: z.string().optional(),
      PurchaseOrderCommitment: z.boolean().optional(),
      QuoteId: z.string().optional(),
      ScheduledDate: z.string().optional().describe('YYYY-MM-DD'),
      FieldsToValidate: z
        .array(z.string())
        .optional()
        .describe('ValidateFields only: restrict validation to these field names'),
    })
    .loose()
    .describe('SubscriptionAccount payload; other API fields are passed through.');

  const precheckThenPost = (endpoint: 'ValidateFields' | 'CreateSubscription') =>
    async ({ subscriptionAccount: acc }: { subscriptionAccount: Record<string, unknown> }) => {
      try {
        const service = String(acc.ServiceName ?? acc.serviceName ?? '');
        if (REMOTE_PRICING_SERVICE_RE.test(service)) {
          return textResult(
            {
              error: `${endpoint} is not possible for ${service} via the ALSO Simple API.`,
              alsoResponse: "SimpleApi doesn't support services with remote pricing fields (HTTP 500, verified 2026-11-16).",
              nextStep:
                'Order / validate Azure Reserved Instances and Savings Plans in the ALSO Cloud Marketplace web portal. Use get_remote_enums to prepare the exact values (Product, SKU incl. price, recommendations) beforehand.',
            },
            true,
          );
        }
        const check = await precheckSubscription(acc);
        if (!check.ok) {
          return textResult(
            {
              error: `Local precheck failed — ${endpoint} was NOT called (ALSO would only answer with a generic HTTP 500).`,
              ...check,
            },
            true,
          );
        }
        const res = await alsoPost(endpoint, { subscriptionAccount: normalizeFields(acc) });
        return textResult({
          ...res,
          ...(check.issues.length ? { warnings: check.issues } : {}),
          ...(check.skipped ? { precheckSkipped: check.skipped } : {}),
        });
      } catch (err) {
        return textResult(err instanceof Error ? err.message : String(err), true);
      }
    };

  server.registerTool(
    'validate_subscription_fields',
    {
      title: 'Validate subscription fields',
      description:
        'ValidateFields — validates a subscriptionAccount before create_subscription. Does not provision. First checks the payload locally against get_fields_for_service (mandatory fields, patterns, ranges, enum values) and returns the concrete problems instead of ALSO\'s generic HTTP 500.',
      annotations: READ_ONLY,
      inputSchema: z.object({ subscriptionAccount }),
    },
    precheckThenPost('ValidateFields'),
  );

  server.registerTool(
    'create_subscription',
    {
      title: 'Create subscription',
      description:
        'WRITE: CreateSubscription — orders/provisions a new service (cost!). Only after explicit user confirmation. Runs the same local field precheck as validate_subscription_fields and refuses to call ALSO if mandatory fields are missing or invalid.',
      annotations: WRITE_IRREVERSIBLE,
      inputSchema: z.object({ subscriptionAccount }),
    },
    precheckThenPost('CreateSubscription'),
  );

  registerAlsoPostTool(server, 'update_subscription', {
    title: 'Update subscription',
    description: 'WRITE: UpdateSubscription — changes field values (e.g. Quantity) of an existing subscription. Pass AccountId + changed Fields. For RI/Savings Plan exchange use get_reservation_options first.',
    endpoint: 'UpdateSubscription',
    annotations: WRITE_UPDATE,
    inputSchema: z.object({
      subscription: z
        .object({
          AccountId: z.number().int().describe('Subscription Account ID'),
          ServiceName: z.string().min(1).describe('Technical product name of the subscription (from get_subscription)'),
          Fields: z
            .array(updateField)
            .describe('Only the fields to change as [{name, value}], e.g. [{"name":"QuantityVcores","value":"2"}]'),
          AdvancePeriodEndAction: z.enum(['Renew', 'Terminate']).optional(),
          ContractId: z.string().optional(),
          PurchaseOrderNumber: z.string().optional(),
        })
        .loose()
        .describe('UpdateSubscription payload (AccountId, ServiceName, Fields required).'),
    }),
  });

  registerAlsoPostTool(server, 'get_account_custom_actions', {
    title: 'Get account custom actions',
    description: 'GetAccountCustomActionsWithFields — lists custom actions (with fields) available for one subscription. For Reserved Instances / Savings Plans prefer get_reservation_options.',
    endpoint: 'GetAccountCustomActionsWithFields',
    annotations: READ_ONLY,
    inputSchema: z.object({ accountId }),
  });

  registerAlsoPostTool(server, 'execute_account_custom_action', {
    title: 'Execute account custom action',
    description: 'WRITE: ExecuteAccountCustomAction — runs a named custom action on a subscription (e.g. exchange/modify of a reservation when the service offers it). Get action names and fields from get_reservation_options or get_account_custom_actions.',
    endpoint: 'ExecuteAccountCustomAction',
    annotations: WRITE_IRREVERSIBLE,
    inputSchema: z.object({
      action: z.string().min(1).describe('Custom action name'),
      subscriptionAccount: z
        .object({
          AccountId: z.number().int().describe('Subscription Account ID'),
          ServiceName: z.string().min(1).describe('Technical product name of the subscription'),
          Fields: fieldValueMap.describe('Action field name → value (from get_account_custom_actions)'),
        })
        .loose(),
    }),
  });

  registerAlsoPostTool(server, 'retry_last_failed_provisioning', {
    title: 'Retry last failed provisioning',
    description: 'WRITE: RetryLastFailedProvisioning for a subscription accountId.',
    endpoint: 'RetryLastFailedProvisioning',
    annotations: WRITE_CREATE,
    inputSchema: z.object({ accountId }),
  });

  // --- Upgrade / renew ---

  registerAlsoPostTool(server, 'get_possible_services_for_upgrade', {
    title: 'Get possible upgrade services',
    description: 'GetPossibleServicesForUpgrade — target PRODUCTS a subscription can be upgraded/switched to. Not an RI exchange: for monthly Reserved Instances the size is in the SKU field and ALSO returns HTTP 500 here; use get_reservation_options.',
    endpoint: 'GetPossibleServicesForUpgrade',
    annotations: READ_ONLY,
    inputSchema: z.object({ accountId }),
  });

  registerAlsoPostTool(server, 'get_subscription_fields_for_upgrade', {
    title: 'Get subscription fields for upgrade',
    description: 'GetSubscriptionFieldsForUpgrade — fields for an upgrade to targetProductName (from get_possible_services_for_upgrade). Returns HTTP 500 for monthly Reserved Instances (ALSO-side).',
    endpoint: 'GetSubscriptionFieldsForUpgrade',
    annotations: READ_ONLY,
    inputSchema: z.object({
      accountId,
      targetProductName: z.string().min(1).describe('Technical name of the destination product'),
    }),
  });

  registerAlsoPostTool(server, 'execute_subscription_upgrade', {
    title: 'Execute subscription upgrade',
    description: 'WRITE: ExecuteSubscriptionUpgrade — switches/upgrades a subscription to targetProductName (product change, not an RI size/SKU exchange). Only after explicit user confirmation.',
    endpoint: 'ExecuteSubscriptionUpgrade',
    annotations: WRITE_IRREVERSIBLE,
    inputSchema: z.object({
      sourceAccountId: z.number().int().describe('Subscription account to upgrade'),
      targetProductName: z.string().min(1),
      fieldValues: fieldValueMap,
      targetAccountId: z.number().int().optional(),
      purchaseOrderCommitment: z
        .boolean()
        .optional()
        .describe('Confirm PO commitment if required by target product'),
    }),
  });

  registerAlsoPostTool(server, 'get_subscription_fields_for_renew', {
    title: 'Get subscription fields for renew',
    description: 'GetSubscriptionFieldsForRenew — renewal (Verlängerung) fields of a subscription, e.g. term or auto-renew.',
    endpoint: 'GetSubscriptionFieldsForRenew',
    annotations: READ_ONLY,
    inputSchema: z.object({ accountId }),
  });

  registerAlsoPostTool(server, 'configure_subscription_renew', {
    title: 'Configure subscription renew',
    description:
      'WRITE: ConfigureSubscriptionRenew — stores renew field values applied at subscription end date.',
    endpoint: 'ConfigureSubscriptionRenew',
    annotations: WRITE_UPDATE,
    inputSchema: z.object({
      accountId,
      fieldValues: fieldValueMap,
    }),
  });

  registerAlsoPostTool(server, 'reset_default_renew_values', {
    title: 'Reset default renew values',
    description: 'WRITE: ResetDefaultRenewValues — clears saved renew config for accountId.',
    endpoint: 'ResetDefaultRenewValues',
    annotations: WRITE_UPDATE,
    inputSchema: z.object({ accountId }),
  });

  // --- Credit / special deal ---

  registerAlsoPostTool(server, 'set_credit_limit', {
    title: 'Set credit limit',
    description:
      'WRITE: SetCreditLimit. Omit limit (or leave empty per API) to remove the credit limit; comment is required.',
    endpoint: 'SetCreditLimit',
    annotations: WRITE_UPDATE,
    inputSchema: z.object({
      accountId,
      comment: z.string().min(1).describe('Reason for setting/changing the credit limit'),
      limit: z.number().optional().describe('New limit; omit to clear per API rules'),
    }),
  });

  registerAlsoPostTool(server, 'list_credit_check_orders_for_approval', {
    title: 'List credit check orders',
    description: 'ListCreditCheckOrdersForApproval — orders waiting for a credit check (Bonitätsprüfung) approval.',
    endpoint: 'ListCreditCheckOrdersForApproval',
    annotations: READ_ONLY,
    inputSchema: z.object({}),
  });

  registerAlsoPostTool(server, 'approve_credit_check_order', {
    title: 'Approve credit check order',
    description:
      'WRITE: ApproveCreditCheckOrder — approves an order that is blocked by the credit check (Bonitätsprüfung freigeben). Pass the entry from list_credit_check_orders_for_approval. Not for: Azure Reserved Instances / Savings Plans (exchange/Tausch → get_reservation_options), invoices or subscriptions.',
    endpoint: 'ApproveCreditCheckOrder',
    annotations: WRITE_IRREVERSIBLE,
    inputSchema: z.object({
      order: creditCheckOrder,
    }),
    mapBody: (args) => args.order,
  });

  registerAlsoPostTool(server, 'decline_credit_check_order', {
    title: 'Decline credit check order',
    description:
      'WRITE: DeclineCreditCheckOrder — rejects an order that is blocked by the credit check (Bonitätsprüfung ablehnen). Pass the entry from list_credit_check_orders_for_approval. Not for: Azure Reserved Instances / Savings Plans (exchange/Tausch → get_reservation_options), invoices or subscriptions.',
    endpoint: 'DeclineCreditCheckOrder',
    annotations: WRITE_IRREVERSIBLE,
    inputSchema: z.object({
      order: creditCheckOrder,
    }),
    mapBody: (args) => args.order,
  });

  registerAlsoPostTool(server, 'set_special_deal', {
    title: 'Set special deal',
    description: 'WRITE: SetSpecialDeal — creates/updates a special price discount (Sonderkondition) for accountId. Not for: credit limits or reservations.',
    endpoint: 'SetSpecialDeal',
    annotations: WRITE_UPDATE,
    inputSchema: z.object({
      accountId,
      specialDeal,
    }),
  });
}
