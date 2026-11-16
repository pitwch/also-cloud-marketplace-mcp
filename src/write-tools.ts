import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {
  jsonObject,
  READ_ONLY,
  registerAlsoPostTool,
  WRITE_CREATE,
  WRITE_IRREVERSIBLE,
  WRITE_UPDATE,
} from './tools-helpers.js';

const accountId = z.number().int().describe('ALSO Cloud Account ID');

/**
 * Field names below are taken from real GetCompany / GetSubscription responses.
 * The Simple API publishes no request schema, so objects stay open (.loose()):
 * any further API field is passed through unchanged.
 */
const companyFields = {
  CompanyName: z.string().optional().describe('Company name'),
  Email: z.string().optional().describe('Main e-mail address'),
  Domain: z.string().optional().describe('Primary domain'),
  City: z.string().optional(),
  Country: z.string().optional().describe('Country code as returned by get_company'),
  Currency: z.string().optional().describe('Currency code, e.g. CHF'),
  VATID: z.string().optional().describe('VAT / UID number'),
  CustomerId: z.string().optional().describe('Own customer number'),
};

const companyUpdate = z
  .object({
    AccountId: z.number().int().describe('Account ID of the company to update (required)'),
    ...companyFields,
  })
  .loose()
  .describe(
    'Company update: AccountId + only the fields to change. Same field names as get_company returns; other API fields are passed through.',
  );

const companyCreate = z
  .object({
    ParentAccountId: z
      .number()
      .int()
      .describe('Parent (reseller) account; see get_my_account'),
    ...companyFields,
    CompanyName: z.string().min(1).describe('Company name (required)'),
  })
  .loose()
  .describe('New company. Field names as get_company returns; other API fields are passed through.');

const accountUpdate = (what: string) =>
  z
    .object({
      AccountId: z.number().int().describe(`Account ID of the ${what} to update (required)`),
    })
    .loose()
    .describe(
      `${what} update: AccountId + fields to change, field names as returned by the matching get_* tool.`,
    );

const subscriptionField = z
  .object({
    Name: z.string().describe('Field name as listed in get_subscription(fullDetail=true) Fields'),
    Value: z.unknown().describe('New value'),
  })
  .loose();

const creditCheckOrder = z
  .object({
    RequestId: z
      .union([z.number(), z.string()])
      .describe('RequestId from list_credit_check_orders_for_approval (required)'),
    Comment: z.string().optional().describe('Reason / comment for the decision'),
  })
  .loose()
  .describe(
    'One entry from list_credit_check_orders_for_approval (RequestId required, Comment recommended); other fields of that entry may be passed as-is.',
  );

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
      userAccount: jsonObject.describe('UserAccount payload'),
    }),
  });

  registerAlsoPostTool(server, 'update_user', {
    title: 'Update user',
    description: 'WRITE: UpdateUser. Pass user object with accountId and settings to change.',
    endpoint: 'UpdateUser',
    annotations: WRITE_UPDATE,
    inputSchema: z.object({
      user: accountUpdate('User'),
    }),
  });

  // --- Subscription lifecycle ---

  registerAlsoPostTool(server, 'get_fields_for_service', {
    title: 'Get fields for service',
    description:
      'GetFieldsForService — field definitions needed before CreateSubscription / ValidateFields.',
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

  registerAlsoPostTool(server, 'validate_subscription_fields', {
    title: 'Validate subscription fields',
    description:
      'WRITE-ish: ValidateFields — validates subscriptionAccount before create. Does not provision.',
    endpoint: 'ValidateFields',
    annotations: READ_ONLY,
    inputSchema: z.object({
      subscriptionAccount: jsonObject.describe('SubscriptionAccount payload to validate'),
    }),
  });

  registerAlsoPostTool(server, 'create_subscription', {
    title: 'Create subscription',
    description:
      'WRITE: CreateSubscription. Use get_fields_for_service + validate_subscription_fields first.',
    endpoint: 'CreateSubscription',
    annotations: WRITE_IRREVERSIBLE,
    inputSchema: z.object({
      subscriptionAccount: jsonObject.describe('SubscriptionAccount payload'),
    }),
  });

  registerAlsoPostTool(server, 'update_subscription', {
    title: 'Update subscription',
    description: 'WRITE: UpdateSubscription — changes field values (e.g. Quantity) of an existing subscription. Pass AccountId + changed Fields. For RI/Savings Plan exchange use get_reservation_options first.',
    endpoint: 'UpdateSubscription',
    annotations: WRITE_UPDATE,
    inputSchema: z.object({
      subscription: z
        .object({
          AccountId: z.number().int().describe('Subscription Account ID (required)'),
          Fields: z
            .array(subscriptionField)
            .optional()
            .describe('Only the fields to change, e.g. [{Name:"Quantity", Value:5}]'),
        })
        .loose()
        .describe('Subscription update: AccountId + changed Fields; other API fields are passed through.'),
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
      subscriptionAccount: jsonObject.describe('Subscription account + action field values'),
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
    description: 'GetPossibleServicesForUpgrade — target products a subscription can be upgraded/switched to (e.g. another SKU or term).',
    endpoint: 'GetPossibleServicesForUpgrade',
    annotations: READ_ONLY,
    inputSchema: z.object({ accountId }),
  });

  registerAlsoPostTool(server, 'get_subscription_fields_for_upgrade', {
    title: 'Get subscription fields for upgrade',
    description: 'GetSubscriptionFieldsForUpgrade for accountId + targetProductName.',
    endpoint: 'GetSubscriptionFieldsForUpgrade',
    annotations: READ_ONLY,
    inputSchema: z.object({
      accountId,
      targetProductName: z.string().min(1).describe('Technical name of the destination product'),
    }),
  });

  registerAlsoPostTool(server, 'execute_subscription_upgrade', {
    title: 'Execute subscription upgrade',
    description: 'WRITE: ExecuteSubscriptionUpgrade — switches/upgrades a subscription to targetProductName (also used for RI/Savings Plan changes if offered). Only after explicit user confirmation.',
    endpoint: 'ExecuteSubscriptionUpgrade',
    annotations: WRITE_IRREVERSIBLE,
    inputSchema: z.object({
      sourceAccountId: z.number().int().describe('Subscription account to upgrade'),
      targetProductName: z.string().min(1),
      fieldValues: jsonObject.describe('Field name → value pairs for the upgrade'),
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
      fieldValues: jsonObject.describe('Field name → value pairs for renew'),
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
      specialDeal: jsonObject.describe('SimpleSpecialDealRequest payload'),
    }),
  });
}
