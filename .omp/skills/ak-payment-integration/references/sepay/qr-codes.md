# SePay VietQR Generation

Dynamic VietQR (NAPAS standard) image URLs. Verified against developer.sepay.vn on 2026-09-26.

## Endpoint

```
https://vietqr.app/img?acc={ACCOUNT}&bank={BANK}&amount={AMOUNT}&des={DESCRIPTION}&template={TEMPLATE}
```

SePay's docs now use the `vietqr.app` host. The legacy `https://qr.sepay.vn/img` URL still returns the same PNG and `qr.sepay.vn/banks.json` is identical, so existing links keep working; prefer `vietqr.app` for new code. The generator UI remains at https://qr.sepay.vn.

## Parameters

| Param | Required | Notes |
|-------|----------|-------|
| `acc` | yes | Account number, or VA number depending on bank rules below |
| `bank` | yes | `short_name`, alias, `code` or `bin` from `banks.json` (e.g. `Vietcombank`, `VCB`, `970436`) |
| `amount` | no | Integer VND; omit to let the customer type it |
| `des` | no | Transfer memo (URL-encoded); some banks need fixed strings |
| `template` | no | empty (standard with VietQR logo), `compact` (NAPAS/VietQR + bank + SePay logos, for checkout pages), `qronly` (bare QR), `standee` (printable counter layout) |
| `download` | no | `true` forces a download |
| `showinfo` | no | `true` shows account info on the image (not needed for `standee`) |
| `fullacc` | no | `true` shows the full account number; only with `showinfo=true` |
| `holder` | no | Account holder name, no diacritics |
| `store` | no | Store/business name |

## Bank Rules

VA requirement for automatic matching:

| Bank | Personal | Household business | Enterprise |
|------|:-:|:-:|:-:|
| OCB, KienLongBank, MSB | Required | Required | Required |
| BIDV | Required | Required | Optional |
| Other banks | Optional | Optional | Optional |

| VA type | `acc` | `des` |
|---------|-------|-------|
| Official VA | VA number | Any content |
| Memo-based VA (TKP) | Source account number | `TKP` + VA code + content, e.g. `TKP001 DH001` |
| No VA | Account number | Any content |

- **VietinBank personal/household:** `des` must contain `SEVQR`, otherwise SePay never receives the transaction.
- **Payment code:** include your configured code prefix (Company → General settings → Payment code structure) so the webhook `code` field is populated.
- **Order VAs** (`api.md`) return a ready `qr_code_url` for the per-order VA.

## Examples

```
https://vietqr.app/img?acc=0010000000355&bank=Vietcombank&amount=100000&des=DH001%20thanh%20toan&template=compact
https://vietqr.app/img?acc=0123456789&bank=VietinBank&amount=100000&des=SEVQR%20DH001
https://vietqr.app/img?acc=0987654321&bank=TPBank&amount=200000&des=TKP001%20DH001
https://vietqr.app/img?acc=0010000000355&bank=Vietcombank              # customer enters amount
```

## Integration

### JavaScript / Node.js
```javascript
function generatePaymentQR({ account, bank, amount, description, template = 'compact' }) {
  const params = new URLSearchParams({ acc: account, bank, template });
  if (amount) params.set('amount', String(Math.floor(amount)));
  if (description) params.set('des', description);
  return `https://vietqr.app/img?${params}`;
}

const qrUrl = generatePaymentQR({
  account: process.env.SEPAY_ACCOUNT_NUMBER,
  bank: process.env.SEPAY_BANK_NAME,
  amount: order.total,
  description: `DH${order.id}`,
});
```

### PHP
```php
<?php
function generatePaymentQR(string $account, string $bank, int $amount, string $description): string {
    return 'https://vietqr.app/img?' . http_build_query([
        'acc' => $account,
        'bank' => $bank,
        'amount' => $amount,
        'des' => $description,
        'template' => 'compact',
    ]);
}
```

### React
```jsx
function PaymentQR({ account, bank, amount, description }) {
  const qrUrl = useMemo(() => `https://vietqr.app/img?${new URLSearchParams({
    acc: account, bank, amount: String(amount), des: description, template: 'compact',
  })}`, [account, bank, amount, description]);

  return (
    <figure className="payment-qr">
      <img src={qrUrl} alt="Payment QR code" width={300} />
      <figcaption>Scan to pay {amount.toLocaleString('vi-VN')} VND</figcaption>
    </figure>
  );
}
```

## Bank List

```
GET https://vietqr.app/banks.json
```

Returns `{ "no_banks": 54, "data": [{ "name", "code", "bin", "short_name", "supported" }] }` (54 banks, 23 `supported: true` as of 2026-09-26). Fetch once and cache (for example 24 h) instead of hardcoding.

## Best Practices

1. URL-encode `des` (`URLSearchParams`, `http_build_query`) and keep it short; banks may strip dashes or change case.
2. Put a unique order/payment code in `des` (or use an order VA) for automatic matching.
3. Use integer `amount`; omit it only for donation/flexible flows.
4. Always show the account, bank, amount and memo as text next to the QR for manual transfers.
5. Provide alt text, a loading placeholder and a print-friendly size.
6. Treat the QR as instructions only; confirm payment from webhooks.
