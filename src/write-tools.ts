import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { jsonObject, registerAlsoPostTool } from './tools-helpers.js';

const accountId = z.number().int().describe('ALSO Cloud Account ID');
const writeHint = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
} as const;

/**
 * Targeted write tools. Destructive ops (TerminateAccount, Delete*) stay on api_request only.
 */
export function registerWriteTools(server: McpServer): void {
  // --- Account create / update ---

  registerAlsoPostTool(server, 'create_company', {
    title: 'Create company',
    description:
      'WRITE: CreateCompany. Pass companyAccount object (parent, name, address, … per Simple API). Prefer get_companies afterwards to verify.',
    endpoint: 'CreateCompany',
    annotations: writeHint,
    inputSchema: z.object({
      companyAccount: jsonObject.describe('CompanyAccount payload'),
    }),
  });

  registerAlsoPostTool(server, 'update_company', {
    title: 'Update company',
    description: 'WRITE: UpdateCompany. Pass company object with accountId and fields to change.',
    endpoint: 'UpdateCompany',
    annotations: writeHint,
    inputSchema: z.object({
      company: jsonObject.describe('Company update payload'),
    }),
  });

  registerAlsoPostTool(server, 'create_reseller', {
    title: 'Create reseller',
    description: 'WRITE: CreateReseller. Pass resellerAccount object.',
    endpoint: 'CreateReseller',
    annotations: writeHint,
    inputSchema: z.object({
      resellerAccount: jsonObject.describe('ResellerAccount payload'),
    }),
  });

  registerAlsoPostTool(server, 'update_reseller', {
    title: 'Update reseller',
    description: 'WRITE: UpdateReseller. Pass reseller object with accountId and fields to change.',
    endpoint: 'UpdateReseller',
    annotations: writeHint,
    inputSchema: z.object({
      reseller: jsonObject.describe('Reseller update payload'),
    }),
  });

  registerAlsoPostTool(server, 'create_department', {
    title: 'Create department',
    description: 'WRITE: CreateDepartment. Pass departmentAccount object.',
    endpoint: 'CreateDepartment',
    annotations: writeHint,
    inputSchema: z.object({
      departmentAccount: jsonObject.describe('DepartmentAccount payload'),
    }),
  });

  registerAlsoPostTool(server, 'update_department', {
    title: 'Update department',
    description: 'WRITE: UpdateDepartment. Pass department object with accountId and fields to change.',
    endpoint: 'UpdateDepartment',
    annotations: writeHint,
    inputSchema: z.object({
      department: jsonObject.describe('Department update payload'),
    }),
  });

  registerAlsoPostTool(server, 'create_user', {
    title: 'Create user',
    description: 'WRITE: CreateUser under selected parent. Pass userAccount object.',
    endpoint: 'CreateUser',
    annotations: writeHint,
    inputSchema: z.object({
      userAccount: jsonObject.describe('UserAccount payload'),
    }),
  });

  registerAlsoPostTool(server, 'update_user', {
    title: 'Update user',
    description: 'WRITE: UpdateUser. Pass user object with accountId and settings to change.',
    endpoint: 'UpdateUser',
    annotations: writeHint,
    inputSchema: z.object({
      user: jsonObject.describe('User update payload'),
    }),
  });

  // --- Subscription lifecycle ---

  registerAlsoPostTool(server, 'get_fields_for_service', {
    title: 'Get fields for service',
    description:
      'GetFieldsForService — field definitions needed before CreateSubscription / ValidateFields.',
    endpoint: 'GetFieldsForService',
    annotations: { readOnlyHint: true, openWorldHint: true },
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
    annotations: writeHint,
    inputSchema: z.object({
      subscriptionAccount: jsonObject.describe('SubscriptionAccount payload to validate'),
    }),
  });

  registerAlsoPostTool(server, 'create_subscription', {
    title: 'Create subscription',
    description:
      'WRITE: CreateSubscription. Use get_fields_for_service + validate_subscription_fields first.',
    endpoint: 'CreateSubscription',
    annotations: writeHint,
    inputSchema: z.object({
      subscriptionAccount: jsonObject.describe('SubscriptionAccount payload'),
    }),
  });

  registerAlsoPostTool(server, 'update_subscription', {
    title: 'Update subscription',
    description: 'WRITE: UpdateSubscription. Pass subscription object with accountId and field changes.',
    endpoint: 'UpdateSubscription',
    annotations: writeHint,
    inputSchema: z.object({
      subscription: jsonObject.describe('Subscription update payload'),
    }),
  });

  registerAlsoPostTool(server, 'get_account_custom_actions', {
    title: 'Get account custom actions',
    description: 'GetAccountCustomActionsWithFields — list custom actions for a subscription.',
    endpoint: 'GetAccountCustomActionsWithFields',
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: z.object({ accountId }),
  });

  registerAlsoPostTool(server, 'execute_account_custom_action', {
    title: 'Execute account custom action',
    description: 'WRITE: ExecuteAccountCustomAction — runs a named custom action on a subscription.',
    endpoint: 'ExecuteAccountCustomAction',
    annotations: writeHint,
    inputSchema: z.object({
      action: z.string().min(1).describe('Custom action name'),
      subscriptionAccount: jsonObject.describe('Subscription account + action field values'),
    }),
  });

  registerAlsoPostTool(server, 'retry_last_failed_provisioning', {
    title: 'Retry last failed provisioning',
    description: 'WRITE: RetryLastFailedProvisioning for a subscription accountId.',
    endpoint: 'RetryLastFailedProvisioning',
    annotations: writeHint,
    inputSchema: z.object({ accountId }),
  });

  // --- Upgrade / renew ---

  registerAlsoPostTool(server, 'get_possible_services_for_upgrade', {
    title: 'Get possible upgrade services',
    description: 'GetPossibleServicesForUpgrade for accountId.',
    endpoint: 'GetPossibleServicesForUpgrade',
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: z.object({ accountId }),
  });

  registerAlsoPostTool(server, 'get_subscription_fields_for_upgrade', {
    title: 'Get subscription fields for upgrade',
    description: 'GetSubscriptionFieldsForUpgrade for accountId + targetProductName.',
    endpoint: 'GetSubscriptionFieldsForUpgrade',
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: z.object({
      accountId,
      targetProductName: z.string().min(1).describe('Technical name of the destination product'),
    }),
  });

  registerAlsoPostTool(server, 'execute_subscription_upgrade', {
    title: 'Execute subscription upgrade',
    description: 'WRITE: ExecuteSubscriptionUpgrade — provisions upgrade to targetProductName.',
    endpoint: 'ExecuteSubscriptionUpgrade',
    annotations: writeHint,
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
    description: 'GetSubscriptionFieldsForRenew for accountId.',
    endpoint: 'GetSubscriptionFieldsForRenew',
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: z.object({ accountId }),
  });

  registerAlsoPostTool(server, 'configure_subscription_renew', {
    title: 'Configure subscription renew',
    description:
      'WRITE: ConfigureSubscriptionRenew — stores renew field values applied at subscription end date.',
    endpoint: 'ConfigureSubscriptionRenew',
    annotations: writeHint,
    inputSchema: z.object({
      accountId,
      fieldValues: jsonObject.describe('Field name → value pairs for renew'),
    }),
  });

  registerAlsoPostTool(server, 'reset_default_renew_values', {
    title: 'Reset default renew values',
    description: 'WRITE: ResetDefaultRenewValues — clears saved renew config for accountId.',
    endpoint: 'ResetDefaultRenewValues',
    annotations: writeHint,
    inputSchema: z.object({ accountId }),
  });

  // --- Credit / special deal ---

  registerAlsoPostTool(server, 'set_credit_limit', {
    title: 'Set credit limit',
    description:
      'WRITE: SetCreditLimit. Omit limit (or leave empty per API) to remove the credit limit; comment is required.',
    endpoint: 'SetCreditLimit',
    annotations: writeHint,
    inputSchema: z.object({
      accountId,
      comment: z.string().min(1).describe('Reason for setting/changing the credit limit'),
      limit: z.number().optional().describe('New limit; omit to clear per API rules'),
    }),
  });

  registerAlsoPostTool(server, 'list_credit_check_orders_for_approval', {
    title: 'List credit check orders',
    description: 'ListCreditCheckOrdersForApproval — pending credit check orders.',
    endpoint: 'ListCreditCheckOrdersForApproval',
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: z.object({}),
  });

  registerAlsoPostTool(server, 'approve_credit_check_order', {
    title: 'Approve credit check order',
    description:
      'WRITE: ApproveCreditCheckOrder. Pass the order object (typically from list_credit_check_orders_for_approval), usually including RequestId and Comment.',
    endpoint: 'ApproveCreditCheckOrder',
    annotations: writeHint,
    inputSchema: z.object({
      order: jsonObject.describe('Credit check order payload to approve'),
    }),
    mapBody: (args) => args.order,
  });

  registerAlsoPostTool(server, 'decline_credit_check_order', {
    title: 'Decline credit check order',
    description:
      'WRITE: DeclineCreditCheckOrder. Pass the order object (typically from list_credit_check_orders_for_approval).',
    endpoint: 'DeclineCreditCheckOrder',
    annotations: writeHint,
    inputSchema: z.object({
      order: jsonObject.describe('Credit check order payload to decline'),
    }),
    mapBody: (args) => args.order,
  });

  registerAlsoPostTool(server, 'set_special_deal', {
    title: 'Set special deal',
    description: 'WRITE: SetSpecialDeal — create/update special deal discount for accountId.',
    endpoint: 'SetSpecialDeal',
    annotations: writeHint,
    inputSchema: z.object({
      accountId,
      specialDeal: jsonObject.describe('SimpleSpecialDealRequest payload'),
    }),
  });
}
