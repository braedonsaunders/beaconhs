// @beaconhs/analytics — root entrypoint (PURE / isomorphic).
//
// Everything exported from here is runtime-free of drizzle/postgres and safe to
// import from client bundles: the BHQL zod validator, the semantic registry, the
// result contract, and (added in a later phase) the visualization registry,
// chart-spec and conditional-formatting helpers.
//
// The SQL compiler + executor live behind the "@beaconhs/analytics/server"
// subpath so a client file can NEVER pull the database engine into the browser.

export * from './result'
export * from './semantic'
export * from './ast-schema'
export * from './expr-parser'
export * from './viz/registry'
export * from './viz/chart-spec'
export * from './viz/conditional-format'
