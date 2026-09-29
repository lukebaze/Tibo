# PayFS Payment Matching

How to accept VietQR/bank-transfer payments with PayFS as the confirmation feed.
PayFS documents **no** API to create payments, QR codes, payment links, orders or
refunds (checked 2026-09-26). Your app owns the order, the QR and the matching logic;
PayFS only tells you money arrived.

## Flow

1. Create the order server-side: amount (integer VND), status `pending`, unique
   payment code (e.g. `DH` + 8 random uppercase alphanumerics), expiry
2. Show transfer details: bank, account number (or per-order Virtual Account),
   holder name, exact amount, and the payment code as the transfer memo
3. Render a VietQR image encoding the same data (see below)
4. PayFS POSTs `transaction.credit` → verify (`webhooks.md`) → dedupe on `transaction_id`
5. Match, then mark the order `paid` exactly once; fulfil in a worker
6. Frontend polls **your** order status endpoint; a redirect or "I have paid" button
   is never proof of payment

## Matching Rules

| Check | Rule |
|-------|------|
| Direction | `transfer_type === 'credit'` only |
| Account | `bank_account_number` (and `bank`) equals the account or VA you displayed |
| Reference | Payment code found in `content` (case-insensitive, ignore spaces/punctuation), or the VA itself identifies the order |
| Amount | `amount >= order.amount`; record over/under-payments for manual review |
| State | Order is still `pending` and not expired; otherwise flag, do not fulfil twice |

Bank memos get rewritten: banks prepend sender names, add trace codes, strip
diacritics and punctuation (the docs' sample memo is
`NGUYEN VAN A chuyen tien  Ma giao dich  Trace773231`). Keep payment codes short,
ASCII, alphanumeric and unambiguous, and search for them with a regex rather than
expecting an exact memo.

```javascript
function extractPaymentCode(content) {
  const m = String(content || '').toUpperCase().replace(/[^A-Z0-9]/g, ' ').match(/\bDH[A-Z0-9]{8}\b/);
  return m ? m[0] : null;
}

async function applyCredit(tx) {
  if (tx.transfer_type !== 'credit') return;
  const code = extractPaymentCode(tx.content);
  const order = code && await db.orders.findPendingByCode(code);
  if (!order || order.bankAccount !== tx.bank_account_number) {
    return db.unmatched.insert(tx); // reconcile manually
  }
  if (tx.amount < order.amount) return db.orders.flagUnderpaid(order.id, tx);
  await db.orders.markPaidOnce(order.id, { provider: 'payfs', paymentId: tx.transaction_id });
}
```

## Virtual Accounts

Open Banking connections can be created as "Main Bank Account with Virtual Account".
A VA gives each customer or order its own receiving number, so matching does not
depend on the memo. The docs do not document an API to create VAs or a VA field in
the webhook payload; set VAs up in the Client Portal and confirm how a VA credit
appears in the payload before relying on it.

Source: https://docs.payfs.vn/vi/bank-accounts/organization

## VietQR Image

PayFS publishes no QR endpoint. Generate a standard VietQR (NAPAS) code yourself:

- Use any VietQR image service or library that takes bank BIN/code, account number,
  amount and memo. The public generator described in `../sepay/qr-codes.md` builds
  such images from URL parameters; it is a third-party (SePay) service, so confirm its
  terms before using it for a non-SePay account, or encode the EMVCo payload locally.
- Put the payment code in the memo and the exact amount in the QR so customers do not
  type them.
- For OCB, check whether a VA is required for automatic matching (SePay requires one;
  PayFS does not say).

## Order Events

`order.success` / `order.failed` webhooks exist (`webhooks.md`), which implies a PayFS
order object, and payfs.vn advertises payment links and order creation. Neither has a
public API spec. Until PayFS publishes one, build on `transaction.credit` and your own
order table.

## Refunds

No refund API. Refund by a manual bank transfer from your account, record it against
the order, and expect a `transaction.debit` webhook (if subscribed) that you can use to
reconcile the refund. Fees on the debit are not documented.

## Reconciliation

- Store every verified transaction (raw body + `transaction_id`) even if unmatched
- Review unmatched credits daily; customers often mistype memos
- Export transactions from the Client Portal (or the API once documented) to
  cross-check totals against bank statements
- Remember the Free plan's 30 transactions/month; overage is billed per transaction

## Testing

- No sandbox: use a dedicated `*_staging` Workspace and a small real transfer
- Unit-test handlers with locally signed payloads:
  `node scripts/payfs-webhook-verify.js '<json>'` with `PAYFS_WEBHOOK_SECRET` set
- Test duplicate delivery, wrong API key, tampered body, expired timestamp,
  underpayment, unknown payment code, and `debit` events
