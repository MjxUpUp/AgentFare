// Shared formatting helpers. Kept separate from api.ts so pages import only
// what they need without pulling the fetch client.

/** Format a USD amount: 2 decimals once it crosses $1, 4 below. Cost-log rows
 *  are typically fractions of a cent, where 2 decimals would render as $0.00
 *  and hide real differences between routed models. */
export function moneyUsd(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

/** Format a per-million-token price (model pricing table). Always 2 decimals. */
export function pricePerMillion(n: number): string {
  return `$${n.toFixed(2)}/M`;
}
