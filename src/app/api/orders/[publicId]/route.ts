import { handleGetOrderRequest } from "@/server/orders/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await context.params;
  return handleGetOrderRequest(request, publicId);
}

