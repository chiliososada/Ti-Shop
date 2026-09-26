import { connection } from "next/server";

import { buildLlmsText } from "@/lib/llms-text";
import { getLlmsInput, llmsTextResponse } from "@/server/llms";

export async function GET() {
  await connection();
  return llmsTextResponse(buildLlmsText(await getLlmsInput({ full: false })));
}
