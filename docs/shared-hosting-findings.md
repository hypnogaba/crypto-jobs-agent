# Shared Hosting — Node.js Deployment Findings

**Date:** 2026-07-29
**Goal:** Deploy the Next.js app (`web/`) directly on the shared hosting account (CloudLinux/CageFS, ADM.TOOLS panel), instead of Vercel.
**Server:** The account's MySQL/FTP hosts (redacted). Paid account (not a trial), CloudLinux with CageFS isolation.

## Summary

Five independent technical barriers were found, each confirmed experimentally. None of them are configuration mistakes on our side — they are properties of this specific hosting account/plan.

## 1. No official Node.js hosting support

`/usr/selector/` (the CloudLinux Selector data directory) contains only `lsphp` — no Node.js entry. CloudLinux's Node.js Selector (the standard mechanism for running Node apps on shared hosting via Phusion Passenger on ports 80/443) requires server-admin-level installation (Alt NodeJS Package + Passenger module + LVE Utils/Manager) — it is **not** something an individual hosting account can enable itself.

Sources:
- https://cloudlinux.com/getting-started-with-cloudlinux-os/42-profitability-and-php-features/959-nodejs-selector/
- https://cloudlinux.zendesk.com/hc/en-us/articles/360002668234-CloudLinux-Node-js-Selector-FAQ

Node.js itself **is** present on the box (`/usr/local/node22/bin/node`, v22.23.1) — it's just not integrated with the web server or process manager.

## 2. Severe CPU throttling on the build process

Running `npm run build` directly on the server (even after limiting Next.js's own build worker parallelism to 1 via `experimental.cpus: 1` / `workerThreads: false` in `next.config.ts`, to work around a separate `spawn EAGAIN` error caused by the box reporting 32 CPUs it doesn't actually grant this account):

- Wall-clock elapsed: **2 hours 34 minutes**
- Actual CPU time consumed: **12 seconds**

That's roughly 0.13% of a core sustained. This is consistent with a CloudLinux LVE (Lightweight Virtual Environment) CPU governor throttling this account far below what a Next.js production build needs. The account is fully paid, so this isn't a trial-tier restriction.

## 3. The lightweight runtime process also gets killed (root cause not fully identified)

To route around #2, we built `.next/standalone` locally (no server-side compilation needed at all) and `rsync`'d only the ~42 MB runtime output to the server. Bare `node -e 'http.createServer(...)'` scripts **survive indefinitely** on this account (tested >4s continuously with stable ~46 MB RSS, still alive in a fresh SSH session afterward).

The Next.js standalone `server.js`, however:
- Starts successfully and logs `✓ Ready in 0ms`
- Stabilizes at ~96 MB RSS
- Was observed alive in one fresh SSH session (`pgrep` found it)
- Was **gone** on the next check ~10–20 seconds later, with no error in its own log file and no OOM message visible (no root access to check `dmesg`/system journal)
- A `curl` to `127.0.0.1:<port>` failed with `Connection refused` even while `pgrep` still matched a process on one occasion — suggests the process may stop listening before the process itself exits, or there's a short window of inconsistency

**Not conclusively diagnosed** — candidates, in rough order of likelihood:
- LVE memory cap tighter than expected, killing a ~96 MB process the OS/LVE governor doesn't surface as a normal OOM log to a non-root user
- Some security/monitoring layer (CageFS-related) specifically flagging long-lived Node network listeners as anomalous, vs. one-shot scripts
- A subtlety in how the standalone server binds sockets (`HOSTNAME=127.0.0.1` override) that a root-level investigation could clarify quickly

## 4. External arbitrary ports are firewalled

Confirmed via `nc -zv` from an external machine: port 3306 (MySQL) is reachable, port 35123 (arbitrary test) is not (`Operation timed out`). Only a known allowlist of service ports (80, 443, 21, 22, 3306) appears open. This rules out running Node directly on its own port and reaching it from outside — any solution needs to terminate on 80/443 via the existing Apache/PHP stack.

## 5. `crontab` is broken for this account via SSH

`crontab -l` / `crontab -e` fail with a Python traceback inside CloudLinux's own wrapper (`cloudlinux-user-cron`):

```
PermissionError: [Errno 13] Permission denied: '/opt/cloudlinux/venv/lib64/python3.11/site-packages/clcommon/cpapi/cache/admtools.py'
```

This is a server-side misconfiguration/bug, not something fixable from the account side. Cron jobs would need to be created via the ADM.TOOLS web panel ("Розклад завдань (cron)"), not SSH.

## What does work here

- **MySQL** (port 3306) — fast, stable, externally reachable, verified via Prisma from both a local machine and the server itself (test connection: 106ms).
- **PHP 8.2** — the natively supported stack for this hosting plan.
- **Static file serving** via the existing Apache/PHP web root.
- **One-shot / short-lived scripts** (SSH-invoked, git, npm install, build tooling that doesn't need to stay resident) — these complete fine, just slowly for CPU-heavy steps.

## Open questions for a second opinion

1. Is finding #3 (silent kill of the standalone server) actually the same root cause as #2 (CPU governor), just manifesting differently for a listening process vs. a bounded script? Or genuinely a separate mechanism?
2. Is there a way to inspect **why** a process was killed without root access on a CloudLinux/CageFS box (e.g., a per-user log CageFS exposes that we haven't found)?
3. Given constraints #1–#5, is a PHP-based reverse-proxy + cron-based watchdog (the originally proposed workaround) actually viable, or does finding #3 mean *any* persistent Node process is doomed on this account regardless of how it's fronted?
4. Is there a lighter-weight way to run this specific app (e.g., a plain Node HTTP server without Next.js's runtime, given bare Node scripts demonstrably survive) that trades framework features for something this host can actually sustain?
