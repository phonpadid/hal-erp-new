import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { Money } from '../../common/money/money';
import { Document, DocumentLine } from '../document/document.entities';
import { Account } from '../accounting/accounting.entities';
import { ancestorAccountByLine } from './gl-posting.service';

const FILTER_OFF = { filters: { company: false } } as const;

export interface OutstandingReceipt {
  account: Account;
  amount: string;
}

/**
 * What the company has received and has not yet been invoiced for.
 *
 * The gap accrual accounting has at the front of a purchase: a service delivered on the 28th and
 * invoiced on the 5th belongs to the month it was delivered, and without this the expense lands in
 * the month the invoice arrived and the liability appears in neither.
 *
 * Computable rather than estimable because the data already exists — `received_qty` is maintained by
 * the receipt path, and three-way matching already links a disbursement to its order by `line_no`.
 * This service asks the same question matching does, from the other direction.
 */
@Injectable()
export class ReceivedNotInvoicedService {
  constructor(private readonly em: EntityManager) {}

  /**
   * Outstanding value per expense account, as at `asOf`, for one company.
   *
   * Empty when everything received has been invoiced — which is what makes a close post nothing
   * rather than a zero-value entry.
   */
  async outstanding(companyId: string, asOf: string): Promise<OutstandingReceipt[]> {
    const em = this.em.fork();

    // Purchase orders. `received_qty` lives on the ORDER's lines; a disbursement's lines carry what
    // was invoiced.
    const orders = await em.find(Document, { company: companyId }, { ...FILTER_OFF });
    if (!orders.length) return [];

    // Received ON OR BEFORE `asOf`, by `last_received_at` — not by the order's `created_at`, which
    // is when somebody raised the purchase and says nothing about when the goods arrived.
    //
    // A null date means the receipt predates that column. Those lines are INCLUDED: the goods were
    // received at some unknown point in the past, so at any period end they are outstanding, and
    // excluding them would silently understate rather than admit the gap.
    const orderIds = orders.map((o) => o.id);
    const cutoff = new Date(`${asOf}T23:59:59.999Z`);
    const lines = (
      await em.find(
        DocumentLine,
        { document: { $in: orderIds }, receivedQty: { $gt: '0' } },
        { ...FILTER_OFF, populate: ['item', 'budget.account'] },
      )
    ).filter((l) => !l.lastReceivedAt || l.lastReceivedAt <= cutoff);
    if (!lines.length) return [];

    // What has been invoiced against each order line: the lines of every document referencing that
    // order, matched by `line_no` — the same link `MatchingService` reads, from the other side.
    const withReceipts = [...new Set(lines.map((l) => l.document.id))];
    const invoices = await em.find(
      Document,
      { refDocument: { $in: withReceipts } },
      { ...FILTER_OFF, populate: ['refDocument'] },
    );
    const invoiceLines = invoices.length
      ? await em.find(
          DocumentLine,
          { document: { $in: invoices.map((i) => i.id) } },
          FILTER_OFF,
        )
      : [];
    const invoicedByOrderLine = new Map<string, string>();
    const orderOfInvoice = new Map(invoices.map((i) => [i.id, i.refDocument!.id]));
    for (const il of invoiceLines) {
      const orderId = orderOfInvoice.get(il.document.id);
      if (!orderId) continue;
      const key = `${orderId}:${il.lineNo}`;
      invoicedByOrderLine.set(key, Money.add(invoicedByOrderLine.get(key) ?? '0', il.qty));
    }

    // A purchase-order type is ordinarily not budget-controlled, so its lines carry no account.
    // The account belongs to the document that reserved, at the same `line_no` — the fourth place
    // this walk is needed, and the reason it is now one helper.
    const accountsByOrder = new Map<string, Map<number, Account>>();

    const byAccount = new Map<string, { account: Account; amount: string }>();
    for (const line of lines) {
      // Stock is already covered: its receipt credited GRNI, which is this accrual by another name.
      // Accruing again would recognise the same purchase twice. An ITEM-LESS line is included —
      // a free-text service line is exactly the case with no other coverage.
      if (line.item?.isStockTracked) continue;

      const orderId = line.document.id;
      const invoiced = invoicedByOrderLine.get(`${orderId}:${line.lineNo}`) ?? '0';
      const outstandingQty = Money.subtract(line.receivedQty, invoiced);
      if (Money.compare(outstandingQty, '0') <= 0) continue;

      // Base currency at the locked rate — the same basis the budget was cut on and the receipt was
      // costed at, so the accrual, the cut and the eventual invoice are all measured alike.
      // `unit_price` is a DOCUMENT-currency figure and would mix currencies into a base ledger.
      const base = line.budgetBaseLineAmount ?? line.baseLineAmount;
      if (!base || Money.compare(line.qty, '0') <= 0) continue;
      const unit = Money.divide(base, line.qty);
      const amount = Money.round(Money.multiply(unit, outstandingQty), 2);
      if (Money.compare(amount, '0') <= 0) continue;

      let account = line.budget?.account;
      if (!account) {
        if (!accountsByOrder.has(orderId)) {
          accountsByOrder.set(orderId, await ancestorAccountByLine(em, orderId));
        }
        account = accountsByOrder.get(orderId)!.get(line.lineNo);
      }
      if (!account) continue;

      const cur = byAccount.get(account.id);
      byAccount.set(account.id, {
        account,
        amount: cur ? Money.add(cur.amount, amount) : amount,
      });
    }

    return [...byAccount.values()];
  }
}
