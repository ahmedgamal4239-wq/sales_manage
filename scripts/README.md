# Employee access smoke checks

## Local run against the Replit development preview

Start the API Server, Sales Operations web, and Sales Operations Mobile workflows, then run:

```sh
pnpm --filter @workspace/scripts run verify-employee-browser
```

The script uses the running preview by default. Set `SMOKE_ORIGIN`, `SMOKE_API_ORIGIN`, or `SMOKE_MOBILE_URL` only when testing a different local environment. Chromium defaults to Replit's installed browser; set `CHROMIUM_PATH` when using another browser binary.

## Isolated CI/release check

The `Employee access smoke check` GitHub Actions workflow runs for pull requests, pushes to `main`/`master`, manual dispatch, and reusable workflow calls. It starts a fresh PostgreSQL 16 service, applies the current schema, and launches the API, Vite web app, and Expo web app. A short-lived, self-signed HTTPS proxy gives all three apps a shared browser origin. The proxy certificate, service logs, and processes are removed at the end of the run.

The **Employee access smoke check** is a required status check on the GitHub repository's `main` branch, which is currently the only release branch. Branch protection requires pull requests, applies to administrators, requires this check to pass, and disallows force pushes and branch deletion. Protect any additional release branch before using it.

This gate was verified with a disposable pull request whose smoke check was deliberately failed: GitHub marked the pull request as blocked from merging. The pull request was closed without merging, and its temporary branch was removed. On future pull requests, confirm the check is green before merging; a pending or failed check blocks the merge.

There is currently no GitHub publish workflow to depend on the reusable smoke workflow. If one is added later, have its publish job `needs` a job that calls `.github/workflows/employee-access-smoke.yml` with `workflow_call`; do not publish when that job fails. GitHub branch rules do not prevent someone from publishing directly through Replit.

The CI database and test-only session key are created for that run; they are not Replit Secrets and must never be replaced with production values. Browser contexts are closed without saving traces or screenshots. The smoke test creates random temporary employee accounts and a branch, then removes their database rows in `finally`; the entire CI database is discarded when the job ends.

For a local isolated run, start a disposable PostgreSQL instance, set `DATABASE_URL` to that new empty database, and run `pnpm --filter @workspace/scripts run ci:employee-browser`. Do not point this command at the development or production database: it pushes the schema. If the usual ports are already occupied, set `SMOKE_API_PORT`, `SMOKE_WEB_PORT`, `SMOKE_EXPO_PORT`, and `SMOKE_PROXY_PORT` to four unused ports. The command checks port availability before changing the database.

## Troubleshooting

- Ensure the job's PostgreSQL health check is green before schema push.
- If readiness times out, check the API, web, Expo, and proxy log sections in the failed job output. The shell runner prints bounded log tails only on failure.
- Keep `BROWSER=none` on the Expo CI process: Expo's `--web` option must not launch its own desktop browser in the headless runner; Playwright opens the app for the smoke test.
- For a local run, verify the three Replit workflows are running and `REPLIT_EXPO_DEV_DOMAIN` is available.
- If CI's browser cannot launch, confirm `pnpm --filter @workspace/scripts exec playwright-core install --with-deps chromium` completed successfully and that the runner has not overridden `CHROMIUM_PATH`.
- The isolated check needs no manager credentials. It will fail explicitly if `DATABASE_URL` is missing or if any UI/API assertion fails.