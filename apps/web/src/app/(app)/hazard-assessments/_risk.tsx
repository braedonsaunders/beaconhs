// The risk model moved to a shared, tenant-configurable module so it can be
// driven by the matrix editor (/hazard-assessments/risk-matrix) and reused
// outside this folder (e.g. /my/hazard-assessments). This file stays as the
// module's local entry point — every `./_risk` / `../_risk` import below keeps
// resolving here.

export * from '@/components/risk-matrix'
