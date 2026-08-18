import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { DocumentRouteService } from '../modules/approval/document-route.service';
import { ApproverResolverService } from '../modules/approval/approver-resolver.service';
import { WorkflowStepResolver } from '../modules/approval/workflow-step.resolver';
import { Document } from '../modules/document/document.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Give a hand-seeded document the route it would have got from `start()`.
 *
 * A document only routes on steps recorded at submit. Specs that build a document straight into
 * `IN_APPROVAL` skip `start()`, so without this they route on nothing. Using the real service keeps
 * the fixture honest: the rows are resolved by the same engagement rules production uses, and a
 * step's clock starts where production starts it.
 */
export async function materialiseRoute(
  orm: MikroORM,
  documentId: string,
  openStepNo?: number,
  startedAt?: Date,
): Promise<void> {
  const em: EntityManager = orm.em.fork();
  const route = new DocumentRouteService(em, new WorkflowStepResolver(em), new ApproverResolverService(em));
  const document = await em.findOneOrFail(Document, { id: documentId }, FILTER_OFF);
  const steps = await route.materialise(document, em);
  const open = steps.find((s) => s.stepNo === (openStepNo ?? document.currentStepNo)) ?? steps[0];
  if (open) await route.openStep(open, document, em, startedAt ?? document.submittedAt ?? new Date());
  await em.flush();
}
