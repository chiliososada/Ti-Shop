import { getAuth } from "@/server/auth/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isCredentialSignIn(request: Request) {
  return (
    request.method === "POST" &&
    new URL(request.url).pathname === "/api/auth/sign-in/email"
  );
}

function genericCredentialFailure() {
  return Response.json(
    {
      code: "INVALID_EMAIL_OR_PASSWORD",
      message: "Invalid email or password",
    },
    {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

async function handler(request: Request) {
  const credentialSignIn = isCredentialSignIn(request);
  try {
    const response = await getAuth().handler(request);
    if (
      credentialSignIn &&
      !response.ok &&
      response.status !== 429
    ) {
      return genericCredentialFailure();
    }
    return response;
  } catch (error) {
    if (credentialSignIn) {
      console.error("Credential sign-in failed before a response was produced.", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
      return genericCredentialFailure();
    }
    throw error;
  }
}

export { handler as GET, handler as POST };
