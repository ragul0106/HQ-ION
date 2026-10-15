import type { Config } from '../config.js';
import type { Scheme } from '../eligibility/types.js';
import type { CatalogRequest } from './build.js';

/** Sample data must never reach the live network. */
export function assertPublishable(
  config: Pick<Config, 'ION_ENV'>,
  schemes: readonly Scheme[],
): void {
  if (config.ION_ENV !== 'live') return;
  const samples = schemes.filter((s) => s.placeholder).map((s) => s.id);
  if (samples.length > 0) {
    throw new Error(
      `Refusing to publish placeholder schemes to the live network: ${samples.join(', ')}`,
    );
  }
}

export interface PublishOutcome {
  httpStatus: number;
  body: unknown;
}

export interface PublishOptions {
  config: Pick<Config, 'ADAPTER_PUBLISH_URL'>;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

/** Hand the catalog to our ONIX adapter, which signs it and writes the files a crawler reads. */
export async function publishCatalog(
  catalog: CatalogRequest,
  { config, fetchFn = fetch, timeoutMs = 60_000 }: PublishOptions,
): Promise<PublishOutcome> {
  const res = await fetchFn(config.ADAPTER_PUBLISH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(catalog),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep the raw text */
  }
  return { httpStatus: res.status, body };
}

interface PublishResponseBody {
  status?: string;
  results?: { catalogId?: string; status?: string; reason?: string }[];
  warnings?: string[];
}

/** A short human summary of the adapter's answer (it can say REJECTED for reasons that are fine locally). */
export function summarise(outcome: PublishOutcome): string[] {
  const body = (
    typeof outcome.body === 'object' && outcome.body !== null ? outcome.body : {}
  ) as PublishResponseBody;
  const lines = [
    `adapter answered HTTP ${outcome.httpStatus}, overall status: ${body.status ?? 'unknown'}`,
  ];
  for (const r of body.results ?? []) {
    lines.push(
      `  catalog ${r.catalogId ?? '?'}: ${r.status ?? '?'}${r.reason ? ` (${r.reason})` : ''}`,
    );
  }
  for (const w of body.warnings ?? []) lines.push(`  warning: ${w}`);
  return lines;
}
