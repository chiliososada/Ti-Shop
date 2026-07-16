import {
  handleCreateOrderRequest,
  handleListOrdersRequest,
} from "@/server/orders/http";

export async function GET(request: Request) {
  return handleListOrdersRequest(request);
}

export async function POST(request: Request) {
  return handleCreateOrderRequest(request);
}

