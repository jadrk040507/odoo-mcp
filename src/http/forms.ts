export function oauthError(error: string, status = 400): Response {
  return Response.json(
    { error },
    { status, headers: { "cache-control": "no-store" } },
  );
}
