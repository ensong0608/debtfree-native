# Independent Persistence and Recovery Review — 2026-11-07

## Decision

**CHANGES REQUIRED.** The durable journal is a substantial improvement over volatile pending maps, and several key safety properties are present. It is not ready to close the T-054 F1/F5 remediation because retry rejection handling can erase explicit rejection status, bill edit retry can overwrite a newer server version, the recovery UI cannot invoke the implemented retry API, and numeric readback can falsely confirm distinct valid decimal values. Legacy-map corruption and grouped reconciliation recovery also need explicit handling.

This is a local source review. No live backend, migration, build, device, or broad test suite was used. The reported 31/31 focused tests and typecheck are recorded as prior handback evidence, not independent certification. One focused in-memory reproduction was run for decimal equality; details below.

## Findings — prioritized

### F1 — Retry rejection is overwritten as uncertainty (P1)

**Evidence:** `src/finance-storage.ts:207-218`. In the retry error branch, a classified server rejection calls `pendingJournal.markRejected(...)` and then throws. The enclosing catch then sees the still-`dispatched` command and unconditionally updates `failure` to `{ kind: 'uncertain' }` at line 216. `markRejected` does not change `dispatchState`, so the catch condition is true and replaces the definitive rejection. The record becomes an active overlay/count again because `readPending` excludes only `failure.kind === 'rejected'` (`src/finance-storage.ts:89-95`).

**Minimal reproduction:** Create a cache-only, `not_dispatched` bill command; invoke `recoverPendingFinanceWrites({ action: 'retry', commandId })` with a matching session and a fake upsert returning `{ error: { code: '23514', message: 'rejected' } }`. The retry branch marks rejected, throws, and the catch changes it to uncertain. Expected: retained rejected state, excluded from overlays and pending count. Actual source flow: uncertain state, included in overlay/count.

**Required fix:** Preserve the explicit rejection in the catch (for example, only mark uncertain if the latest record is still `dispatched` and not already rejected), and add a focused retry-rejection regression case that asserts journal state, summary, and overlay behavior.

### F2 — Bill edit retry has no revision/CAS protection (P1)

**Evidence:** `src/finance-storage.ts:778-780` stores `bill_upsert` with `expectedVersions: {}`; initial persistence and retry both use `upsert(..., { onConflict: 'id' })` (`src/finance-storage.ts:796`, `195-197`). `savePendingCommand` prevents a second local unresolved command for the same member, but it does not protect against another device/session changing that bill while this device is offline. Retry only checks `dispatchState === 'not_dispatched'` (`finance-storage.ts:185`), not a server revision. An old never-sent edit can therefore overwrite a newer server edit.

**Minimal reproduction:** Device A caches bill revision/content A, edits it offline to B (journal command is never-dispatched); device B updates the same bill remotely to C; Device A invokes retry. The stored upsert payload B replaces C because the retry has no expected revision or conditional update. This is a lost update even though the command was never dispatched by A.

**Required fix:** Do not retry bill edits through unconditional upsert. Add durable bill revision and compare-and-swap semantics/readback conflict resolution, or keep bill edits as `needs_review` with no retry. Do not present unconditional bill upsert as safely retryable. Apply the same review to `bill_delete`, whose delete is also filtered only by ID/user and has no revision guard.

### F3 — Retry API has no reachable Settings action (P1 acceptance gap)

**Evidence:** Storage exposes `recoverPendingFinanceWrites(... action: 'retry')` and supports selected operation kinds (`src/finance-storage.ts:158-220`), but Settings imports the API and only calls it with `action: 'readback'` (`src/screens/SettingsScreen.tsx:303-305`). Settings displays aggregate counts, not operation rows or retry choices (`SettingsScreen.tsx:260-264`, `1038-1045`).

**Minimal reproduction:** Create an offline command with `dispatchState: 'not_dispatched'`, sign in, open Settings → Backup & Recovery. The only recovery control is “Refresh confirmation”; no UI invokes retry or identifies which command is eligible. The command remains pending indefinitely through the shipped user flow.

**Required fix:** Either expose an explicit, owner-checked per-command retry action only for operation kinds proven safe, with clear confirmation/result refresh, or remove the claim that retry is an available recovery contract and provide a concrete manual resolution path. Keep non-idempotent bill edits and unsupported transaction-delete/reconciliation commands out of retry.

### F4 — Readback can falsely confirm distinct valid four-decimal amounts (P1 financial correctness)

**Evidence:** `src/finance/pending-journal.ts:127-138` canonicalizes amount-like fields with JavaScript `Number()` before comparing. The app supports scale-4 currency (CLF; `src/finance/currencies.ts`) and `Money` supports safe minor-unit integers up to `Number.MAX_SAFE_INTEGER` (`src/finance/money.ts:14-16`). At large but still safely representable scale-4 amounts, adjacent minor units can collapse to the same binary float; an uncertain write can then be removed as confirmed despite different server content.

**Reproduction run:** A focused in-memory `createPendingJournal` command with desired amount `900000000000.0003` and authoritative observed amount `900000000000.0002` returned `outcome: "confirmed"` and removed the journal command. Node reports both values as the same Number (`900000000000.0002`). Both are scale-4 amounts and their minor units are below the safe-integer limit. This is a concrete false confirmation, not a test-count inference.

**Required fix:** Compare canonical decimal strings or exact integer minor units/BigInt after currency-aware normalization. Preserve soft-delete matching as presence/absence semantics and continue ignoring server-generated timestamps. Add an adjacent-minor-unit mismatch regression case at the supported precision boundary.

### F5 — Corrupt legacy pending map is silently discarded (P2 data-loss path)

**Evidence:** `src/finance-storage.ts:98-115`. Parse failure is caught by substituting `{}` at line 105, after which the legacy key is removed at line 114. A malformed/truncated legacy map therefore disappears without a review journal entry or preserved raw evidence.

**Minimal reproduction:** Store invalid JSON in `debtfree-pending-txs-v1.<user>`; call `getPendingFinanceOperations(userId)`; migration catches the parse error as empty and removes the legacy key. Summary then reports no operation. This is source-established and does not depend on backend behavior.

**Required fix:** On parse/shape failure, retain or quarantine the original raw value and expose a `needs_review` migration record/diagnostic. Only remove the legacy key after successful, verified migration of every entry.

### F6 — A committed reconciliation can be permanently stranded after a crash (P2 recoverability gap)

**Evidence:** `src/finance/pending-journal.ts:227-252` requires `completeCommandIds` to clear any reconciliation, even when all component rows match. Both automatic load and Settings readback provide only the three complete row snapshots and never populate `completeCommandIds` (`src/finance-storage.ts:337-350`, `169-180`). There is no other caller (`rg completeCommandIds` found only journal/tests). Thus a crash after RPC commit but before journal removal leaves a reconciliation permanently `needs_review`, even after full all-domain readback confirms anchor and adjustment rows. This is conservative against false confirmation, but it is not a reachable resolution path.

**Required fix:** Preserve the group as one command. Supply authoritative proof of the atomic RPC effect (for example, an idempotency/receipt record or server-side readback including the affected debt revision/balance plus all members), or provide an explicit manual review workflow that does not clear it from component rows alone. Do not simply remove the `completeCommandIds` guard.

## Confirmed controls and limits

- **Journal-before-effects and per-user serialization:** Public mutation, load, recovery, and clear operations are wrapped by `withFinanceLock` (`finance-storage.ts:1166-1212`). Each mutation calls `savePendingCommand` before cache or network side effects (for example transaction create at `finance-storage.ts:403-410`; bill upsert at `778-787`; grouped reconciliation at `988-1011`). Journal envelope updates also serialize per store/user (`pending-journal.ts:65-76`, `142-154`). This is an in-process guarantee; no multi-process locking was established.
- **Dispatch state:** Online commands are persisted as `dispatched` before the network call; offline commands as `not_dispatched`. Recovery requires a matching authenticated user and only permits never-dispatched records (`finance-storage.ts:166-186`). Ambiguous network errors remain pending/uncertain rather than automatically replaying. This is conservative.
- **Transactions:** Create uses stable transaction ID as idempotency key. Update/delete carry stored expected account and transaction revisions, but delete has no retry handler and is therefore unrecoverable via explicit retry. No live SQL/deployed RPC behavior was verified.
- **All-domain readback and ownership:** Readback fetches all pages for transactions, recurring bills and anchors using `user_id` equality, and requires complete authoritative snapshots before row evaluation (`finance-storage.ts:144-155`, `169-180`). Session user must equal the requested user (`finance-storage.ts:166-167`). Cache keys and journal envelopes include user identity. This is source-only evidence; backend RLS/deployed ownership was not exercised.
- **Soft deletes:** Transaction member intent uses the timestamped deleted row, but comparator intentionally compares only deleted-vs-active state (`pending-journal.ts:131-138`), which accommodates server-generated deletion timestamps while requiring the other row content to match.
- **Stale cache rebase:** `rebaseFinanceCacheRows` preserves cached IDs absent from a stale caller snapshot and applies explicit overrides/removals (`storage-domain.ts:56-76`); storage merges under the per-user lock (`finance-storage.ts:234-242`). This protects concurrent distinct-ID writes in one app process. Existing tests cover that case.
- **Rejected operations:** Normal mutation rejection is retained separately and excluded from active overlays; readback refuses to turn rejected commands into confirmations (`pending-journal.ts:198-209`, `230-234`). The retry catch bug above is an exception to this guarantee.
- **Sign-out:** Settings checks aggregate active pending count and visible transaction `isPending`, then warns before sign-out (`SettingsScreen.tsx:479-500`). Ownership mismatch and status read failures fail closed by surfacing an alert. It does not offer per-command review/retry; rejected entries are separately counted/displayed but do not block sign-out.
- **Grouped reconciliation:** Reconciliation is journaled as one command with anchor and optional adjustment transaction members (`finance-storage.ts:981-990`); row matching alone does not clear it (`pending-journal.ts:227-252`). No false group confirmation path was found in current callers. The gap is inability to finish recovery, not accidental splitting or optimistic success.
- **Same-record collision:** `savePendingCommand` refuses overlapping unresolved member rows (`finance-storage.ts:120-127`). Journal IDs are checked for duplicates on save (`pending-journal.ts:145-152`). This does not supply server-side bill revision protection (F2).

## Suggested closeout order

1. Fix retry rejection state preservation (F1) and bill retry concurrency semantics (F2).
2. Use exact decimal comparison for readback (F4).
3. Add an actual Settings recovery path or narrow the retry claim (F3), with grouped reconciliation resolution (F6).
4. Preserve malformed legacy intent for review (F5).
5. Add focused regression checks for these cases; rerun only the affected focused suites and typecheck after the implementer changes. No deployed correctness claim until isolated backend behavior is separately verified.

## Final persistence recheck — 2026-11-07 (T-059-P2)

**Decision: CHANGES REQUIRED.** One concrete bill-delete readback failure can falsely confirm a deletion and remove its journal entry. In `src/finance-storage.ts:952-962`, a zero-row CAS delete triggers a select, but `readback.error` is ignored and null data becomes an empty array; the command is then removed as confirmed. The catch recovery repeats this at `:963-970`: a rejected select with `{ data: null, error: ... }` is treated as proof of absence even after a failed or ambiguous delete. A changed bill can therefore remain on the server while the client reports a successful deletion. Narrow fix: require a successful authoritative select before concluding absence in both branches; on readback error retain the command as uncertain/needs review. Add focused regression coverage for both paths using the production storage contract, then rerun the affected focused checks and typecheck.

The six original findings were otherwise rechecked against source: F1 preserves rejection in the retry catch (`finance-storage.ts:248-257`); F2 uses insert for creation and owner/id/original revision CAS for edits and deletes, with original `currentBills` passed through the production extracted command (`recurring-bills.ts:41-60`, `finance-commands.ts:272-292`, `finance-storage.ts:818-857, 927-949`), and bills remain excluded from retry (`:163-174`). F3 Settings uses that predicate and actual `command.resolution`, with reachable retry and explicit manual adoption (`SettingsScreen.tsx:320-346, 1084-1100`). F4 uses decimal-string canonicalization and full-row matching, including both bill lost-response paths (`pending-journal.ts:130-154`, `finance-storage.ts:863, 894`). F5 retains invalid raw legacy data in a diagnostic and excludes it from overlays (`finance-storage.ts:88-120`). F6 preserves grouped commands without atomic proof and archives explicitly acknowledged server-state adoption with evidence, rather than claiming group success (`pending-journal.ts:225-249, 271-290`). Resolved and rejected commands are separately counted and excluded from active overlays (`pending-journal.ts:209-218`, `finance-storage.ts:88-95`).

The requested existing focused suites passed **32/32**, and `npm.cmd run typecheck` passed. The bill contract tests invoke `executeRecurringBillSave`/`executeRecurringBillRemoval` with the storage adapter and original bills; they do not cover failed delete readback. No live backend, build, device, full suite, or deployed behavior was verified. Runtime/device acceptance, deployed RPC/RLS and revision behavior, and authenticated atomic full-backup restore with receipt verification remain separate gates.

## Manager correction after T-059-P2 — 2026-11-07

The remaining delete-readback defect was corrected in both the zero-row CAS branch and error-recovery branch. A readback error or missing array is now treated as unavailable evidence; it cannot prove absence, and the durable deletion stays uncertain/needs_review. Two injected-boundary regression cases exercise zero affected rows followed by failed readback, and a delete error followed by failed readback. Both assert the journal remains active and the result is not synced.

Manager verification after the correction: `node --test tests/finance-pending-journal.test.mjs tests/finance-storage-persistence.test.mjs tests/finance-persistence.test.mjs` passed **34/34**, followed by `npm.cmd run typecheck` passing. The six original findings have reviewed corrections; the additional deletion defect is closed at source/focused-test level. This does not verify a live/deployed database, native device behavior, or atomic full-backup restore.
