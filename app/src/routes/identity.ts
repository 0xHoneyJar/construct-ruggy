import { Hono } from 'hono';
import type { FinnClient } from '../proxy/finn-client.js';
import type { AgentIdentity } from '../types.js';
import { getRequestContext } from '../validation.js';

/** Agent identity constant — single source of truth for agent ID across routes. */
export const AGENT_ID = 'ruggy';

/**
 * ADR: Hono sub-app typing
 *
 * Route handlers read wallet and requestId from HTTP headers (x-wallet-address,
 * x-request-id) instead of Hono's typed context (c.get('wallet')).
 *
 * Reason: Hono's `app.route()` creates a sub-app boundary that resets typed
 * context. Variables set via `c.set()` in parent middleware are not type-safe
 * across this boundary. Using headers as the communication channel between
 * middleware and route handlers is explicit, testable, and framework-agnostic.
 *
 * If Hono adds typed context propagation across `app.route()` boundaries,
 * search for "ADR: Hono sub-app typing" to find all files that can be simplified.
 */

/**
 * Agent identity — subset of Hounfour AgentIdentity protocol type.
 *
 * Aligned: loa-hounfour/AgentIdentity
 * This shape is a projection of AgentIdentity fields relevant
 * to the agent dNFT. When loa-finn's identity graph returns full AgentIdentity
 * objects, this subset ensures backward-compatible API responses.
 */
interface AgentIdentityResponse {
  nftId: string;
  name: string;
  damp96_summary: Record<string, unknown> | null;
  beauvoir_hash: string | null;
}

/** Cached agent identity (stable data, 5 minute cache) */
let cachedIdentity: { data: AgentIdentityResponse; expiresAt: number } | null = null;
const IDENTITY_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Identity routes — agent dNFT identity via loa-finn identity graph.
 */
export function createIdentityRoutes(finnClient: FinnClient): Hono {
  const app = new Hono();

  /** GET /:agentId — Agent identity information */
  app.get(`/${AGENT_ID}`, async (c) => {
    const { requestId } = getRequestContext(c);

    // Check cache
    const now = Date.now();
    if (cachedIdentity && now < cachedIdentity.expiresAt) {
      return c.json(cachedIdentity.data);
    }

    try {
      const result = await finnClient.request<AgentIdentityResponse>(
        'GET',
        `/api/identity/${AGENT_ID}`,
        { headers: { 'X-Request-Id': requestId } },
      );

      cachedIdentity = { data: result, expiresAt: now + IDENTITY_CACHE_TTL_MS };
      return c.json(result);
    } catch {
      // Graceful degradation — return placeholder if identity graph not populated
      const fallback: AgentIdentityResponse = {
        nftId: AGENT_ID,
        name: 'Ruggy',
        damp96_summary: null,
        beauvoir_hash: null,
      };
      return c.json(fallback);
    }
  });

  return app;
}

/** Reset cache — useful for testing */
export function resetIdentityCache(): void {
  cachedIdentity = null;
}
