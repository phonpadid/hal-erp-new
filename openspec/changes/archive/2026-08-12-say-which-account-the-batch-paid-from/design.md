# Design

## D1. The account belongs to the batch, and reaches the payment through it

A batch is one file sent to one bank. Which account it drew on is a fact about the run, decided when
it is built and unchanged afterwards — the same shape as its format and its pay date.

The payment gets it by being stamped at import, two lines from where `payment.batch` is already set.
Storing it only on the batch and joining at read time was the alternative; stamping is better here
because the reconciliation asks per payment, and a payment recorded singly has an account with no
batch to join to. One column answers both.

## D2. Optional, because a company can pay before it has configured its accounts

`bank_account_id` is nullable on the batch as it is on the payment. Requiring it would stop a
company paying at all until somebody had set up the chart-of-accounts mapping, which is a
configuration task with its own permission.

Batches without one behave exactly as they do today: their payments land in the unattributed read,
which exists precisely so that cash in flight nobody attributed is visible rather than lost.

## D3. No back-fill

Payments already recorded have no bank account, and their batch — if any — has none either. There
is nothing to derive from: a batch that predates the column cannot say which account it drew on, and
choosing the company's only bank account would be a guess written as a fact about money.

They stay in the unattributed read. Attributing one is a deliberate act by somebody who knows.
