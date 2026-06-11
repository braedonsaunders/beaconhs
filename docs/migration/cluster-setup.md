# New Postgres cluster — setup & access

Target for the migration + the local-dev database (one DB serves both; there is no separate prod yet).

|                                   |                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------ |
| Host                              | `10.0.0.85:5432`                                                               |
| Superuser                         | `postgres`                                                                     |
| Other roles                       | `replicator`, `rewind_user`, `admin`                                           |
| Speaks SSL?                       | **No** — server has SSL disabled; connect with `sslmode=disable` / `ssl:false` |
| App database                      | `beaconhs` (to be created — see `scripts/cluster/provision.sql`)               |
| Maintenance DB in the conn string | `rassaun` (existing; holds FDW user-mappings + pgstudio meta)                  |

## Blocker: pg_hba.conf does not allow this Mac

This dev machine reaches the `10.0.0.0/24` LAN over a **VPN tunnel** and the cluster sees it as source
IP **`10.255.0.2`** (verified: local `inet 10.255.0.2`, and the server returns
`no pg_hba.conf entry for host "10.255.0.2", user "postgres"`). The cluster also **does not offer SSL**,
so `hostssl` rules don't apply. Nothing can connect from here until an `host` rule is added.

**Fix (on the cluster's primary, as an admin):** add a line to `pg_hba.conf` and reload — e.g.

```conf
# allow the VPN range (or just this host /32) over plaintext on the LAN
host    all    all    10.255.0.0/24    scram-sha-256
```

```sql
SELECT pg_reload_conf();   -- or: sudo systemctl reload postgresql / pg_ctl reload
```

For a managed/CNPG-style cluster, add the rule to the cluster manifest's `pg_hba` section instead and let
the operator reconcile. **Alternative** (no hba change): give this box access via an SSH tunnel through a
host that is already whitelisted (e.g. `ssh -L 5432:10.0.0.85:5432 user@<lan-host>` then point
`DATABASE_URL` at `localhost:5432`).

Verify once allowed:

```bash
pnpm --filter @beaconhs/etl etl cluster-check     # expects: OK connected
```

## Provisioning (after access is granted)

1. **Inspect first** — confirm whether the existing `rassaun` DB is meant to be the app DB or if we
   create a fresh `beaconhs`. The plan assumes a fresh `beaconhs`.
2. **Create role + DB + extensions:**
   ```bash
   psql "postgres://postgres:***@10.0.0.85:5432/postgres" \
     -v app_password="'<strong-password>'" -f scripts/cluster/provision.sql
   ```
3. **Point `.env`:** `DATABASE_URL=postgresql://beaconhs_app:<pw>@10.0.0.85:5432/beaconhs?sslmode=disable`
4. **Create schema + RLS:** `pnpm --filter @beaconhs/db migrate`
5. **Bootstrap tenants + etl schema:** `pnpm --filter @beaconhs/etl etl bootstrap`

## ⚠ Decision: enforce RLS for two tenants

The app isolates tenants with **RLS only**. A table owner bypasses non-forced RLS, so importing
`rassaun` **and** `external-training` into one DB requires RLS to actually be enforced for the app's
connection. Choose **(A) FORCE RLS** (recommended — add `FORCE ROW LEVEL SECURITY` to
`packages/db/src/rls.ts` `RLS_POLICY_SQL`) or **(B) a non-owner app role**. See the banner in
`scripts/cluster/provision.sql`. This must be settled before go-live; it does not affect import
correctness (every imported row carries an explicit `tenant_id`).
