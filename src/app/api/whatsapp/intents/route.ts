import { handleWhatsAppIntentRequest } from "@/server/whatsapp/http";

export async function POST(request: Request) {
  return handleWhatsAppIntentRequest(request);
}
