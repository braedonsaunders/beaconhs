// ETL configuration: legacy MSSQL source databases, their target tenant, and connection settings.
// Secrets are read from env (see .env / .env.example) — never hard-coded here.

export type SourceDbName = 'beaconHS' | 'toolCRIB' | 'peopleApp' | 'ExternalTraining'

export const SOURCE_DBS: SourceDbName[] = ['beaconHS', 'toolCRIB', 'peopleApp', 'ExternalTraining']

/** Which new-system tenant each legacy source database loads into. */
export const TENANT_SLUG_BY_DB: Record<SourceDbName, 'rassaun' | 'external-training'> = {
  beaconHS: 'rassaun',
  toolCRIB: 'rassaun',
  peopleApp: 'rassaun',
  ExternalTraining: 'external-training',
}

function env(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback
  if (v == null) throw new Error(`Missing required env var ${key}`)
  return v
}

/** mssql connection config for a given legacy database. */
export function mssqlConfig(database: SourceDbName) {
  return {
    server: env('ETL_MSSQL_HOST', '10.0.0.44'),
    port: Number(env('ETL_MSSQL_PORT', '1433')),
    user: env('ETL_MSSQL_USER', 'webapp'),
    password: env('ETL_MSSQL_PASSWORD'),
    database,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    requestTimeout: 180000,
    connectionTimeout: 20000,
    pool: { max: 4, min: 0, idleTimeoutMillis: 30000 },
  }
}

/** Target Postgres (the cluster) connection string. */
export function targetUrl(): string {
  return env('DATABASE_URL')
}

/** Legacy Azure Blob storage (where photos/files live). */
export function azureConfig() {
  return {
    account: process.env.AZURE_STORAGE_NAME ?? null,
    key: process.env.AZURE_STORAGE_KEY ?? null,
    container: process.env.AZURE_STORAGE_CONTAINER ?? null,
    baseUrl: process.env.AZURE_STORAGE_URL ?? null,
  }
}
