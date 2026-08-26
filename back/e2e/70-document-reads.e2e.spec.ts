import { expect, test } from '@playwright/test';
import { getSandbox } from './support/sandbox';
import type { DocTypeInfo, Sandbox } from './support/provision';
import { M } from './support/money';
import { API_BASE, API_PREFIX } from './support/api';
import {
  approveToEnd,
  authorDraft,
  createActiveBudget,
  getDoc,
  waitForStatus,
} from './support/flows';

/**
 * What the people around a document can see while it moves: the approver's queue, the detail the
 * screen renders, the printable copy, and the evidence attached to it. A flow that works but
 * cannot be seen is not finished.
 */

let s: Sandbox;
let REC: DocTypeInfo;

test.beforeAll(async () => {
  s = await getSandbox();
  REC = s.docTypes.find((t) => t.code === 'REC')!;
});

test('a submitted document appears in its approver’s queue and leaves it once acted on', async () => {
  const id = await authorDraft(s, REC, { amount: '350000' });
  await s.requester.api.post(`/documents/${id}/submit`);
  await waitForStatus(s.requester.api, id, ['IN_APPROVAL']);

  const queue = await s.approver1.api.get<
    { items: Array<{ id: string }> } | Array<{ id: string }>
  >('/approvals/pending?limit=100');
  const items = Array.isArray(queue) ? queue : queue.items;
  expect(
    items.some((d) => d.id === id),
    'the document is not in the approver’s queue',
  ).toBe(true);

  // Someone with no part in it does not see it in theirs.
  const otherQueue = await s.approver2.api.get<
    { items: Array<{ id: string }> } | Array<{ id: string }>
  >('/approvals/pending?limit=100');
  const otherItems = Array.isArray(otherQueue) ? otherQueue : otherQueue.items;
  expect(
    otherItems.some((d) => d.id === id),
    'a step-2 approver should not be queued for a document still on step 1',
  ).toBe(false);

  await approveToEnd(s, id);
  const after = await s.approver1.api.get<
    { items: Array<{ id: string }> } | Array<{ id: string }>
  >('/approvals/pending?limit=100');
  const afterItems = Array.isArray(after) ? after : after.items;
  expect(
    afterItems.some((d) => d.id === id),
    'a finished document must leave the queue',
  ).toBe(false);
});

test('the detail read carries the header, the lines and the trail', async () => {
  const id = await authorDraft(s, REC, { amount: '350000' });
  await s.requester.api.post(`/documents/${id}/submit`);
  await approveToEnd(s, id);

  const detail = await s.requester.api.get<{
    document: {
      id: string;
      docNo: string;
      status: string;
      budgetBaseTotalAmount?: string;
    };
    lines: Array<{ lineNo: number; lineAmount: string; glAccount?: string }>;
    fieldValues: Array<{ fieldName: string; value?: string }>;
    attachments: unknown[];
  }>(`/documents/${id}/detail`);

  expect(detail.document.id).toBe(id);
  expect(detail.document.status).toBe('COMPLETED');
  expect(M.eq(detail.document.budgetBaseTotalAmount ?? '0', '350000')).toBe(
    true,
  );

  expect(detail.lines.length).toBe(1);
  expect(M.eq(detail.lines[0].lineAmount, '350000')).toBe(true);
  // The line carries no GL, because the sandbox budget names none — which is the customer's own
  // configuration: a budget whose spending posts to several accounts would name one of them
  // falsely, so their 2026 plan names an account on none of its lines. The GL a line DOES carry
  // is derived from its budget rather than typed by the requester; the next test asserts that.
  expect(detail.lines[0].glAccount ?? null).toBeNull();

  // The template's own fields come back filled, and the required evidence is listed with them.
  expect(detail.fieldValues.map((f) => f.fieldName)).toEqual(
    expect.arrayContaining(['Reson', 'date']),
  );
  expect(detail.attachments.length).toBeGreaterThan(0);
});

test('a line inherits the GL account of the budget it charges, not one the requester typed', async () => {
  // A budget that DOES name an account, so the derivation is visible.
  const accounts = await s.admin.get<{
    items: Array<{ code: string; isPostable: boolean }>;
  }>('/accounts?limit=100');
  const postable = accounts.items.find((a) => a.isPostable);
  test.skip(
    !postable,
    'this company has no postable account to hang a budget from',
  );

  const budgetId = await createActiveBudget(
    s,
    '4000000',
    'glacct',
    postable!.code,
  );
  const id = await authorDraft(s, REC, { amount: '400000', budgetId });
  const detail = await s.requester.api.get<{
    lines: Array<{ glAccount?: string }>;
  }>(`/documents/${id}/detail`);
  expect(
    detail.lines[0].glAccount,
    'the line did not inherit its budget’s GL account',
  ).toBe(postable!.code);
  await s.requester.api.post(`/documents/${id}/cancel`, {});
});

test('the printable copy renders for a finished document', async () => {
  const id = await authorDraft(s, REC, { amount: '350000' });
  await s.requester.api.post(`/documents/${id}/submit`);
  await approveToEnd(s, id);

  const res = await fetch(`${API_BASE}${API_PREFIX}/documents/${id}/pdf`, {
    headers: { Authorization: `Bearer ${s.requester.api.token}` },
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  expect(res.status, bytes.subarray(0, 300).toString('utf8')).toBe(200);
  expect(bytes.length).toBeGreaterThan(500);
  expect(bytes.subarray(0, 4).toString('latin1'), 'not a PDF').toBe('%PDF');
});

test('an attachment can be listed and handed back as a download link', async () => {
  const id = await authorDraft(s, REC, { amount: '350000' });

  const listed = await s.requester.api.get<
    Array<{ id: string; fileName?: string; filePath?: string }>
  >(`/documents/${id}/attachments`);
  expect(
    listed.length,
    'the required evidence file was not stored',
  ).toBeGreaterThan(0);

  const link = await s.requester.api.get<{ url: string }>(
    `/documents/${id}/attachments/${listed[0].id}/download-url`,
  );
  expect(link.url).toMatch(/^https?:\/\//);

  const fetched = await fetch(link.url);
  expect(
    fetched.status,
    'the presigned link does not resolve to the stored object',
  ).toBe(200);

  await s.requester.api.post(`/documents/${id}/cancel`, {});
});

test('the document list filters by type, status and number', async () => {
  const id = await authorDraft(s, REC, { amount: '350000' });
  const doc = await getDoc(s.requester.api, id);

  const byNo = await s.requester.api.get<{
    items: Array<{ id: string }>;
    total: number;
  }>(`/documents?docNo=${encodeURIComponent(doc.docNo)}&limit=100`);
  expect(byNo.items.map((d) => d.id)).toContain(id);

  const byType = await s.requester.api.get<{ items: Array<{ id: string }> }>(
    `/documents?documentTypeId=${REC.id}&status=DRAFT&limit=100`,
  );
  expect(byType.items.map((d) => d.id)).toContain(id);

  const wrongStatus = await s.requester.api.get<{
    items: Array<{ id: string }>;
  }>(`/documents?documentTypeId=${REC.id}&status=COMPLETED&limit=100`);
  expect(wrongStatus.items.map((d) => d.id)).not.toContain(id);

  await s.requester.api.post(`/documents/${id}/cancel`, {});
});
