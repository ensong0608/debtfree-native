# DebtFree public pages — review draft

These static pages are a local review draft for the official Help, Privacy, Terms, and account-deletion URLs. They are not published and must not be deployed while the draft banner or any `[[...]]` placeholder remains.

Each HTML file also has a `noindex` directive while it is a draft. Remove the draft banners and `noindex` directives only after all facts and contact paths have been verified for the public release.

## Proposed paths

Once the owner selects the official domain and hosting, map these folders to:

- `/help/` → `help/index.html`
- `/privacy/` → `privacy/index.html`
- `/terms/` → `terms/index.html`
- `/delete-account/` → `delete-account/index.html`

The intended paths match the URL settings in `.env.example`. No domain, DNS, or hosting has been configured.

## Owner details required before publication

- `[[LEGAL_OPERATOR_NAME]]`: legal person or organization responsible for DebtFree.
- `[[SUPPORT_EMAIL]]`: working public support address.
- `[[PRIVACY_CONTACT_EMAIL]]`: working privacy-request contact (may be the support address).
- `[[EFFECTIVE_DATE]]`: date the reviewed policy and terms take effect.
- `[[GOVERNING_LAW]]`: governing jurisdiction for the terms, selected with appropriate legal review.
- `[[RETENTION_PERIOD]]` and `[[RETENTION_EXCEPTIONS]]`: verified retention and deletion behavior, including service-provider backups/logs and any lawful exceptions.
- `[[AGE_POLICY]]`: intended age group and any minimum-age requirement.
- `[[DELETION_COMPLETION_WINDOW]]`: realistic completion time for manually handled web requests.
- `[[OFFICIAL_DOMAIN]]`: chosen domain and matching HTTPS URLs.

The deletion page uses a `mailto:` link because this repository has no external deletion-request API. It becomes a working web request path only after a real support address is supplied and tested. The in-app deletion endpoint is source-complete and passed a synthetic local test, but it has not been deployed to the chosen Supabase project.

## Current-source fact check (2026-11-11)

- The current app supports Google sign-in and Apple sign-in on iOS, and uses Supabase Auth and database services.
- Users manually enter household settings, income and extra-payment preferences, debt accounts and terms, recurring bills, transactions, and reconciliation records. The current release does not connect to a bank or import bank transactions.
- The app keeps authentication/session material, preferences, and a per-user offline financial cache (including pending changes) through the platform secure-storage API. It synchronizes app records with the configured Supabase project.
- No analytics or advertising SDK was found in the reviewed application source. Recheck the complete production dependency and SDK inventory before completing a store Data safety declaration.
- Account deletion is available in Settings when the build has its server function configured. The local synthetic account-deletion check verified Auth and user-owned rows are removed; production deployment, provider backup/log retention, and the public request channel remain unverified.
- Backup export/restore, store listing details, retention commitments, legal operator identity, support contact, and jurisdiction require owner review before these drafts can become public policies.

These notes are implementation observations, not legal advice and not a substitute for checking the final release artifact and third-party service terms.
