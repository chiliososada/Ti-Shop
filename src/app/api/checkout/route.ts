import { handleCreateOrderRequest } from "@/server/orders/http";

/** Compatibility alias for storefront clients that still post to /api/checkout. */
export async function POST(request: Request) {
  return handleCreateOrderRequest(request);
}
