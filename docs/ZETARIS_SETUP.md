# Connecting Traceon to Zetaris

Traceon's adapter ([src/lib/zetaris.ts](../src/lib/zetaris.ts)) implements the Zetaris SaaS SQL API from the published OpenAPI spec (`https://api.saas.enterprise.zetaris.com/redoc/docs.yaml`):

| Call | Endpoint |
|---|---|
| Run a query | `POST /api/v1.0/query/sql/start` with `{"select": "...", "pageLimit": 100}` |
| Next pages | `GET /api/v1.0/query/sql/page?queryToken=…&pageLimit=100&pageNumber=n` |
| Free cursor | `DELETE /api/v1.0/query/sql/close/{queryToken}` |
| Login (optional) | `GET /api/v1.0/auth/login` (Basic) → `idToken`, refreshed via `/auth/refresh` |

Every call sends `X-Request-ID` (a fresh UUID), `X-Org-ID` and `Authorization: Bearer …`.

## 1. Get a running Zetaris instance

Sign in at https://cloud.enterprise.zetaris.com/login with your hackathon email (OTP). Then pick one:

- **Mini template cluster:** Credentials → add your AWS account (free tier works) → Clusters → Create → Mini Template.
- **Local:** "Run locally" → download the Docker image or installer.

## 2. Load the data

```bash
npm run zetaris:export      # writes exports/zetaris/*.csv
```

| File | Rows |
|---|---|
| `unit_fact.csv` | 180,000 (20 MB) |
| `erp_production_lots.csv` | 60 |
| `supplier_bom_lineage.csv` | 60 |
| `warranty_claims.csv` | 125 |
| `warehouses.csv` | 7 |

In Zetaris, create a database (e.g. `traceon`) and upload each CSV as a table with the same name, using file-store tables or any connected source. Make sure numeric columns (`failed`, `days_in_field`, `unit_count`, `serial_start`, `serial_end`, `serial_num`) are typed as integers.

**Going further:** put the silos in *different* sources (e.g. warranty claims in Postgres, ERP lots in MySQL, units as files). Then map them with `ZETARIS_TABLE_MAP`, and Traceon's joins become true federated queries.

## 3. Configure Traceon

In `.env.local`:

```bash
ZETARIS_API_URL=https://api.saas.enterprise.zetaris.com   # or your cluster's API host; a local install: http://localhost:8888
ZETARIS_ORG_ID=<your org id>
ZETARIS_API_TOKEN=<API token from the Zetaris UI>          # or ZETARIS_USERNAME + ZETARIS_PASSWORD
ZETARIS_SCHEMA=traceon
```

## 4. Verify

```bash
npm run zetaris:check
```

This runs probe queries on Zetaris and on the local mirror and compares their hashes. `parity OK` means the cloud holds exactly the data the demo reasons over. The app's top bar then shows **Zetaris cloud · parity ok**, and every evidence item reads `ZETARIS_CLOUD` along with the exact SQL that was sent.

If a cloud query fails during a demo, that query falls back to the local mirror. The evidence modal shows the reason, so the demo never breaks and is never mislabeled.

## Testing without an account

`npm run zetaris:mock` starts a spec-conformant test double on `:4599`. It enforces the headers and token, pages results, and returns shuffled rows with numbers as strings. Run it in one terminal, and the parity check against it in a second:

```bash
npm run zetaris:mock
ZETARIS_API_URL=http://localhost:4599 ZETARIS_ORG_ID=1234 ZETARIS_API_TOKEN=mock-api-token ZETARIS_SCHEMA=traceon npm run zetaris:check
```

The adapter's tests (`npx tsx --test tests/zetaris.test.mts`) start their own test double and need neither.

## Notes from setting it up

- Your org ID is under **Management → Organisation**.
- A local install (the hackathon's Docker distribution) answers on `http://localhost:8888`: set `ZETARIS_API_URL` to that (the app adds `/api/v1.0`), with org ID 1.
- Warm the cluster before a demo by running every reference-case query once: `npm run zetaris:warm`.
- Pages may be 0- or 1-based. The adapter reads `pageNumber` from the first response, so either works.
