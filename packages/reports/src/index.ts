// BeaconHS owns only the HSE entity catalogue and database adapter. The report
// definition, compiler, studio, paper viewer, schedules, and result contracts
// come directly from AppKit.
export * from '@braedonsaunders/appkit-reports'
export {
  BEACON_REPORT_CATALOG,
  REPORT_ENTITIES,
  REPORT_ENTITY_MAP,
  columnRef,
  entityColumn,
  entityColumnSql,
  isTechnicalIdentifierColumn,
  mergeAuthorizedReportSources,
} from './entities'
export type { ReportColumnKind, ReportEntityCatalog, ReportEntityColumn } from './entities'
export {
  reportExportMode,
  reportExportsCredentialFronts,
  type ReportExportMode,
} from './export-mode'
export {
  MAX_REPORT_WALLET_CARDS,
  parseWalletCardPersonName,
  reportSupportsWalletCards,
  walletCardLookupsFromResult,
  type WalletCardLookup,
} from './wallet-cards'
