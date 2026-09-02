import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { AppModule } from '../src/app.module';
import { RequestContext } from '../src/common/context/request-context';
import { DocStatus } from '../src/common/enums';
import {
  ApprovalLog,
  DocumentApprovalStep,
  ROUTE_STEP_STATUS,
} from '../src/modules/approval/approval.entities';
import { DocumentRouteService } from '../src/modules/approval/document-route.service';
import { WorkflowStepResolver } from '../src/modules/approval/workflow-step.resolver';
import { Document } from '../src/modules/document/document.entities';

/**
 * One-off repair for documents that were already in approval when `document_approval_step` arrived.
 *
 * Routing used to re-derive a document's chain from `workflow_step` on every advance. It now runs
 * the route recorded at submit (`Migration20260828000000`), and nothing backfilled the documents
 * that were mid-approval when that changed. They have no route rows, so:
 *
 *   const step = await this.route.routeStep(...);
 *   if (!step) throw new BadRequestException('No current workflow step');
 *
 * That line sits BEFORE the action switch in `ApprovalRoutingService.act`, so such a document can be
 * neither approved NOR rejected NOR returned — it is frozen, and `canAct` answers a bare false, so
 * the screen says "you cannot act on this" and names no reason.
 *
 * What this rebuilds, and what it cannot:
 *
 * - The route is rebuilt from the workflow's CURRENT configuration, because nothing recorded what
 *   the document actually ran — that is the very gap being repaired. If a step's approver, amount
 *   band or level condition changed since the document was submitted, the rebuilt route reflects
 *   today's configuration. The plan below prints every step it would write so that can be checked
 *   before `--apply`, and refuses any document whose current step number the configuration no
 *   longer produces rather than opening the wrong step.
 * - Steps the document already passed are closed as DONE, stamped with the `approval_log` entry
 *   that passed them — the log is the record of what happened and it survived intact.
 * - The current step is opened at the moment it really began: the latest log entry before it, or
 *   the document's submit time when it is still on its first step. NOT `now` — that would restate
 *   a document that has been waiting for weeks as one that just arrived, and hide it from the SLA.
 *
 * Writes no `budget_txn`, no `quota_usage` and no `approval_log`: this restores the routing rows a
 * migration should have written, and changes nothing about what was approved.
 *
 * Dry-run by default — prints the plan and writes nothing. Pass `--apply` to write.
 *   pnpm --filter back exec ts-node -P tsconfig.json scripts/repair-document-routes.ts [--apply]
 */

const APPLY = process.argv.includes('--apply');
const FILTER_OFF = { filters: { company: false } } as const;

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const em = app.get(EntityManager).fork();
    const route = app.get(DocumentRouteService);
    const stepResolver = app.get(WorkflowStepResolver);

    const inApproval = await em.find(
      Document,
      { status: DocStatus.IN_APPROVAL },
      { ...FILTER_OFF, populate: ['company', 'department', 'workflow'], orderBy: { docNo: 'ASC' } },
    );

    const stranded: Document[] = [];
    for (const doc of inApproval) {
      const live = await em.count(
        DocumentApprovalStep,
        { document: doc.id, supersededAt: null },
        FILTER_OFF,
      );
      if (live === 0) stranded.push(doc);
    }

    if (!stranded.length) {
      console.log('repair-document-routes: every document in approval already has a route. Nothing to do.');
      return;
    }

    console.log(
      `repair-document-routes: ${stranded.length} document(s) in approval carry no route and cannot be acted on.\n`,
    );

    let repairable = 0;
    for (const doc of stranded) {
      const logs = await em.find(
        ApprovalLog,
        { document: doc.id },
        { ...FILTER_OFF, orderBy: { actedAt: 'ASC' } },
      );
      const lastActed = logs.length ? logs[logs.length - 1].actedAt : undefined;
      const openedAt = lastActed ?? doc.submittedAt ?? doc.createdAt ?? new Date();

      console.log(`  ${doc.docNo}  (${doc.company.code}, workflow "${doc.workflow?.name ?? '—'}")`);
      console.log(`    waiting on step ${doc.currentStepNo} since ${openedAt.toISOString()}`);

      // Resolve the configuration the same way routing does, inside the document's own context —
      // `applicableSteps` reads company-scoped master data for its level conditions.
      const configured = await RequestContext.run(
        { userId: doc.createdBy.id, companyId: doc.company.id, departmentId: doc.department.id, grants: [] },
        () => stepResolver.applicableSteps(doc, em),
      );

      if (!configured.length) {
        console.log('    REFUSED: the workflow produces no applicable step for this document today.');
        continue;
      }
      const current = configured.find((s) => s.stepNo === doc.currentStepNo);
      if (!current) {
        console.log(
          `    REFUSED: today's configuration produces steps [${configured.map((s) => s.stepNo).join(', ')}] ` +
            `— step ${doc.currentStepNo} is not among them, so there is no step to reopen.`,
        );
        continue;
      }
      repairable++;
      for (const s of configured) {
        const state = s.stepNo < doc.currentStepNo ? 'DONE (already approved)' : s.stepNo === doc.currentStepNo ? 'OPEN' : 'pending';
        const who = s.approverRole?.name ?? s.approverUser?.username ?? '—';
        const slip = s.requiresPaymentSlip ? ', requires slip' : '';
        console.log(`      step ${s.stepNo}: ${who} [${state}]${slip}`);
      }
    }

    console.log(
      `\n${repairable} of ${stranded.length} can be repaired.` +
        (APPLY ? ' Applying...\n' : ' Dry run — pass --apply to write.\n'),
    );
    if (!APPLY) return;

    for (const doc of stranded) {
      const logs = await em.find(
        ApprovalLog,
        { document: doc.id },
        { ...FILTER_OFF, orderBy: { actedAt: 'ASC' } },
      );
      const openedAt = (logs.length ? logs[logs.length - 1].actedAt : undefined) ?? doc.submittedAt ?? doc.createdAt ?? new Date();

      await RequestContext.run(
        { userId: doc.createdBy.id, companyId: doc.company.id, departmentId: doc.department.id, grants: [] },
        async () => {
          // One transaction per document: a half-written route is exactly the state being repaired.
          await em.transactional(async (tem) => {
            const fresh = await tem.findOneOrFail(Document, { id: doc.id }, { ...FILTER_OFF, populate: ['company', 'department', 'workflow'] });
            const rows = await route.materialise(fresh, tem);
            const current = rows.find((r) => r.stepNo === fresh.currentStepNo);
            if (!current) throw new Error(`step ${fresh.currentStepNo} not produced for ${fresh.docNo}`);

            // Close what the log says was already passed, stamped with when it was passed.
            for (const row of rows.filter((r) => r.stepNo < fresh.currentStepNo)) {
              const passed = logs.filter((l) => l.stepNo === row.stepNo).pop();
              row.status = ROUTE_STEP_STATUS.DONE;
              row.completedAt = passed?.actedAt ?? openedAt;
              row.startedAt ??= passed?.actedAt ?? fresh.submittedAt ?? openedAt;
            }
            await tem.flush();
            await route.openStep(current, fresh, tem, openedAt);
          });
          console.log(`  repaired ${doc.docNo} — step ${doc.currentStepNo} reopened`);
        },
      ).catch((e: unknown) => {
        console.log(`  SKIPPED ${doc.docNo}: ${(e as Error).message}`);
      });
    }
    console.log('\nrepair-document-routes: done.');
  } finally {
    await app.close();
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
