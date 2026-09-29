# Employee access smoke checks

## Local run against the Replit development preview

Start the API Server, Sales Operations web, and Sales Operations Mobile workflows, then run:

```sh
pnpm --filter @workspace/scripts run verify-employee-browser
```

The script uses the running preview by default. Set `SMOKE_ORIGIN`, `SMOKE_API_ORIGIN`, or `SMOKE_MOBILE_URL` only when testing a different local environment. Chromium defaults to Replit's installed browser; set `CHROMIUM_PATH` when using another browser binary.

## Isolated CI/release check

The `Employee access smoke check` GitHub Actions workflow runs for pull requests, pushes to `main`/`master`, manual dispatch, and reusable workflow calls. It starts a fresh PostgreSQL 16 service, applies the current schema, and launches the API, Vite web app, and Expo web app. A short-lived, self-signed HTTPS proxy gives all three apps a shared browser origin. The proxy certificate, service logs, and processes are removed at the end of the run.

The workflow is **not a release gate by itself**. To block a merge when employee sign-in fails:

1. Push this project (including `.github/workflows/employee-access-smoke.yml`) to the GitHub repository and open a pull request so the check runs at least once.
2. In the repository settings, protect each release branch (at least `main`, and `master` if used). Require a pull request before merging and require the **Employee access smoke check** status check to pass. Apply the rule to administrators too, and avoid bypass permissions for release authors.
3. Confirm the rule is active by opening a disposable pull request with a deliberately failing smoke check. Verify GitHub reports the check as failed and disables merging, then close the pull request without merging it. Remove the deliberate failure from the disposable branch.

The connected `sales_manage` repository was empty when this guidance was written, and GitHub returned “Upgrade to GitHub Pro or make this repository public to enable this feature” for protection on its private repository. Until the source is pushed, a check has run, and GitHub enables private-repository protection, **merges are not gated**. Do not treat a successful smoke run on its own as proof that the rule is active.

There is currently no GitHub publish workflow to depend on the reusable smoke workflow. If one is added later, have its publish job `needs` a job that calls `.github/workflows/employee-access-smoke.yml` with `workflow_call`; do not publish when that job fails. GitHub branch rules do not prevent someone from publishing directly through Replit.

The CI database and test-only session key are created for that run; they are not Replit Secrets and must never be replaced with production values. Browser contexts are closed without saving traces or screenshots. The smoke test creates random temporary employee accounts and a branch, then removes their database rows in `finally`; the entire CI database is discarded when the job ends.

For a local isolated run, start a disposable PostgreSQL instance, set `DATABASE_URL` to that new empty database, and run `pnpm --filter @workspace/scripts run ci:employee-browser`. Do not point this command at the development or production database: it pushes the schema. If the usual ports are already occupied, set `SMOKE_API_PORT`, `SMOKE_WEB_PORT`, `SMOKE_EXPO_PORT`, and `SMOKE_PROXY_PORT` to four unused ports. The command checks port availability before changing the database.

## Troubleshooting

- Ensure the job's PostgreSQL health check is green before schema push.
- If readiness times out, check the API, web, Expo, and proxy log sections in the failed job output. The shell runner prints bounded log tails only on failure.
- For a local run, verify the three Replit workflows are running and `REPLIT_EXPO_DEV_DOMAIN` is available.
- If CI's browser cannot launch, confirm `pnpm --filter @workspace/scripts exec playwright-core install --with-deps chromium` completed successfully and that the runner has not overridden `CHROMIUM_PATH`.
- The isolated check needs no manager credentials. It will fail explicitly if `DATABASE_URL` is missing or if any UI/API assertion fails.