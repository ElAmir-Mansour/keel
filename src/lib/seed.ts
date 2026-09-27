import { addDays, addHours, subDays } from "date-fns";
import { nanoid } from "nanoid";
import { db } from "./db";
import { ymd } from "./dates";
import { NOTE_TEMPLATES } from "./templates";
import type {
  Decision,
  Issue,
  IssueEvent,
  IssueStatus,
  Milestone,
  Note,
  Person,
  Priority,
  Project,
  Risk,
  Update,
} from "./types";

// Deterministic sample workspace: two projects, eight weeks of issue history
// with a real transition log, so every chart has something honest to show.
// Names are fictional.

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260927);
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
const id = () => nanoid(12);

const PLAT_TITLES = [
  "Bind tenant context per transaction with set_config",
  "Restrictive RLS policy on every tenant table",
  "Config schema validation at boot",
  "Outbox relay woken by Redis publish",
  "Boot probe: attempt a cross-tenant read and fail loudly",
  "Expand/contract migration runner as pre-deploy job",
  "Audit log stores codes, never translated text",
  "Locale keys for every user-visible string",
  "Tenant-leading unique constraints on all tables",
  "Custom-field index worker on autocommit connection",
  "Module registry: load, order, and health-check modules",
  "Permission check middleware for module routes",
  "Air-gapped install script and offline package mirror",
  "Health endpoint with dependency detail",
  "Structured request logging with tenant id",
  "Rate limit per tenant on public API",
  "Arabic collation on person names (ar-x-icu)",
  "Seed script for local development",
  "Testcontainers Postgres harness for integration tests",
  "Contract tests for module extension points",
  "OpenAPI spec generation from route schemas",
  "Recovery drill: restore last night's backup and verify",
  "SBOM generation in release pipeline",
  "Remove LISTEN/NOTIFY leftovers from prototype",
  "Idle-in-transaction timeout on staging database",
  "Document the invariants for module authors",
  "CI: schema job asserts tenant policies",
  "Event payload versioning",
  "Session revocation on password change",
  "Admin UI: tenant list and status",
  "Backup job: dump as bypass-RLS role only",
  "Lock timeout on migrations",
];

const BILL_TITLES = [
  "Invoice model with tenant-scoped numbering",
  "VAT rules for KSA (15%) with rounding policy",
  "Plan catalogue: tiers, seats, overage",
  "Proration on mid-cycle plan change",
  "Payment provider adapter interface",
  "Dunning: retry schedule and emails",
  "Invoice PDF in Arabic and English",
  "Usage metering pipeline",
  "Credit notes and refunds",
  "Billing admin screen",
  "Webhooks for payment events",
  "Reconciliation report vs provider statements",
  "Trial to paid conversion flow",
  "ZATCA e-invoice phase 2 compliance spike",
  "Tax id validation",
  "Multi-currency display, SAR settlement",
  "Billing audit trail",
  "Load test: 10k invoices per hour",
];

const LABELS = ["backend", "security", "ops", "frontend", "docs", "tests", "arabic"];

export async function seedSample() {
  const now = new Date();
  const nowISO = now.toISOString();

  const people: Person[] = [
    { id: id(), name: "Sara Haddad", role: "Backend engineer", color: "#2a78d6", createdAt: nowISO, updatedAt: nowISO },
    { id: id(), name: "Omar Khalil", role: "Frontend engineer", color: "#eb6834", createdAt: nowISO, updatedAt: nowISO },
    { id: id(), name: "Lina Farouk", role: "Platform / DevOps", color: "#1baf7a", createdAt: nowISO, updatedAt: nowISO },
    { id: id(), name: "Youssef Nasser", role: "QA engineer", color: "#eda100", createdAt: nowISO, updatedAt: nowISO },
    { id: id(), name: "Me", role: "Tech lead", color: "#4a3aa7", createdAt: nowISO, updatedAt: nowISO },
  ];
  const me = people[4];

  const plat: Project = {
    id: id(),
    key: "PLAT",
    name: "Platform base",
    description:
      "Multi-tenant SaaS base: tenancy, auth, audit, events and the module contract that departments install into.",
    color: "#2a78d6",
    status: "active",
    targetDate: ymd(addDays(now, 45)),
    leadId: me.id,
    createdAt: subDays(now, 60).toISOString(),
    updatedAt: nowISO,
  };
  const bill: Project = {
    id: id(),
    key: "BILL",
    name: "Billing v2",
    description: "Invoicing, plans, proration and KSA VAT rules on top of the platform base.",
    color: "#eb6834",
    status: "active",
    targetDate: ymd(addDays(now, 80)),
    leadId: me.id,
    createdAt: subDays(now, 40).toISOString(),
    updatedAt: nowISO,
  };

  const mkMilestone = (
    p: Project,
    title: string,
    startOff: number,
    dueOff: number,
    status: Milestone["status"],
    order: number,
  ): Milestone => ({
    id: id(),
    projectId: p.id,
    title,
    description: "",
    startDate: ymd(addDays(now, startOff)),
    dueDate: ymd(addDays(now, dueOff)),
    status,
    order,
    createdAt: p.createdAt,
    updatedAt: nowISO,
  });

  const platMs = [
    mkMilestone(plat, "Walking skeleton", -56, -28, "done", 0),
    mkMilestone(plat, "Tenancy and auth", -30, -3, "active", 1),
    mkMilestone(plat, "Audit and events", -10, 20, "active", 2),
    mkMilestone(plat, "Launch readiness", 15, 45, "planned", 3),
  ];
  const billMs = [
    mkMilestone(bill, "Invoice core", -35, -5, "active", 0),
    mkMilestone(bill, "Plans and proration", -7, 30, "planned", 1),
    mkMilestone(bill, "Compliance", 25, 80, "planned", 2),
  ];

  const issues: Issue[] = [];
  const events: IssueEvent[] = [];

  function makeIssues(p: Project, titles: string[], ms: Milestone[], spanDays: number) {
    titles.forEach((title, idx) => {
      const seq = idx + 1;
      // Creation spread across the span, earlier issues first.
      const createdAt = addHours(
        subDays(now, spanDays - Math.floor((idx / titles.length) * spanDays) - Math.floor(rand() * 3)),
        9 + Math.floor(rand() * 8),
      );
      const ageDays = (now.getTime() - createdAt.getTime()) / 86400000;
      // Older issues are further along.
      let path: IssueStatus[];
      const r = rand();
      if (ageDays > 28) path = r < 0.85 ? ["triage", "backlog", "todo", "in_progress", "in_review", "done"] : ["triage", "backlog", "todo", "in_progress"];
      else if (ageDays > 14) path = r < 0.5 ? ["triage", "backlog", "todo", "in_progress", "in_review", "done"] : r < 0.8 ? ["triage", "backlog", "todo", "in_progress"] : ["triage", "backlog", "todo"];
      else if (ageDays > 5) path = r < 0.25 ? ["triage", "backlog", "todo", "in_progress", "done"] : r < 0.6 ? ["triage", "backlog", "in_progress"] : r < 0.85 ? ["triage", "backlog"] : ["triage"];
      else path = r < 0.5 ? ["triage"] : r < 0.8 ? ["triage", "backlog"] : ["triage", "backlog", "todo"];
      if (idx === 23 && p.key === "PLAT") path = ["triage", "backlog", "cancelled"];

      // Walk the path with plausible dwell times, never past now.
      let t = createdAt;
      let startedAt: string | undefined;
      let completedAt: string | undefined;
      let status: IssueStatus = "triage";
      let prev: IssueStatus | null = null;
      for (let s = 0; s < path.length; s++) {
        const st = path[s];
        if (s > 0) {
          const dwell = st === "backlog" ? rand() * 24 : st === "todo" ? rand() * 72 : st === "in_progress" ? 6 + rand() * 30 : st === "in_review" ? 24 + rand() * 96 : 4 + rand() * 40;
          t = addHours(t, dwell);
          if (t > now) break;
        }
        events.push({ id: id(), issueId: "", projectId: p.id, at: t.toISOString(), from: prev, to: st });
        prev = st;
        status = st;
        if ((st === "in_progress" || st === "in_review") && !startedAt) startedAt = t.toISOString();
        if (st === "done") completedAt = t.toISOString();
      }
      const milestone =
        status === "done" || ageDays > 28 ? ms[0] : ageDays > 12 ? ms[1] : rand() < 0.7 ? ms[Math.min(2, ms.length - 1)] : ms[Math.min(1, ms.length - 1)];
      const priority: Priority = pick(["urgent", "high", "high", "medium", "medium", "medium", "low", "none"]);
      const assignee = status === "triage" ? undefined : pick(people.slice(0, 4));
      const dueDate =
        status !== "done" && status !== "cancelled" && rand() < 0.5
          ? ymd(addDays(now, Math.floor(rand() * 20) - 4))
          : undefined;
      const issue: Issue = {
        id: id(),
        projectId: p.id,
        seq,
        milestoneId: status === "triage" ? undefined : milestone.id,
        title,
        description: "",
        status,
        priority,
        assigneeId: assignee?.id,
        dueDate,
        labels: rand() < 0.6 ? [pick(LABELS)] : [],
        order: seq,
        startedAt,
        completedAt,
        createdAt: createdAt.toISOString(),
        updatedAt: t.toISOString(),
      };
      // Patch event issue ids for this issue (they were pushed with "").
      for (const e of events) if (e.issueId === "") e.issueId = issue.id;
      issues.push(issue);
    });
  }
  makeIssues(plat, PLAT_TITLES, platMs, 56);
  makeIssues(bill, BILL_TITLES, billMs, 35);

  const risks: Risk[] = [
    {
      id: id(), projectId: plat.id, seq: 1, kind: "risk",
      title: "Row-level security bypassed by a module checking out its own connection",
      description: "Module code that imports the database package can read across tenants.",
      likelihood: 2, impact: 5, status: "mitigating", ownerId: people[0].id,
      mitigation: "Lint rule blocks the import; boot probe attempts a cross-tenant read.",
      dueDate: ymd(addDays(now, 7)), createdAt: subDays(now, 20).toISOString(), updatedAt: nowISO,
    },
    {
      id: id(), projectId: plat.id, seq: 2, kind: "dependency",
      title: "Arabic full-text search recall depends on an ICU-aware analyzer",
      description: "Snowball's arabic config cannot meet the recall floor.",
      likelihood: 4, impact: 3, status: "open", ownerId: people[2].id,
      mitigation: "Spike a trigram + unaccent approach; measure against a labelled set.",
      dueDate: ymd(addDays(now, 14)), createdAt: subDays(now, 12).toISOString(), updatedAt: nowISO,
    },
    {
      id: id(), projectId: plat.id, seq: 3, kind: "assumption",
      title: "Customers accept a pre-deploy migration window",
      description: "Expand/contract keeps it short, but air-gapped sites run it by hand.",
      likelihood: 3, impact: 2, status: "accepted", ownerId: me.id, mitigation: "Stated in the ops guide.",
      createdAt: subDays(now, 30).toISOString(), updatedAt: nowISO,
    },
    {
      id: id(), projectId: plat.id, seq: 4, kind: "issue",
      title: "Staging Postgres has no lock or statement timeouts",
      description: "A long query can block a migration and everything behind it.",
      likelihood: 5, impact: 3, status: "open", ownerId: people[2].id,
      mitigation: "Ansible baseline sets the three timeouts; apply and verify.",
      dueDate: ymd(addDays(now, -2)), createdAt: subDays(now, 9).toISOString(), updatedAt: nowISO,
    },
    {
      id: id(), projectId: bill.id, seq: 1, kind: "risk",
      title: "ZATCA phase 2 requirements change before launch",
      description: "E-invoicing spec revisions could invalidate the PDF and XML formats.",
      likelihood: 3, impact: 4, status: "open", ownerId: me.id,
      mitigation: "Isolate the compliance module; subscribe to the ZATCA bulletin.",
      createdAt: subDays(now, 15).toISOString(), updatedAt: nowISO,
    },
    {
      id: id(), projectId: bill.id, seq: 2, kind: "dependency",
      title: "Payment provider sandbox availability",
      description: "Sandbox account still pending; blocks the adapter integration tests.",
      likelihood: 4, impact: 4, status: "mitigating", ownerId: people[0].id,
      mitigation: "Build against the recorded fixtures until the sandbox is live.",
      dueDate: ymd(addDays(now, 5)), createdAt: subDays(now, 6).toISOString(), updatedAt: nowISO,
    },
    {
      id: id(), projectId: bill.id, seq: 3, kind: "risk",
      title: "Proration rounding drifts from the finance team's spreadsheet",
      description: "Two rounding policies produce cent-level differences on annual plans.",
      likelihood: 2, impact: 2, status: "closed", ownerId: people[3].id,
      mitigation: "Agreed on round-half-even per line; golden tests added.",
      createdAt: subDays(now, 25).toISOString(), updatedAt: nowISO,
    },
  ];

  const decisions: Decision[] = [
    {
      id: id(), projectId: plat.id, seq: 1, title: "PostgreSQL only — no second datastore until a stated trigger fires",
      status: "accepted", date: ymd(subDays(now, 50)),
      context: "Every deployment target includes fully air-gapped sites. Each extra datastore is another thing to install, back up and restore there.",
      decision: "Use PostgreSQL 16 for relational data, queues (outbox) and search. Add Redis only for wake-ups and caching; add a broker only when the outbox relay measurably cannot keep up.",
      consequences: "Simpler ops; search recall is bounded by Postgres text search, which is a known open risk for Arabic.",
      alternatives: "Kafka for events (rejected: ops burden air-gapped); Elasticsearch for search (deferred behind a measured trigger).",
      tags: ["architecture"], createdAt: subDays(now, 50).toISOString(), updatedAt: nowISO,
    },
    {
      id: id(), projectId: plat.id, seq: 2, title: "Tenant isolation is proven, not asserted",
      status: "accepted", date: ymd(subDays(now, 44)),
      context: "Row-level security silently returns zero rows when the tenant context is unbound, which reads as 'no data' rather than as a fault.",
      decision: "A boot probe, a CI job and an hourly production job each attempt a cross-tenant read and fail loudly on success. Policies read the setting without the missing-ok flag so an unbound context raises.",
      consequences: "Every environment carries a small probe; a broken policy is found in minutes, not in an audit.",
      alternatives: "Trust code review alone (rejected: the failure is silent).",
      tags: ["security", "tenancy"], createdAt: subDays(now, 44).toISOString(), updatedAt: nowISO,
    },
    {
      id: id(), projectId: plat.id, seq: 3, title: "Migrations run as a pre-deploy job, expand/contract only",
      status: "accepted", date: ymd(subDays(now, 33)),
      context: "Rollback must be a deploy of the previous release with nothing to reverse in the schema.",
      decision: "Exactly one migrator, run before the new release starts. Every change must let the previous release's code run against the new schema.",
      consequences: "Some changes take two releases. A change that cannot satisfy this is not rollback-safe and needs its own plan in the PR.",
      alternatives: "Migrate at application boot (rejected: multiple instances race, and boot becomes the outage).",
      tags: ["ops"], createdAt: subDays(now, 33).toISOString(), updatedAt: nowISO,
    },
    {
      id: id(), projectId: bill.id, seq: 4, title: "Invoice numbers are per tenant and gap-free",
      status: "proposed", date: ymd(subDays(now, 4)),
      context: "KSA tax rules require sequential invoice numbering; tenants must not observe each other's volume.",
      decision: "A per-tenant counter row locked inside the invoice transaction; numbering restarts per tenant, never globally.",
      consequences: "Serialised invoice creation per tenant; acceptable at expected volume, revisit above 10/s per tenant.",
      alternatives: "Global sequence (rejected: cross-tenant volume oracle).",
      tags: ["compliance"], createdAt: subDays(now, 4).toISOString(), updatedAt: nowISO,
    },
  ];

  const docNotes: Note[] = [
    {
      id: id(), projectId: plat.id, title: "Module contract for department teams", kind: "rfc", status: "in_review", folder: "Specs", date: ymd(subDays(now, 18)), pinned: false,
      body: `## Summary
Departments install into the base as modules. This RFC fixes what a module may and may not do so the base can prove isolation. Builds on [[ADR-1]] and [[ADR-2]].

## Context
Tenancy, audit and permissions live in the base. A module that re-implements any of them is a module that can get them wrong.

## Design
- A module receives a **pre-bound transaction handle**. It never checks out a connection.
- A module registers routes, events and jobs through the registry. It never imports another module.
- A module may add **restrictive** row policies only.

## Alternatives considered
- **Plugins as separate services** — rejected: doubles the air-gapped install surface.

## Risks and rollout
Lint rules enforce the import boundary inside the repo; contract tests run on every extension point.

## Open questions
- Should modules be allowed their own migrations, or must they ship as base migrations?
`,
      tags: ["modules"], createdAt: subDays(now, 18).toISOString(), updatedAt: subDays(now, 2).toISOString(),
    },
    {
      id: id(), projectId: bill.id, title: "Billing v2 — PRD", kind: "prd", status: "approved", folder: "Specs", date: ymd(subDays(now, 28)), pinned: true,
      body: `## Problem
Invoices are produced by hand in a spreadsheet at month end; three tenants have received a wrong VAT line this quarter.

## Goals
- Generate correct, sequential, bilingual invoices automatically.
- Support plan changes mid-cycle with proration the finance team can reproduce.

## Non-goals
- Card payments in v2 (bank transfer and provider hosted pages only).

## Proposal
A billing module on the platform base with a per-tenant invoice sequence, a plan catalogue and a dunning schedule.

## Success metrics
| Metric | Today | Target |
|---|---|---|
| Invoices corrected after issue | 3 / quarter | 0 |
| Time to close the month | 4 days | 1 day |

## Open questions
- Which provider for hosted payment pages?
`,
      tags: ["billing"], createdAt: subDays(now, 28).toISOString(), updatedAt: subDays(now, 10).toISOString(),
    },
    {
      id: id(), projectId: plat.id, title: "Restore the production database from last night's backup", kind: "runbook", status: "approved", folder: "Runbooks", date: ymd(subDays(now, 22)), pinned: false,
      body: NOTE_TEMPLATES.runbook.replace("## Steps\n1. \n2. ", "## Steps\n1. Confirm the backup artifact exists and the checksum matches.\n2. Restore with \`pg_restore --create\` so the collation provider is preserved.\n3. Run the isolation probe against the restored copy."),
      tags: ["ops"], createdAt: subDays(now, 22).toISOString(), updatedAt: subDays(now, 22).toISOString(),
    },
    {
      id: id(), projectId: plat.id, title: "Staging outage 2026-09-12 — migration blocked by an idle transaction", kind: "postmortem", status: "approved", folder: "Post-mortems", date: ymd(subDays(now, 14)), pinned: false,
      body: `## Summary
A deploy's migration waited on a lock held by an idle-in-transaction session for 41 minutes. Staging was read-only for the duration. No production impact.

## Timeline (UTC)
| Time | Event |
|---|---|
| 10:02 | Deploy starts, migration begins |
| 10:04 | Migration blocks on an ACCESS EXCLUSIVE lock |
| 10:31 | Reported by a developer; watcher had not alarmed |
| 10:43 | Idle session terminated; migration completes |

## Impact
Staging writes blocked for 41 minutes.

## Detection
Time to detect: 29 minutes, by a person. Time to fix: 12 minutes.

## Root cause and contributing factors
No lock timeout and no idle-in-transaction timeout on staging; the watcher only checks HTTP status.

## Action items
| Action | Type | Owner | Due |
|---|---|---|---|
| Set lock_timeout and idle_in_transaction_session_timeout via the baseline | prevent | Lina | this week |
| Watcher alarms on lock waits over 60 s | detect | Lina | next week |
`,
      tags: ["ops", "postmortem"], createdAt: subDays(now, 14).toISOString(), updatedAt: subDays(now, 13).toISOString(),
    },
  ];

  const notes: Note[] = [
    {
      id: id(), kind: "daily", folder: "Daily", title: ymd(now), date: ymd(now), pinned: false, tags: [],
      body: `## Focus today
- Review the module contract RFC comments
- Unblock the payment sandbox

## Notes
Sara's isolation probe found nothing overnight. Good. See [[Platform sync]] and [[PLAT-5]].

## Follow-ups
- [ ] Ask finance for the rounding spreadsheet
`,
      createdAt: nowISO, updatedAt: nowISO,
    },
    {
      id: id(), kind: "daily", folder: "Daily", title: ymd(subDays(now, 1)), date: ymd(subDays(now, 1)), pinned: false, tags: [],
      body: `## Focus today
- Weekly update for both projects

## Notes
Proration tests are green. Post-mortem action items are all assigned.
`,
      createdAt: subDays(now, 1).toISOString(), updatedAt: subDays(now, 1).toISOString(),
    },
    {
      id: id(), kind: "meeting", folder: "Meetings", projectId: plat.id, title: "Platform sync", date: ymd(subDays(now, 2)), pinned: false, tags: ["sync"],
      body: `**Attendees:** Sara, Omar, Lina, Youssef
**Purpose:** Weekly platform sync

## Notes
- Tenancy milestone slips three days; review queue is the bottleneck ([[PLAT-11]], [[PLAT-12]]).
- Arabic collation verified on person names.

## Decisions
- Review SLA: 24 hours or say why.

## Actions
- [ ] Lina: apply the Postgres timeouts on staging
- [ ] Omar: split the admin UI issue into two
`,
      createdAt: subDays(now, 2).toISOString(), updatedAt: subDays(now, 2).toISOString(),
    },
    {
      id: id(), kind: "oneonone", folder: "1-1s", personId: people[0].id, title: "1:1 — Sara", date: ymd(subDays(now, 3)), pinned: true, tags: [],
      body: `## Their agenda
- Wants to own the audit-chain work end to end.

## My agenda
- Review load: too many PRs waiting on one person.

## Notes
Agreed she leads audit and events ([[ADR-2]]); Omar picks up review of backend PRs under 200 lines. Context in [[Platform sync]].

## Actions
- [ ] Me: announce the review split at Thursday's sync
`,
      createdAt: subDays(now, 3).toISOString(), updatedAt: subDays(now, 3).toISOString(),
    },
    {
      id: id(), kind: "quick", folder: "Inbox", title: "Ideas for the launch checklist", date: ymd(subDays(now, 5)), pinned: false, tags: ["launch"],
      body: `- External prober from outside both hosts
- Escrow the backup key before we have real tenants — see [[Restore the production database from last night's backup]]
- Load test the outbox relay at 5x expected volume
`,
      createdAt: subDays(now, 5).toISOString(), updatedAt: subDays(now, 5).toISOString(),
    },
  ];

  const updates: Update[] = [];
  const platHealth: Update["health"][] = ["on_track", "on_track", "at_risk", "at_risk"];
  const billHealth: Update["health"][] = ["on_track", "at_risk", "on_track", "on_track"];
  for (let w = 3; w >= 0; w--) {
    const d = subDays(now, w * 7 + 1);
    updates.push({
      id: id(), projectId: plat.id, date: ymd(d), health: platHealth[3 - w], createdAt: d.toISOString(),
      summary: w === 0
        ? `## Health\nAt risk — tenancy milestone slips three days because reviews queue behind one person.\n\n## Shipped this week\n- Tenant context bound per transaction\n- Isolation probe in CI\n\n## Next week\n- Audit log codes\n- Review split between Sara and Omar\n\n## Risks and asks\n- Staging timeouts still unset (PLAT risk 4)`
        : `## Health\n${platHealth[3 - w] === "on_track" ? "On track" : "At risk"}.\n\n## Shipped this week\n- Progress on the walking skeleton.\n`,
    });
    updates.push({
      id: id(), projectId: bill.id, date: ymd(d), health: billHealth[3 - w], createdAt: d.toISOString(),
      summary: w === 0
        ? `## Health\nOn track — invoice core lands next week.\n\n## Shipped this week\n- Proration with golden tests\n- VAT rules\n\n## Next week\n- Invoice PDF, bilingual\n\n## Risks and asks\n- Payment sandbox still pending`
        : `## Health\n${billHealth[3 - w] === "on_track" ? "On track" : "At risk"}.\n`,
    });
  }

  await db.transaction(
    "rw",
    [db.people, db.projects, db.milestones, db.issues, db.issueEvents, db.risks, db.decisions, db.notes, db.updates, db.settings],
    async () => {
      await db.people.bulkAdd(people);
      await db.projects.bulkAdd([plat, bill]);
      await db.milestones.bulkAdd([...platMs, ...billMs]);
      await db.issues.bulkAdd(issues);
      await db.issueEvents.bulkAdd(events);
      await db.risks.bulkAdd(risks);
      await db.decisions.bulkAdd(decisions);
      await db.notes.bulkAdd([...docNotes, ...notes]);
      await db.updates.bulkAdd(updates);
      // Sample records are back-dated; make the next sync a full merge.
      await db.settings.where("key").startsWith("sync.cursor").delete();
    },
  );
  return { projects: 2, issues: issues.length };
}
