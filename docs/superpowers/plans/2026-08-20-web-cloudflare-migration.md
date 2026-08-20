# Web → Cloudflare Workers + D1 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the existing `web/` Next.js app off the abandoned PHP/hypnosit plan onto Cloudflare Workers + D1 (the same pattern already proven on `the-ledger` and `tradebot-dashboard`), and rework onboarding to match the new general-job-search design: freetext-or-CV entry → clarifying questions → real Telegram connect (deep-link, not manual chat-ID paste). Email/Resend delivery is dropped — Telegram-only for MVP per the design spec.

**Architecture:** Next.js deploys via `@opennextjs/cloudflare` to a Cloudflare Worker with static assets. Prisma keeps its existing model-based API but swaps its driver adapter from `@prisma/adapter-mariadb` to `@prisma/adapter-d1`, talking to a D1 binding instead of a MySQL TCP connection — this is the smallest change that unblocks deployment, since Workers cannot make the raw TCP connection MySQL needs anyway. Onboarding becomes a 3-step flow (entry → details → connect) instead of one form.

**Tech Stack:** Next.js 16, Cloudflare Workers, Cloudflare D1, `@opennextjs/cloudflare`, `wrangler`, Prisma 7 with `@prisma/adapter-d1`, Vitest.

**Out of scope for this plan** (separate plans, written after this one ships): the Scan Worker (job-search engine port), the Match Worker (Claude ranking + real CV parsing + daily delivery), and site i18n via Workers AI. `JobSignal`/`DailyCard` keep their current shape here — the dashboard will keep showing its existing empty state until the Scan/Match Worker plans populate real data. This plan produces a deployed, working onboarding → empty-dashboard → settings flow on its own.

---

### Task 1: Cloudflare Workers + D1 project setup

**Files:**
- Create: `web/wrangler.jsonc`
- Create: `web/open-next.config.ts`
- Modify: `web/package.json`

- [ ] **Step 1: Install the Cloudflare deploy toolchain**

Run from `web/`:
```bash
npm install --save-dev @opennextjs/cloudflare@latest wrangler@latest
```
Expected: both packages added to `devDependencies` in `package.json`.

- [ ] **Step 2: Create the D1 database**

Run from `web/`:
```bash
npx wrangler d1 create crypto-jobs-agent
```
Expected output includes a `database_id` (UUID) and a `[[d1_databases]]` block you'll paste into `wrangler.jsonc` in the next step. Copy the `database_id` value now.

- [ ] **Step 3: Write `wrangler.jsonc`**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "main": ".open-next/worker.js",
  "name": "crypto-jobs-agent",
  "compatibility_date": "2026-08-20",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": {
    "directory": ".open-next/assets",
    "binding": "ASSETS"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "crypto-jobs-agent",
      "database_id": "PASTE_DATABASE_ID_FROM_STEP_2_HERE"
    }
  ],
  "services": [
    {
      "binding": "WORKER_SELF_REFERENCE",
      "service": "crypto-jobs-agent"
    }
  ],
  "workers_dev": true,
  "observability": {
    "enabled": true
  }
}
```

Replace `PASTE_DATABASE_ID_FROM_STEP_2_HERE` with the real `database_id` from Step 2.

- [ ] **Step 4: Write `open-next.config.ts`**

```ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
```

- [ ] **Step 5: Add deploy scripts to `package.json`**

Add these entries to the `"scripts"` object (alongside the existing `dev`/`build`/`start`/`lint`):

```json
"preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview",
"cf:deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy",
"cf-typegen": "wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts"
```

- [ ] **Step 6: Generate Cloudflare env types**

Run from `web/`:
```bash
npm run cf-typegen
```
Expected: creates `web/cloudflare-env.d.ts` declaring a `CloudflareEnv` interface with a `DB: D1Database` field (matches the `d1_databases` binding from Step 3).

- [ ] **Step 7: Commit**

```bash
git add web/wrangler.jsonc web/open-next.config.ts web/package.json web/package-lock.json web/cloudflare-env.d.ts
git commit -m "web: add Cloudflare Workers + D1 project scaffolding"
```

---

### Task 2: Migrate Prisma from MySQL/mariadb to D1/SQLite

**Files:**
- Modify: `web/prisma/schema.prisma`
- Modify: `web/src/lib/prisma.ts`
- Modify: `web/package.json`
- Create: `web/migrations/0001_init.sql`

- [ ] **Step 1: Swap the Prisma driver dependency**

Run from `web/`:
```bash
npm uninstall @prisma/adapter-mariadb mariadb
npm install @prisma/adapter-d1@latest
```

- [ ] **Step 2: Rewrite `prisma/schema.prisma`**

This changes the datasource to `sqlite` (D1's dialect), drops the MySQL-only `@db.Text` native-type attributes (SQLite has no such native type — plain `String` already maps to `TEXT`), and reworks `User`/`CandidateProfile` for the new onboarding design: email is gone (Telegram is the only identity/delivery channel now), and the profile gains the fields the new clarifying-questions step collects (`mode`, `category`, `location`, `remoteOk`, `salaryMin`) in place of the old crypto-specific `ecosystem`/`avoid`/`githubHandle`/`xHandle`.

```prisma
// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "sqlite"
}

enum ProfileMode {
  FREETEXT
  CV
}

enum ApplyPath {
  HUMAN
  FORMAL
}

enum CardStatus {
  PENDING
  SENT
  FAILED
}

model User {
  id             String   @id @default(cuid())
  telegramChatId String?  @unique
  connectToken   String?  @unique
  locale         String   @default("en")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  profile        CandidateProfile?
  cards          DailyCard[]
}

model CandidateProfile {
  id          String      @id @default(cuid())
  userId      String      @unique
  user        User        @relation(fields: [userId], references: [id], onDelete: Cascade)

  mode        ProfileMode
  rawInput    String?
  cvText      String?
  seekingRole String?
  category    String?
  location    String?
  remoteOk    Boolean     @default(true)
  salaryMin   Int?

  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
}

model JobSignal {
  id            String   @id @default(cuid())
  sourceUrl     String?
  sourceText    String
  role          String
  company       String?
  compFrom      Int?
  compTo        Int?
  remote        String?
  path          ApplyPath
  contactHandle String?
  createdAt     DateTime @default(now())

  cards         DailyCard[]
}

model DailyCard {
  id          String     @id @default(cuid())
  userId      String
  user        User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  jobSignalId String
  jobSignal   JobSignal  @relation(fields: [jobSignalId], references: [id], onDelete: Cascade)

  whyYou      String
  draftText   String
  status      CardStatus @default(PENDING)

  deliveredAt DateTime?
  createdAt   DateTime   @default(now())

  @@unique([userId, jobSignalId])
}
```

- [ ] **Step 3: Regenerate the Prisma client**

Run from `web/`:
```bash
npx prisma generate
```
Expected: regenerates `web/src/generated/prisma` against the new SQLite schema, no errors.

- [ ] **Step 4: Generate the D1 migration SQL from the schema**

Run from `web/`:
```bash
mkdir -p migrations
npx prisma migrate diff --from-empty --to-schema-datamodel=prisma/schema.prisma --script > migrations/0001_init.sql
```
Expected: `migrations/0001_init.sql` contains `CREATE TABLE` statements for `User`, `CandidateProfile`, `JobSignal`, `DailyCard`. Open the file and confirm all four tables are present before continuing.

- [ ] **Step 5: Apply the migration to the local D1 database**

Run from `web/`:
```bash
npx wrangler d1 migrations apply crypto-jobs-agent --local
```
Expected: `Migrations to be applied: 0001_init.sql` followed by `✅ ... Executed`.

- [ ] **Step 6: Rewrite `src/lib/prisma.ts` to use the D1 binding**

The old version constructed a `PrismaMariaDb` adapter from a `DATABASE_URL` env var at module load time — that doesn't work here because the D1 binding only exists inside a request's Cloudflare context, not at cold-start. Use `@opennextjs/cloudflare`'s `getCloudflareContext()` to fetch it per-request instead.

```ts
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function getPrisma(): Promise<PrismaClient> {
  const { env } = getCloudflareContext();
  const adapter = new PrismaD1(env.DB);
  return new PrismaClient({ adapter });
}
```

This changes the import contract: every caller that did `import { prisma } from "@/lib/prisma"` now does `const prisma = await getPrisma();` inside its async function body. Task 5 and Task 6 update all current call sites (`actions.ts`, `dashboard/page.tsx`, `settings/page.tsx`).

- [ ] **Step 7: Commit**

```bash
git add web/prisma/schema.prisma web/src/lib/prisma.ts web/migrations web/package.json web/package-lock.json
git commit -m "web: migrate Prisma from MySQL/mariadb to D1/SQLite"
```

---

### Task 3: Telegram connect token utility (TDD)

**Files:**
- Create: `web/vitest.config.ts`
- Create: `web/src/lib/telegram-connect.ts`
- Test: `web/src/lib/telegram-connect.test.ts`
- Modify: `web/package.json`

- [ ] **Step 1: Install Vitest**

Run from `web/`:
```bash
npm install --save-dev vitest@latest
```

- [ ] **Step 2: Add the test script**

Add to `"scripts"` in `package.json`:
```json
"test": "vitest run"
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 4: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  generateConnectToken,
  buildTelegramDeepLink,
  parseStartCommand,
} from "./telegram-connect";

describe("generateConnectToken", () => {
  it("returns a 32-character hex string", () => {
    const token = generateConnectToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it("returns a different token on each call", () => {
    expect(generateConnectToken()).not.toBe(generateConnectToken());
  });
});

describe("buildTelegramDeepLink", () => {
  it("builds a t.me start link with the token as the start param", () => {
    const link = buildTelegramDeepLink("my_jobs_bot", "abc123");
    expect(link).toBe("https://t.me/my_jobs_bot?start=abc123");
  });
});

describe("parseStartCommand", () => {
  it("extracts the token from a /start command", () => {
    expect(parseStartCommand("/start abc123")).toBe("abc123");
  });

  it("extracts the token when the bot username is included", () => {
    expect(parseStartCommand("/start@my_jobs_bot abc123")).toBe("abc123");
  });

  it("returns null for a bare /start with no token", () => {
    expect(parseStartCommand("/start")).toBeNull();
  });

  it("returns null for unrelated text", () => {
    expect(parseStartCommand("hello there")).toBeNull();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run from `web/`:
```bash
npx vitest run src/lib/telegram-connect.test.ts
```
Expected: FAIL — `Cannot find module './telegram-connect'`.

- [ ] **Step 6: Write the implementation**

```ts
export function generateConnectToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildTelegramDeepLink(botUsername: string, token: string): string {
  return `https://t.me/${botUsername}?start=${token}`;
}

export function parseStartCommand(text: string): string | null {
  const match = /^\/start(?:@\w+)?\s+(\S+)$/.exec(text.trim());
  return match ? match[1] : null;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run from `web/`:
```bash
npx vitest run src/lib/telegram-connect.test.ts
```
Expected: PASS, 6 tests.

- [ ] **Step 8: Commit**

```bash
git add web/vitest.config.ts web/src/lib/telegram-connect.ts web/src/lib/telegram-connect.test.ts web/package.json web/package-lock.json
git commit -m "web: add Telegram connect token utility with tests"
```

---

### Task 4: Telegram webhook route (links chat_id to a pending user)

**Files:**
- Create: `web/src/app/api/telegram/webhook/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";
import { parseStartCommand } from "@/lib/telegram-connect";

export async function POST(request: Request) {
  const update = await request.json();
  const message = update.message;
  const text: string | undefined = message?.text;
  const chatId: number | undefined = message?.chat?.id;

  if (!text || !chatId) {
    return NextResponse.json({ ok: true });
  }

  const token = parseStartCommand(text);
  if (!token) {
    return NextResponse.json({ ok: true });
  }

  const prisma = await getPrisma();
  const user = await prisma.user.findUnique({ where: { connectToken: token } });
  if (!user) {
    return NextResponse.json({ ok: true });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { telegramChatId: String(chatId), connectToken: null },
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/app/api/telegram/webhook/route.ts
git commit -m "web: add Telegram webhook route to link chat_id via connect token"
```

Registering this webhook with Telegram (`setWebhook`) happens in Task 6 Step 5, once the app is actually deployed and has a real URL to point at.

---

### Task 5: Onboarding step 1 + 2 — freetext/CV entry and clarifying questions

**Files:**
- Modify: `web/src/app/page.tsx`
- Modify: `web/src/app/actions.ts`
- Create: `web/src/app/onboarding/details/page.tsx`

- [ ] **Step 1: Rewrite the entry page (`page.tsx`) with the freetext/CV toggle**

```tsx
import { startOnboarding } from "./actions";

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center bg-white px-6 py-16">
      <main className="w-full max-w-lg">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Find your next role
        </h1>
        <p className="mt-2 text-zinc-500">
          Tell us what you&apos;re looking for, or paste your CV. We&apos;ll do the
          searching — up to 5 matches a day, sent to Telegram.
        </p>

        <form action={startOnboarding} className="mt-8 flex flex-col gap-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700">
              What are you looking for, and where?
            </span>
            <textarea
              name="input"
              required
              rows={5}
              placeholder="Senior backend engineer, fintech, remote EU timezone, from $100k. Or paste your CV here."
              className="rounded-lg border border-zinc-200 px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
            />
          </label>

          <button
            type="submit"
            className="mt-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Continue
          </button>
        </form>
      </main>
    </div>
  );
}
```

CV file upload (a real `<input type="file">` parsed via Claude) is deferred to the Match Worker plan alongside real CV parsing — for now, "paste your CV as text" reuses the same free-text field and the same mock `parseCv`, so the flow is fully testable end-to-end today without inventing a file-upload path that has nothing real behind it yet.

- [ ] **Step 2: Rewrite `actions.ts` — `startOnboarding` and `saveDetails`, drop email/delivery-channel logic**

```ts
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/prisma";
import { parseCv } from "@/lib/ai";

export async function startOnboarding(formData: FormData) {
  const input = String(formData.get("input") ?? "").trim();
  if (!input) {
    throw new Error("Tell us what you're looking for, or paste your CV.");
  }

  const parsed = await parseCv(input);
  const prisma = await getPrisma();

  const user = await prisma.user.create({
    data: {
      profile: {
        create: {
          mode: "FREETEXT",
          rawInput: input,
          seekingRole: parsed.seekingRole,
          category: parsed.category,
          location: parsed.location,
          remoteOk: parsed.remoteOk,
          salaryMin: parsed.salaryMin,
        },
      },
    },
  });

  const cookieStore = await cookies();
  cookieStore.set("userId", user.id, { httpOnly: true, sameSite: "lax" });

  redirect("/onboarding/details");
}

export async function saveDetails(formData: FormData) {
  const cookieStore = await cookies();
  const userId = cookieStore.get("userId")?.value;
  if (!userId) redirect("/");

  const category = String(formData.get("category") ?? "").trim() || null;
  const location = String(formData.get("location") ?? "").trim() || null;
  const remoteOk = formData.get("remoteOk") === "on";
  const salaryMinRaw = String(formData.get("salaryMin") ?? "").trim();
  const salaryMin = salaryMinRaw ? Number.parseInt(salaryMinRaw, 10) : null;

  const prisma = await getPrisma();
  await prisma.candidateProfile.update({
    where: { userId },
    data: { category, location, remoteOk, salaryMin },
  });

  redirect("/onboarding/connect");
}
```

- [ ] **Step 3: Update the mock AI layer's return shape to match the new profile fields**

`parseCv` in `src/lib/ai.ts` currently returns crypto-specific fields (`ecosystem`, `avoid`, `compFrom`). Update `ParsedCandidateProfile` and `mockParseCv` to return the fields the new schema and `startOnboarding` actually use:

```ts
export interface ParsedCandidateProfile {
  seekingRole: string;
  category: string;
  location: string;
  remoteOk: boolean;
  salaryMin: number;
}
```

```ts
function mockParseCv(rawText: string): ParsedCandidateProfile {
  const isRemote = /remote/i.test(rawText);
  const salaryMatch = /\$?(\d{2,3})[,.]?(\d{3})?\s*k/i.exec(rawText);
  const salaryMin = salaryMatch
    ? Number.parseInt(salaryMatch[1], 10) * 1000
    : 80000;

  return {
    seekingRole: "Role parsed from your input (mock — set ANTHROPIC_API_KEY for real parsing)",
    category: "General",
    location: isRemote ? "" : "Not specified",
    remoteOk: isRemote,
    salaryMin,
  };
}
```

(Leave `generateDraft`/`GeneratedDraft` untouched — the Match Worker plan owns those.)

- [ ] **Step 4: Write the clarifying-questions page (`onboarding/details/page.tsx`)**

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/prisma";
import { saveDetails } from "../../actions";

export default async function OnboardingDetails() {
  const cookieStore = await cookies();
  const userId = cookieStore.get("userId")?.value;
  if (!userId) redirect("/");

  const prisma = await getPrisma();
  const profile = await prisma.candidateProfile.findUnique({ where: { userId } });
  if (!profile) redirect("/");

  return (
    <div className="flex flex-1 items-center justify-center bg-white px-6 py-16">
      <main className="w-full max-w-lg">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          A few more details
        </h1>
        <p className="mt-2 text-zinc-500">
          We pre-filled these from what you told us — edit anything that&apos;s off.
        </p>

        <form action={saveDetails} className="mt-8 flex flex-col gap-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700">Category</span>
            <input
              type="text"
              name="category"
              defaultValue={profile.category ?? ""}
              placeholder="e.g. Engineering, Partnerships, DevRel"
              className="rounded-lg border border-zinc-200 px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700">Location</span>
            <input
              type="text"
              name="location"
              defaultValue={profile.location ?? ""}
              placeholder="e.g. Paris, or leave blank if fully remote"
              className="rounded-lg border border-zinc-200 px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" name="remoteOk" defaultChecked={profile.remoteOk} />
            Open to remote roles
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700">
              Minimum salary (optional, USD/year)
            </span>
            <input
              type="number"
              name="salaryMin"
              defaultValue={profile.salaryMin ?? ""}
              placeholder="80000"
              className="rounded-lg border border-zinc-200 px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
            />
          </label>

          <button
            type="submit"
            className="mt-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Continue
          </button>
        </form>
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add web/src/app/page.tsx web/src/app/actions.ts web/src/app/onboarding web/src/lib/ai.ts
git commit -m "web: rework onboarding into freetext/CV entry + clarifying questions steps"
```

---

### Task 6: Onboarding step 3 (Telegram connect), settings rework, drop email delivery, generalize copy

**Files:**
- Create: `web/src/app/onboarding/connect/page.tsx`
- Modify: `web/src/app/settings/page.tsx`
- Modify: `web/src/app/actions.ts`
- Modify: `web/src/app/dashboard/page.tsx`
- Modify: `web/src/app/layout.tsx`
- Modify: `web/src/lib/delivery.ts`

- [ ] **Step 1: Add `regenerateConnectToken` to `actions.ts`, drop `updateDeliveryChannel`**

`updateDeliveryChannel` no longer makes sense — there's only one delivery channel (Telegram) now. Replace it with an action that issues a fresh connect token, used by both the onboarding connect page and the settings "reconnect" button.

```ts
export async function regenerateConnectToken() {
  const cookieStore = await cookies();
  const userId = cookieStore.get("userId")?.value;
  if (!userId) redirect("/");

  const { generateConnectToken } = await import("@/lib/telegram-connect");
  const token = generateConnectToken();

  const prisma = await getPrisma();
  await prisma.user.update({ where: { id: userId }, data: { connectToken: token } });

  redirect("/onboarding/connect");
}
```

- [ ] **Step 2: Write `onboarding/connect/page.tsx`**

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getPrisma } from "@/lib/prisma";
import { buildTelegramDeepLink } from "@/lib/telegram-connect";
import { regenerateConnectToken } from "../../actions";

const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME ?? "your_bot";

export default async function OnboardingConnect() {
  const cookieStore = await cookies();
  const userId = cookieStore.get("userId")?.value;
  if (!userId) redirect("/");

  const prisma = await getPrisma();
  let user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect("/");

  if (user.telegramChatId) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white px-6 py-16">
        <main className="w-full max-w-lg text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            You&apos;re connected
          </h1>
          <p className="mt-2 text-zinc-500">
            We&apos;ll send up to 5 matching roles a day to your Telegram.
          </p>
          <Link
            href="/dashboard"
            className="mt-8 inline-block rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Go to dashboard
          </Link>
        </main>
      </div>
    );
  }

  if (!user.connectToken) {
    const { generateConnectToken } = await import("@/lib/telegram-connect");
    const token = generateConnectToken();
    user = await prisma.user.update({ where: { id: userId }, data: { connectToken: token } });
  }

  const deepLink = buildTelegramDeepLink(BOT_USERNAME, user.connectToken!);

  return (
    <div className="flex flex-1 items-center justify-center bg-white px-6 py-16">
      <main className="w-full max-w-lg text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Connect Telegram
        </h1>
        <p className="mt-2 text-zinc-500">
          Press the button, then press Start in Telegram. Come back and refresh this
          page once you have.
        </p>
        <a
          href={deepLink}
          className="mt-8 inline-block rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Connect Telegram
        </a>
        <form action={regenerateConnectToken} className="mt-4">
          <button type="submit" className="text-sm text-zinc-500 hover:text-zinc-900">
            Link not working? Get a new one
          </button>
        </form>
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `settings/page.tsx` — drop the manual chat-ID field, add a reconnect button**

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/prisma";
import { regenerateConnectToken } from "../actions";

export default async function Settings() {
  const cookieStore = await cookies();
  const userId = cookieStore.get("userId")?.value;
  if (!userId) redirect("/");

  const prisma = await getPrisma();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect("/");

  return (
    <div className="flex flex-1 justify-center bg-white px-6 py-16">
      <main className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Delivery settings
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Your daily opportunities are sent to Telegram.
        </p>

        <div className="mt-8 rounded-lg border border-zinc-200 p-4 text-sm text-zinc-700">
          {user.telegramChatId ? "Telegram connected." : "Telegram not connected yet."}
        </div>

        <form action={regenerateConnectToken} className="mt-4">
          <button
            type="submit"
            className="rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            {user.telegramChatId ? "Reconnect Telegram" : "Connect Telegram"}
          </button>
        </form>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Drop the email delivery path from `delivery.ts`**

Email/Resend is explicitly out of MVP scope (Telegram-only per the design spec). Remove `deliverViaEmail` and the `RESEND_API_KEY` branch entirely, and drop the now-unused `user.deliveryChannel` check:

```ts
/**
 * Delivery abstraction — sends a daily card to the user via Telegram.
 * Email delivery is out of scope for the MVP (Telegram-only).
 */

import type { User, JobSignal, DailyCard } from "@/generated/prisma/client";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export async function deliverCard(
  user: User,
  card: DailyCard,
  signal: JobSignal
): Promise<{ ok: boolean; error?: string }> {
  const text = formatCardText(signal, card.whyYou, card.draftText);
  return deliverViaTelegram(user.telegramChatId, text);
}

function formatCardText(signal: JobSignal, whyYou: string, draftText: string): string {
  const compLine =
    signal.compFrom && signal.compTo
      ? `$${signal.compFrom.toLocaleString()}-${signal.compTo.toLocaleString()}`
      : signal.compFrom
        ? `From $${signal.compFrom.toLocaleString()}`
        : "Compensation not listed";

  return [
    `${signal.company ?? "Unknown company"}, ${signal.role}`,
    `${compLine}${signal.remote ? `, ${signal.remote}` : ""}`,
    "",
    `Why you: ${whyYou}`,
    "",
    draftText,
  ].join("\n");
}

async function deliverViaTelegram(
  chatId: string | null,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  if (!TELEGRAM_BOT_TOKEN) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN not configured" };
  }
  if (!chatId) {
    return { ok: false, error: "User has no linked Telegram chat_id" };
  }

  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    }
  );
  const data = await res.json();
  return data.ok ? { ok: true } : { ok: false, error: JSON.stringify(data) };
}
```

- [ ] **Step 5: Generalize `dashboard/page.tsx` and `layout.tsx` copy off crypto/web3, fix the `prisma` import**

In `dashboard/page.tsx`: replace `import { prisma } from "@/lib/prisma";` with `import { getPrisma } from "@/lib/prisma";`, and inside the component add `const prisma = await getPrisma();` before the queries (same pattern as Task 5's `onboarding/details/page.tsx`). No other logic changes — `JobSignal`/`DailyCard` are untouched by this plan, so the existing empty-state ("Nothing new today...") keeps working as-is.

In `layout.tsx`, update the metadata:
```ts
export const metadata: Metadata = {
  title: "Job Search Agent",
  description: "Get up to 5 matching roles a day, sent straight to Telegram.",
};
```

- [ ] **Step 6: Commit**

```bash
git add web/src/app/onboarding/connect web/src/app/settings/page.tsx web/src/app/actions.ts web/src/app/dashboard/page.tsx web/src/app/layout.tsx web/src/lib/delivery.ts
git commit -m "web: add Telegram connect step, drop email delivery, generalize copy"
```

---

### Task 7: Local verification and first deploy

**Files:** none (verification only)

- [ ] **Step 1: Run the unit tests**

Run from `web/`:
```bash
npm run test
```
Expected: all `telegram-connect.test.ts` tests PASS.

- [ ] **Step 2: Set local dev secrets**

Create `web/.dev.vars` (already covered by `.gitignore` — confirm with `git check-ignore web/.dev.vars` before proceeding, since this file will hold a real bot token):
```
TELEGRAM_BOT_TOKEN=<the Phase 1 test bot's token, from docs/routine-notes.md>
TELEGRAM_BOT_USERNAME=<that bot's @username, without the @>
```

- [ ] **Step 3: Build and preview on the actual Workers runtime**

Run from `web/`:
```bash
npm run preview
```
Expected: builds via OpenNext, then `wrangler` starts a local preview server (Workers runtime, real D1 binding to the local SQLite file from Task 2 Step 5) and prints a `http://localhost:8787`-style URL.

- [ ] **Step 4: Walk the full flow in a browser**

Open the preview URL and manually verify, in order:
1. Entry page loads, submitting free text redirects to `/onboarding/details`.
2. Details page shows pre-filled mock values, editing and submitting redirects to `/onboarding/connect`.
3. Connect page renders a `https://t.me/<username>?start=<token>` link.
4. `/dashboard` (after connect) shows the existing "Nothing new today" empty state.
5. `/settings` shows "Telegram not connected yet." and a working "Connect Telegram" button.

If any step 500s, check the preview server's terminal output for the Prisma/D1 error before touching anything else — this is the first time the D1 adapter runs against real data, so a schema mismatch here is expected to be more likely than in the unit tests.

- [ ] **Step 5: Deploy and register the Telegram webhook**

Run from `web/`:
```bash
npm run cf:deploy
```
Expected: prints the deployed `*.workers.dev` URL.

Register that URL with the Telegram bot (replace both placeholders):
```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<your-worker>.workers.dev/api/telegram/webhook"
```
Expected: `{"ok":true,"result":true,"description":"Webhook was set"}`.

- [ ] **Step 6: Verify the Telegram connect loop end-to-end**

On the deployed URL, go through onboarding to the connect page, tap the deep link, press Start in your Telegram client, then refresh `/onboarding/connect` — it should now show "You're connected" instead of the connect button. This confirms the webhook (Task 4) is correctly matching the token and writing `telegramChatId`.

- [ ] **Step 7: Set the production secret and commit any remaining config**

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
```
(paste the token when prompted)

```bash
git add -A
git status
```
Confirm nothing unexpected is staged (in particular, `.dev.vars` must NOT appear — re-check `.gitignore` if it does), then commit only if there are tracked config changes left over from this task:
```bash
git commit -m "web: verify Cloudflare Workers + D1 deploy end-to-end"
```

---

## Self-Review Notes

- **Spec coverage:** §2 (architecture: Cloudflare Workers/D1/OpenNext) → Tasks 1-2. §3 (onboarding: freetext/CV → clarifying questions → Telegram connect) → Tasks 5-6. §7 (data model) — this plan keeps `User`/`CandidateProfile`/`JobSignal`/`DailyCard` rather than jumping straight to the spec's `users`/`profiles`/`jobs_cache`/`sent`/`sources_state` naming; `jobs_cache` and `sources_state` are Scan Worker concerns (next plan) and don't exist yet, so introducing those exact names here would be premature. §10 (email delivery explicitly out of scope) → Task 6 Step 4. Scan Worker (§4-5), Match Worker (§6), X/Twitter (§8), i18n (§2's Workers AI note) are explicitly out of scope for this plan — see the header.
- **Placeholder scan:** no TBD/TODO; the two literal placeholders that remain (`PASTE_DATABASE_ID_FROM_STEP_2_HERE`, `<the Phase 1 test bot's token>`) are real values the engineer fills in from a command's own output or an existing doc, not unresolved design questions.
- **Type consistency:** `getPrisma()` (Task 2 Step 6) is used consistently everywhere the old `prisma` singleton import was — `actions.ts`, `onboarding/details/page.tsx`, `onboarding/connect/page.tsx`, `settings/page.tsx`, `dashboard/page.tsx`, `api/telegram/webhook/route.ts`. `ParsedCandidateProfile`'s fields (`seekingRole`, `category`, `location`, `remoteOk`, `salaryMin`) match exactly what `startOnboarding` reads off it and what `CandidateProfile` stores.
