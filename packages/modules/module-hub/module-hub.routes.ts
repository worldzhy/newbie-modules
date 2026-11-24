/**
 * Module-hub HTTP routes, shared by the controllers and by host provisioning.
 *
 * The route belongs to the module, not to the host: host code that advertises
 * the report endpoint (for example a platform injecting
 * `NW_MODULE_HUB_ENDPOINT`) appends `MODULE_HUB_REPORTS_PATH` to its public API
 * URL instead of repeating the literal path. A rename then happens in one
 * place, and a host-side consistency test can assert the assembled URL ends
 * with this constant (ADR-076).
 */
export const MODULE_HUB_ROUTES = {
  /** Controller prefix shared by the reports, me and installation controllers. */
  controller: "module-hub",
  /** Self-report endpoint mounted under the controller prefix. */
  reports: "reports",
} as const;

/** Absolute report path, e.g. `/module-hub/reports`. */
export const MODULE_HUB_REPORTS_PATH = `/${MODULE_HUB_ROUTES.controller}/${MODULE_HUB_ROUTES.reports}`;
