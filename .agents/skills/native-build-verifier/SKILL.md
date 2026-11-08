# Native Build & Verifier Skill

## Description
Targeted verification matrix, type-checking, linting, and Android/Expo build troubleshooting procedures for `debtfree-native`.

---

## 1. Targeted Verification Matrix (Fastest to Heaviest)

Always prefer running the lightest verification command that confirms the change:

| Changed Scope | Recommended Verification Command | Typical Runtime |
|---|---|---|
| **TypeScript types / interfaces** | `npm run typecheck` | ~3 seconds |
| **Code style / formatting** | `npm run lint` | ~4 seconds |
| **Financial / Ledger math** | `node --test tests/finance-primitives.test.mjs tests/finance-phase1.test.mjs` | ~1 second |
| **Payoff / Amortization logic** | `node --test tests/finance-payoff.test.mjs` | ~1 second |
| **Onboarding domain logic** | `node --test tests/onboarding-domain.test.mjs` | ~1 second |
| **Storage & encryption chunks** | `node --test tests/secure-chunks.test.mjs tests/finance-storage.test.mjs` | ~1 second |
| **Full test suite** (Manager closeout only) | `npm test` | ~6 seconds |

*Note: Avoid running `npm test` repeatedly in worker intermediate iterations.*

---

## 2. Windows Environment Quirks & Cache Clearance

When developing on Windows:

1. **PowerShell Execution**:
   - Always run commands with explicit relative or clean absolute paths.
   - For npm scripts, use `npm run <script>` or `npm.cmd run <script>`.
2. **Metro Cache Reset**:
   If Metro bundler throws stale import or babel caching errors:
   ```bash
   npx expo start -c
   ```
3. **Android CXX / Gradle Lock Reset**:
   If `android/app/.cxx` or `.gradle` generates file lock or `DirIOError` errors:
   ```powershell
   cd android
   .\gradlew.bat --stop
   cd ..
   ```

---

## 3. T3 Code Device Tool Usage (Emulators & Simulators)

When device testing is explicitly requested by the user:

1. **Device Discovery**: Call `device_list` to obtain `hostId` and `id`.
2. **Device Connection**: Call `device_open` with `hostId` and `id` to receive the `agent-device` session command.
3. **Execution**: Use the bound `agent-device` command for app launching (`open <app>`), taps, text inputs, and navigation.
4. **Visual Inspection**: Call `device_screenshot` to inspect rendering.
5. **Never**: Never invoke raw `adb`, `xcrun simctl`, or unauthorized shell scripts directly when T3 Code device tools are available.
