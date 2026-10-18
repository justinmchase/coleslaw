export function problemResponse(
  status: number,
  title: string,
  detail?: string,
  extensions: Readonly<Record<string, unknown>> = {},
  headers: HeadersInit = {},
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set(
    "content-type",
    "application/problem+json; charset=utf-8",
  );
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title,
      status,
      ...(detail === undefined ? {} : { detail }),
      ...extensions,
    }),
    {
      status,
      headers: responseHeaders,
    },
  );
}
