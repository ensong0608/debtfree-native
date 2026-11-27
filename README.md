<div align="center">

# DebtFree Native

### Cross-Platform Personal Finance & Debt Payoff App (iOS & Android)

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![React Native](https://img.shields.io/badge/React_Native-61DAFB?style=flat-square&logo=react&logoColor=black)
![Expo](https://img.shields.io/badge/Expo-000020?style=flat-square&logo=expo&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=flat-square&logo=supabase&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL_RLS-4169E1?style=flat-square&logo=postgresql&logoColor=white)

</div>

A native Android and iOS personal finance and debt-payoff application built with **React Native (Expo)**, **TypeScript**, and **Supabase (PostgreSQL)**. Designed for security-first authentication, offline resilience, and deterministic payoff planning (Avalanche & Snowball).

See [APP_CAPABILITIES.md](APP_CAPABILITIES.md) for a detailed breakdown of current capabilities and scope.

---

## Key Engineering Highlights

- **Hardened Authentication & Session Security** — Google OAuth via system browser with Supabase PKCE (exchangeCodeForSession), per-user chunked SecureStore persistence (excluded from Android Auto Backup), and server-verified session restoration on launch and foreground resume.
- **Offline-Resilient State** — Distinguishes definitive auth revocations from transient network/5xx failures so users are never unexpectedly logged out when offline.
- **Multi-Step Onboarding & Household Data Model** — Idempotent PostgreSQL migrations with strict Row-Level Security (RLS) and SECURITY DEFINER RPCs across households, household_members, and debts.
- **Sandbox Safety Guards** — Runtime environment validation prevents accidental connection to production projects or use of privileged/service-role keys in client builds.

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Mobile App** | React Native, Expo Dev Client, TypeScript |
| **Auth & Storage** | Supabase Auth (PKCE), Expo SecureStore (chunked) |
| **Database** | PostgreSQL, Row-Level Security (RLS), PL/pgSQL RPCs |
| **Testing & CI** | Jest / TypeScript checks, GitHub Actions (ndroid-test-build.yml) |

---

## Current Status

- **Verified on Android (Sandbox):** Google PKCE sign-in, chunked SecureStore persistence, server-verified session restoration, offline recovery, sign-out, Sign-Up (Steps 1–4), Onboarding (Steps 1–5), Supabase public.debts + user_metadata persistence, and Home Dashboard.
- **In Progress / Sandbox-Only:** Native Apple Sign-In on iOS (expo-apple-authentication) is implemented but unverified on hardware. Store billing, bank aggregation (Plaid/Finicity), and remote push notifications are intentionally disabled in sandbox builds.

---

## Local Development

1. **Install dependencies** (Node 24+):
   `ash
   npm ci
   `
2. **Configure environment:**
   Copy .env.example to .env.local (git-ignored) and fill in your sandbox Supabase public URL, project ref, and publishable anon key. Never place secret or service-role keys in EXPO_PUBLIC_* variables.
3. **Run development client** (Expo Go is not supported due to native auth/SecureStore plugins):
   `ash
   npx expo start --dev-client --clear
   `
4. **Apply database migrations** (local Supabase CLI):
   `ash
   supabase start
   supabase db reset
   `

> For OAuth redirect setup, Apple Sign-In requirements, and session architecture details, see [docs/](docs/) and [APP_PLAN.md](APP_PLAN.md).