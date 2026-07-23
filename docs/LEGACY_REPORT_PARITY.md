# Legacy report parity

This is the clean-cutover inventory for the legacy BeaconHS report screens and
scheduled reports. A green row has a production replacement. Equipment charges
and ROI are intentionally not implemented because equipment financials are
owned outside BeaconHS.

All replacements in the Reports module support an in-app paginated preview,
CSV, Excel, PDF, one-time PDF email, and scheduled PDF delivery. Filters chosen
while viewing a report carry into a new subscription and are saved on every
scheduled run.

| Legacy report                              | Canonical replacement                                  | Runtime filters and grouping                                                                                           | Output parity                             | Status                                                     |
| ------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| Training Certificates — Matrix             | Insights card: **Training — Certificate Matrix**       | Live active-employee × course pivot with latest certificate status                                                     | Live pivot, CSV, PDF                      | ✅ Replaced in Insights; intentionally absent from Reports |
| Training Certificates — Certificates       | Report: **Training — Certificates**                    | Employee, people group, department, course, course type, delivery type, include expired; group by course or employee   | Preview, CSV, Excel, PDF, email, schedule | ✅                                                         |
| Training Certificates — Expired & Upcoming | Report: **Training — Expired & Upcoming**              | Employee, people group, department, course, course type, delivery type, 30–365 day window; group by course or employee | Preview, CSV, Excel, PDF, email, schedule | ✅                                                         |
| Training Certificates — Missing            | Report: **Training — Missing**                         | Employee, people group, department, assigned course, course type, delivery type; group by course or employee           | Preview, CSV, Excel, PDF, email, schedule | ✅                                                         |
| Training Skills — Matrix                   | Report: **Skills — Matrix**                            | Employee, people group, department, skill, issuing authority; group by employee, skill, or authority                   | Preview, CSV, Excel, PDF, email, schedule | ✅                                                         |
| Training Skills — Expired & Upcoming       | Report: **Skills — Expired & Upcoming**                | Employee, people group, department, skill, issuing authority, 30–365 day window; group by employee or skill            | Preview, CSV, Excel, PDF, email, schedule | ✅                                                         |
| Training Skills — Missing                  | Report: **Skills — Missing & Expired**                 | Employee, people group, department, required skill, issuing authority; group by employee or skill                      | Preview, CSV, Excel, PDF, email, schedule | ✅                                                         |
| Training Skills — CWB                      | Report: **Skills — CWB (Welding)**                     | Employee, people group, department, skill, issuing authority, CWB standard; group by employee or skill                 | Preview, CSV, Excel, PDF, email, schedule | ✅                                                         |
| Compliance — By Entity                     | Report: **Compliance — By Entity**                     | Requirement, source module, employee, people group, department, status, from/to date                                   | Preview, CSV, Excel, PDF, email, schedule | ✅                                                         |
| Compliance — By Person                     | Report: **Compliance — By Person**                     | Requirement, source module, employee, people group, department, status, from/to date                                   | Preview, CSV, Excel, PDF, email, schedule | ✅                                                         |
| Hazard ID — Signatures                     | Report: **Hazard ID — Signatures**                     | Employee, people group, department, status, from/to date                                                               | Preview, CSV, Excel, PDF, email, schedule | ✅                                                         |
| Inspections — Completed                    | Report: **Inspections — Completed**                    | Date range; native inspection records grouped by inspection type with linked Location and free-text Location on site   | Preview, CSV, Excel, PDF, email, schedule | ✅                                                         |
| Corrective Actions — List                  | Report: **Corrective Actions — List**                  | Owner, people group, department, location, status; group by status, location, or employee                              | Preview, CSV, Excel, PDF, email, schedule | ✅                                                         |
| PPE — List                                 | Report: **PPE — List**                                 | Holder, people group, department, PPE type; group by PPE type or employee                                              | Preview, CSV, Excel, PDF, email, schedule | ✅                                                         |
| PPE — Expired & Upcoming                   | Report: **PPE — Expired & Upcoming**                   | Holder, people group, department, PPE type, 30–365 day window; group by PPE type or employee                           | Preview, CSV, Excel, PDF, email, schedule | ✅                                                         |
| Equipment — Fleet                          | Report: **Equipment — Fleet**                          | No legacy runtime selector; canonical fleet view includes type, site, holder, usage, and inspection state              | Preview, CSV, Excel, PDF, email, schedule | ✅                                                         |
| Equipment — Upcoming Inspections           | Report: **Equipment — Upcoming & overdue inspections** | No legacy runtime selector; overdue and next-30-day scope is part of the definition                                    | Preview, CSV, Excel, PDF, email, schedule | ✅                                                         |
| Equipment — Upcoming Oil Change            | Report: **Equipment — Upcoming & overdue oil changes** | No legacy runtime selector; overdue and next-30-day scope is part of the definition                                    | Preview, CSV, Excel, PDF, email, schedule | ✅                                                         |
| Equipment — ROI                            | None                                                   | Legacy category selector is not migrated                                                                               | None                                      | Intentionally missing                                      |
| Equipment — Charges                        | None                                                   | Not migrated                                                                                                           | None                                      | Intentionally missing                                      |

## Cutover rules

- The training certificate matrix has one implementation: the managed Insights
  pivot card. There is no default report definition or report runner for it.
- Global built-in report slugs are unique. The parity migration repoints
  schedules from any older tenant-owned built-in duplicate to the canonical
  global definition, then removes only those duplicate system rows.
- Tenant-created custom reports are not changed by duplicate cleanup.
- Course type is a first-class course field. It is distinct from delivery type
  and is available to certificate report filters.
- Report filters are normalized and bounded on the server for direct runs,
  exports, one-time email runs, saved schedules, and worker execution.
