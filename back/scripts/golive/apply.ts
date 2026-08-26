import { EntityManager } from '@mikro-orm/postgresql';
import { Money } from '../../src/common/money/money';
import { RequestContext } from '../../src/common/context/request-context';
import { DeptDocTypeService } from '../../src/modules/document/dept-doc-type.service';
import { FormTemplateService } from '../../src/modules/document/form-template.service';
import { DocumentTypeService } from '../../src/modules/document/document-type.service';
import { WorkflowConfigService } from '../../src/modules/approval/workflow-config.service';
import { ExchangeRateService } from '../../src/modules/currency/exchange-rate.service';
import { WorkflowStep } from '../../src/modules/approval/approval.entities';
import { ExchangeRate } from '../../src/modules/currency/currency.entities';
import { DocumentType } from '../../src/modules/document/document.entities';
import type { GoliveConfig } from './config';
import type { Resolved } from './resolve';

const FILTER_OFF = { filters: { company: false } } as const;

/** Every service the applier writes through. Written through, never around — see the design. */
export interface ApplyServices {
  em: EntityManager;
  mappings: DeptDocTypeService;
  templates: FormTemplateService;
  types: DocumentTypeService;
  workflows: WorkflowConfigService;
  rates: ExchangeRateService;
}

/** One line per thing done, or per thing deliberately not done. Both belong in the output. */
export interface ApplyResult {
  changed: string[];
  unchanged: string[];
  /** Active types the file said nothing about. Omitting a decision must not look like making one. */
  untouched: string[];
}

/**
 * Reconcile a company's configuration to what the file states.
 *
 * **Idempotent.** Applying the same file twice changes nothing the second time, so it can be run
 * against staging, reviewed, then run against production — and re-run after a partial failure
 * without anyone having to work out how far it got.
 *
 * **Never defaults.** A type the file does not mention is left alone and listed under `untouched`.
 * The tempting shortcut — map every unmapped type to some plausible department and let people fix
 * it later — is refused: eleven wrong routes reach production faster than one right one, and a
 * wrong route is not visibly wrong afterwards, because every downstream rule is *about* the route.
 *
 * **Through the owning services.** `DeptDocTypeService.create` refuses a retired template, refuses
 * a cross-company pair, and asserts the type's reservation can be settled; `WorkflowConfigService`
 * validates step targets; `ExchangeRateService` owns rate resolution. Writing rows directly would
 * bypass every one and could install configuration the screens themselves would have refused.
 */
export async function apply(
  services: ApplyServices,
  config: GoliveConfig,
  resolved: Resolved,
  /**
   * The user this reconcile is attributed to. Required, not defaulted: rows this writes carry a
   * `created_by`, and a configuration change nobody is named on is a change nobody can be asked
   * about six months later.
   */
  actorId: string,
): Promise<ApplyResult> {
  const result: ApplyResult = { changed: [], unchanged: [], untouched: [] };

  // The services read the active company from the request context, exactly as they do behind an
  // HTTP request. Running the whole reconcile inside one context is what lets them be reused
  // unchanged rather than re-implemented for the script.
  await RequestContext.run({ companyId: resolved.company.id, userId: actorId, grants: [] } as never, async () => {
    await applyWorkflows(services, config, resolved, result);
    await applyDocumentTypes(services, config, resolved, result);
    await applyPublishes(services, config, resolved, result);
    await applyRates(services, config, resolved, result);
  });

  await reportUntouched(services.em, config, resolved, result);
  return result;
}

/**
 * Replace a workflow's steps with what the file states.
 *
 * Replace rather than merge: a chain is an ordered whole, and half of a new chain beside half of an
 * old one is a routing table nobody wrote. Skipped entirely when the existing steps already match,
 * which is what makes a second apply a no-op.
 */
async function applyWorkflows(
  s: ApplyServices, config: GoliveConfig, r: Resolved, out: ApplyResult,
): Promise<void> {
  for (const [name, spec] of Object.entries(config.workflows)) {
    const workflow = r.workflows.get(name)!;
    const existing = await s.em.find(
      WorkflowStep,
      { workflow: workflow.id },
      { ...FILTER_OFF, populate: ['approverRole'], orderBy: { stepNo: 'ASC' } },
    );
    const wanted = [...spec.steps].sort((a, b) => a.stepNo - b.stepNo);

    const same =
      existing.length === wanted.length &&
      existing.every((step, i) =>
        step.stepNo === wanted[i].stepNo &&
        step.approverRole?.code === wanted[i].approverRole &&
        (step.amountMin ?? null) === (wanted[i].amountMin ?? null) &&
        (step.amountMax ?? null) === (wanted[i].amountMax ?? null));
    if (same) {
      out.unchanged.push(`workflow "${name}" already has these ${wanted.length} step(s)`);
      continue;
    }

    for (const step of existing) await s.workflows.deleteStep(step.id);
    for (const step of wanted) {
      await s.workflows.addStep({
        workflowId: workflow.id,
        stepNo: step.stepNo,
        approverRoleId: r.roles.get(step.approverRole)!.id,
        amountMin: step.amountMin ?? undefined,
        amountMax: step.amountMax ?? undefined,
      } as never);
    }
    out.changed.push(`workflow "${name}": ${existing.length} step(s) replaced by ${wanted.length}`);
  }
}

/** Mappings and authoring routes, per document type. */
async function applyDocumentTypes(
  s: ApplyServices, config: GoliveConfig, r: Resolved, out: ApplyResult,
): Promise<void> {
  for (const [code, spec] of Object.entries(config.documentTypes)) {
    const type = r.documentTypes.get(code)!;

    if (spec.authoringRoute != null) {
      if (type.authoringRoute === spec.authoringRoute) {
        out.unchanged.push(`${code} already routes authoring to ${spec.authoringRoute}`);
      } else {
        await s.types.update(type.id, { authoringRoute: spec.authoringRoute } as never);
        out.changed.push(`${code}: authoring_route set to ${spec.authoringRoute}`);
      }
    }

    for (const m of spec.mappings) {
      const key = `${code}/${m.department}`;
      const existing = r.mappings.get(key);
      const workflow = r.workflows.get(m.workflow)!;
      const template = r.formTemplates.get(`${code}/${m.formTemplate}`)!;

      if (!existing) {
        const created = await s.mappings.create({
          departmentId: r.departments.get(m.department)!.id,
          documentTypeId: type.id,
          formTemplateId: template.id,
          workflowId: workflow.id,
        });
        // Into the map, so `publishTemplates` can name a pair this same run just created. The map
        // was built before any write; without this a file that maps a type AND publishes its form
        // would need two runs, and the second would be the one that made the type usable.
        r.mappings.set(key, created);
        out.changed.push(`${key}: mapped to workflow "${m.workflow}", form v${m.formTemplate}`);
        continue;
      }

      const same =
        existing.workflow.id === workflow.id &&
        existing.formTemplate.id === template.id &&
        existing.isActive;
      if (same) {
        out.unchanged.push(`${key} already maps to workflow "${m.workflow}", form v${m.formTemplate}`);
        continue;
      }
      const updated = await s.mappings.update(existing.id, {
        workflowId: workflow.id,
        formTemplateId: template.id,
        isActive: true,
      } as never);
      r.mappings.set(key, updated);
      out.changed.push(`${key}: remapped to workflow "${m.workflow}", form v${m.formTemplate}`);
    }
  }
}

/** DRAFT → PUBLISHED for each `TYPE/DEPT` the file names. */
async function applyPublishes(
  s: ApplyServices, config: GoliveConfig, r: Resolved, out: ApplyResult,
): Promise<void> {
  for (const pair of config.publishTemplates) {
    const mapping = r.mappings.get(pair);
    if (!mapping) {
      // Not an error: the file may name a pair this run is also creating, or one already removed.
      out.untouched.push(`${pair}: no mapping to publish a form for`);
      continue;
    }
    if (mapping.formTemplate.status === 'PUBLISHED') {
      out.unchanged.push(`${pair}: form v${mapping.formTemplate.version} already PUBLISHED`);
      continue;
    }
    await s.templates.publish(mapping.formTemplate.id);
    out.changed.push(`${pair}: form v${mapping.formTemplate.version} published`);
  }
}

/**
 * Rates, skipped when the same rate is already on file for that pair, type and date.
 *
 * A rate row is immutable here — `ExchangeRateService` offers `createRate` and nothing else, and
 * `exchange_rate` is unique on (company, from, to, date, type). So a file naming a DIFFERENT rate
 * for a key that already exists is a conflict, not an instruction: rewriting the row behind the
 * service's back is precisely what this applier is built not to do. It is reported and the run
 * fails, leaving the human to pick another `rateDate` or change it on the screen that owns it.
 */
async function applyRates(
  s: ApplyServices, config: GoliveConfig, r: Resolved, out: ApplyResult,
): Promise<void> {
  for (const rate of config.exchangeRates) {
    const from = rate.from.toUpperCase();
    const to = rate.to.toUpperCase();
    const existing = await s.em.findOne(
      ExchangeRate,
      // `from_currency`/`to_currency` are relations to Currency, whose primary key IS the code,
      // so a bare code is the right value for both — cast because MikroORM types the shorthand
      // as the entity rather than its key.
      { fromCurrency: from, toCurrency: to, rateType: rate.rateType, rateDate: rate.rateDate, company: r.company.id } as never,
      FILTER_OFF,
    );
    if (existing) {
      // Compared as decimals, not as strings: the column is scale 8, so a file saying "21500.00"
      // meets a stored "21500.00000000". They are the same rate, and a second apply must say so
      // rather than trying to insert over the unique constraint.
      if (Money.compare(existing.rate, rate.rate) === 0) {
        out.unchanged.push(`${from}->${to} (${rate.rateType}) already ${rate.rate} on ${rate.rateDate}`);
        continue;
      }
      throw new Error(
        `${from}->${to} (${rate.rateType}) on ${rate.rateDate} is already ${existing.rate}, and the ` +
          `file says ${rate.rate}. A rate row cannot be rewritten — give the new rate its own ` +
          `rateDate, or change it on the exchange-rate screen.`,
      );
    }
    await s.rates.createRate({
      fromCurrency: from,
      toCurrency: to,
      rate: rate.rate,
      rateDate: rate.rateDate,
      rateType: rate.rateType,
      companyId: r.company.id,
    } as never);
    out.changed.push(`${from}->${to} (${rate.rateType}) set to ${rate.rate} on ${rate.rateDate}`);
  }
}

/** Active types the file said nothing about. Silence would be defaulting by another name. */
async function reportUntouched(
  em: EntityManager, config: GoliveConfig, r: Resolved, out: ApplyResult,
): Promise<void> {
  const named = new Set(Object.keys(config.documentTypes));
  const active = await em.find(
    DocumentType,
    { company: r.company.id, isActive: true },
    { ...FILTER_OFF, orderBy: { code: 'ASC' } },
  );
  for (const type of active) {
    if (!named.has(type.code)) out.untouched.push(`${type.code}: not mentioned by this file`);
  }
}
