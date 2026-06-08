# HandClip billing con Polar

## Decision actual

- `free`: 3 exports por mes.
- `pro`: exports ilimitados.
- `admin`: exports ilimitados por `profiles.is_admin = true`; no depende de pago.

`pro` es nombre interno simple. Se puede cambiar luego sin tocar cuotas si el backend sigue leyendo entitlement.

## Polar setup

1. Crear producto recurrente en Polar.
2. Copiar Product ID y ponerlo en `POLAR_PRODUCT_ID`.
3. Crear Organization Access Token con scope `checkouts:write` y ponerlo en `POLAR_ACCESS_TOKEN`.
4. Crear webhook hacia:

```text
https://TU_API_PUBLICA/api/billing/webhook
```

5. Activar eventos:

```text
subscription.created
subscription.active
subscription.updated
subscription.uncanceled
subscription.canceled
subscription.past_due
subscription.revoked
```

6. Copiar webhook secret y ponerlo en `POLAR_WEBHOOK_SECRET`.

Para desarrollo local, usar sandbox:

```text
POLAR_API_URL=https://sandbox-api.polar.sh/v1
```

## Admin sin limite

Ejecutar en Supabase SQL Editor:

```sql
update public.profiles p
set is_admin = true, updated_at = now()
from auth.users u
where p.id = u.id
  and u.email = 'TU_EMAIL_ADMIN';
```

## Alternativas

- Polar: mejor encaje ahora. Checkout y webhooks simples, buen fit SaaS pequeño.
- Stripe Billing: más completo, más pesado. Mejor si necesitas impuestos, revenue ops, usage billing avanzado.
- Lemon Squeezy: merchant of record simple, útil si quieres delegar impuestos. Menos control.
- Paddle: merchant of record fuerte, buena opción global. Onboarding/compliance puede ser más lento.
