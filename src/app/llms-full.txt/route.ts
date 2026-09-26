import { connection } from "next/server";

import { buildLlmsFullText } from "@/lib/llms-text";
import { getLlmsInput, llmsTextResponse } from "@/server/llms";

export async function GET() {
  await connection();
  return llmsTextResponse(buildLlmsFullText(await getLlmsInput({ full: true })));
}
