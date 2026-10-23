/**
 * ALSO Cloud Simple API endpoints from MarketplaceSimpleAPI 1.0.0.
 * Dedicated MCP tools cover high-value reads and selected writes.
 * Destructive ops stay on api_request only.
 */
export type ApiEndpointInfo = {
  endpoint: string;
  tag: string;
  summary: string;
  /** Prefer a dedicated MCP tool when set */
  tool?: string;
  /** write | destructive */
  risk?: 'write' | 'destructive';
};

export const API_CATALOG: ApiEndpointInfo[] = [
  // Authenticate
  { endpoint: 'GetSessionToken', tag: 'Authenticate', summary: 'Returns a session token.' },
  { endpoint: 'TerminateSessionToken', tag: 'Authenticate', summary: 'Ends the session of the token.', tool: 'clear_session' },
  { endpoint: 'PingPong', tag: 'Authenticate', summary: 'Validates a session.', tool: 'validate_session' },

  // Company
  { endpoint: 'GetCompany', tag: 'Company', summary: 'Gets a company by Account ID.', tool: 'get_company' },
  { endpoint: 'GetCompanies', tag: 'Company', summary: 'Lists companies under parent Account ID.', tool: 'get_companies' },
  { endpoint: 'GetCompanyByVatId', tag: 'Company', summary: 'Gets a company by VAT ID.', tool: 'get_company_by_vat_id' },
  { endpoint: 'CreateCompany', tag: 'Company', summary: 'Creates a company.', tool: 'create_company', risk: 'write' },
  { endpoint: 'UpdateCompany', tag: 'Company', summary: 'Updates company details.', tool: 'update_company', risk: 'write' },

  // Reseller
  { endpoint: 'GetReseller', tag: 'Reseller', summary: 'Gets a reseller by Account ID.', tool: 'get_reseller' },
  { endpoint: 'GetResellers', tag: 'Reseller', summary: 'Lists resellers under parent Account ID.', tool: 'get_resellers' },
  { endpoint: 'GetResellerByVatId', tag: 'Reseller', summary: 'Gets a reseller by VAT ID.', tool: 'get_reseller_by_vat_id' },
  { endpoint: 'CreateReseller', tag: 'Reseller', summary: 'Creates a reseller.', tool: 'create_reseller', risk: 'write' },
  { endpoint: 'UpdateReseller', tag: 'Reseller', summary: 'Updates reseller details.', tool: 'update_reseller', risk: 'write' },

  // Departments
  { endpoint: 'GetDepartment', tag: 'Departments', summary: 'Gets a department by Account ID.', tool: 'get_department' },
  { endpoint: 'GetDepartments', tag: 'Departments', summary: 'Lists departments under parent Account ID.', tool: 'get_departments' },
  { endpoint: 'CreateDepartment', tag: 'Departments', summary: 'Creates a department.', tool: 'create_department', risk: 'write' },
  { endpoint: 'UpdateDepartment', tag: 'Departments', summary: 'Updates a department.', tool: 'update_department', risk: 'write' },

  // User
  { endpoint: 'GetUser', tag: 'User', summary: 'Gets a user by Account ID.', tool: 'get_user' },
  { endpoint: 'GetUsers', tag: 'User', summary: 'Lists users under company Account ID.', tool: 'get_users' },
  { endpoint: 'CreateUser', tag: 'User', summary: 'Creates a user under selected parent.', tool: 'create_user', risk: 'write' },
  { endpoint: 'UpdateUser', tag: 'User', summary: 'Updates user settings.', tool: 'update_user', risk: 'write' },

  // Subscription
  { endpoint: 'GetSubscription', tag: 'Subscription', summary: 'Gets subscription by Account ID.', tool: 'get_subscription' },
  { endpoint: 'GetSubscriptions', tag: 'Subscription', summary: 'Lists subscriptions under Account ID.', tool: 'get_subscriptions' },
  { endpoint: 'GetSubscriptionWithAddons', tag: 'Subscription', summary: 'Gets subscription with addons.', tool: 'get_subscription_with_addons' },
  { endpoint: 'GetSubscriptionDependencies', tag: 'Subscription', summary: 'Gets subscription dependency accounts.' },

  // Subscription management
  { endpoint: 'GetPossibleServicesForParent', tag: 'Subscription management', summary: 'Services a parent can subscribe to.', tool: 'get_possible_services_for_parent' },
  { endpoint: 'GetFieldsForService', tag: 'Subscription management', summary: 'Fields for subscription creation.', tool: 'get_fields_for_service' },
  { endpoint: 'ValidateFields', tag: 'Subscription management', summary: 'Validates a subscription.', tool: 'validate_subscription_fields', risk: 'write' },
  { endpoint: 'GetRemoteEnums', tag: 'Subscription management', summary: 'Remote enum values for a field.' },
  { endpoint: 'CreateSubscription', tag: 'Subscription management', summary: 'Creates a subscription.', tool: 'create_subscription', risk: 'write' },
  { endpoint: 'UpdateSubscription', tag: 'Subscription management', summary: 'Updates a service subscription.', tool: 'update_subscription', risk: 'write' },

  // Subscription actions
  { endpoint: 'GetAccountCustomActionsWithFields', tag: 'Subscription actions', summary: 'Custom action list for a subscription.', tool: 'get_account_custom_actions' },
  { endpoint: 'GetRemoteEnumValuesForCustomAction', tag: 'Subscription actions', summary: 'Remote enums for custom action fields.' },
  { endpoint: 'ExecuteAccountCustomAction', tag: 'Subscription actions', summary: 'Executes a custom action.', tool: 'execute_account_custom_action', risk: 'write' },
  { endpoint: 'RetryLastFailedProvisioning', tag: 'Subscription actions', summary: 'Retries last failed provisioning.', tool: 'retry_last_failed_provisioning', risk: 'write' },

  // Credit check
  { endpoint: 'GetCreditLimit', tag: 'Credit check', summary: 'Gets credit limit for company.', tool: 'get_credit_limit' },
  { endpoint: 'SetCreditLimit', tag: 'Credit check', summary: 'Sets credit limit for company.', tool: 'set_credit_limit', risk: 'write' },
  { endpoint: 'ListCreditCheckOrdersForApproval', tag: 'Credit check', summary: 'Lists credit check orders for approval.', tool: 'list_credit_check_orders_for_approval' },
  { endpoint: 'ApproveCreditCheckOrder', tag: 'Credit check', summary: 'Approves a credit check order.', tool: 'approve_credit_check_order', risk: 'write' },
  { endpoint: 'DeclineCreditCheckOrder', tag: 'Credit check', summary: 'Declines a credit check order.', tool: 'decline_credit_check_order', risk: 'write' },

  // Reports and Invoices
  { endpoint: 'GetReports', tag: 'Reports and Invoices', summary: 'Returns available reports.', tool: 'get_reports' },
  { endpoint: 'ExecuteReport', tag: 'Reports and Invoices', summary: 'Executes a named report.', tool: 'execute_report' },
  { endpoint: 'GetLatestInvoices', tag: 'Reports and Invoices', summary: 'Latest invoices for authenticated account.', tool: 'get_latest_invoices' },
  { endpoint: 'GetLatestInvoicesForPeriod', tag: 'Reports and Invoices', summary: 'Invoices for year/month.', tool: 'get_latest_invoices_for_period' },
  { endpoint: 'GetPreviewInvoices', tag: 'Reports and Invoices', summary: 'Preview invoices for current open month.', tool: 'get_preview_invoices' },
  { endpoint: 'GetInvoiceAggregationReport', tag: 'Reports and Invoices', summary: 'Invoice aggregation lines for a period.', tool: 'get_invoice_aggregation_report' },
  { endpoint: 'GetAllProductAccountsWithFieldsReport', tag: 'Reports and Invoices', summary: 'Product accounts and fields report.' },

  // Marketplaces / services
  { endpoint: 'GetMarketplaces', tag: 'Marketplaces', summary: 'Company-owned marketplaces.', tool: 'get_owned_marketplaces' },
  { endpoint: 'CreateMarketplace', tag: 'Marketplaces', summary: 'Creates a marketplace.', risk: 'write' },
  { endpoint: 'DeleteMarketplace', tag: 'Marketplaces', summary: 'Deletes a marketplace.', risk: 'destructive' },
  { endpoint: 'ListMarketplaceServices', tag: 'Marketplace services', summary: 'Lists services for a marketplace.', tool: 'list_marketplace_services' },
  { endpoint: 'GetAvailableServicesForMarketplace', tag: 'Marketplace services', summary: 'Available services for a marketplace.', tool: 'get_available_services_for_marketplace' },
  { endpoint: 'GetServiceInformation', tag: 'Marketplace services', summary: 'Service info by service name.', tool: 'get_service_information' },
  { endpoint: 'GetSpecialProductTermsForService', tag: 'Marketplace services', summary: 'Terms and related products for a service.' },
  { endpoint: 'AcceptTermsForMarketplaceService', tag: 'Marketplace services', summary: 'Accept T&Cs for marketplace service.', risk: 'write' },
  { endpoint: 'AddMarketplaceServices', tag: 'Marketplace services', summary: 'Add services to marketplace.', risk: 'write' },
  { endpoint: 'UpdateMarketplaceServices', tag: 'Marketplace services', summary: 'Update marketplace services.', risk: 'write' },
  { endpoint: 'DeleteMarketplaceServices', tag: 'Marketplace services', summary: 'Remove services from marketplace.', risk: 'destructive' },
  { endpoint: 'DeleteMarketplaceService', tag: 'Marketplace services', summary: 'Remove one service from marketplace.', risk: 'destructive' },
  { endpoint: 'GetMarketplaceServiceCharges', tag: 'Marketplace price management', summary: 'Gets marketplace service charges.' },
  { endpoint: 'UpdateMarketplaceServiceCharges', tag: 'Marketplace price management', summary: 'Updates marketplace service charges.', risk: 'write' },

  // Security / Special Deal / Upgrade / Renew
  { endpoint: 'GetSecurityRoles', tag: 'Security', summary: 'Security roles for company/reseller.', tool: 'get_security_roles' },
  { endpoint: 'UpdateSecurityRolesUsers', tag: 'Security', summary: 'Updates security role users.', risk: 'write' },
  { endpoint: 'GetSpecialDeal', tag: 'Special Deal', summary: 'Special deal discounts for account.', tool: 'get_special_deal' },
  { endpoint: 'SetSpecialDeal', tag: 'Special Deal', summary: 'Creates a special deal discount.', tool: 'set_special_deal', risk: 'write' },
  { endpoint: 'DeleteSpecialDeal', tag: 'Special Deal', summary: 'Deletes special deal discounts.', risk: 'destructive' },
  { endpoint: 'GetPossibleServicesForUpgrade', tag: 'Upgrade', summary: 'Possible upgrade services for account.', tool: 'get_possible_services_for_upgrade' },
  { endpoint: 'GetSubscriptionFieldsForUpgrade', tag: 'Upgrade', summary: 'Fields for upgrade.', tool: 'get_subscription_fields_for_upgrade' },
  { endpoint: 'ExecuteSubscriptionUpgrade', tag: 'Upgrade', summary: 'Executes subscription upgrade.', tool: 'execute_subscription_upgrade', risk: 'write' },
  { endpoint: 'GetSubscriptionFieldsForRenew', tag: 'Renew', summary: 'Fields for renew view.', tool: 'get_subscription_fields_for_renew' },
  { endpoint: 'ConfigureSubscriptionRenew', tag: 'Renew', summary: 'Configures renew field values.', tool: 'configure_subscription_renew', risk: 'write' },
  { endpoint: 'ResetDefaultRenewValues', tag: 'Renew', summary: 'Resets saved renew values.', tool: 'reset_default_renew_values', risk: 'write' },

  // Terminate
  { endpoint: 'TerminateAccount', tag: 'Terminate account', summary: 'Terminates Reseller/Company/Department/User/Service.', risk: 'destructive' },
];
