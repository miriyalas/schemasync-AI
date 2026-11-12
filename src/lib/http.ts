/**
 * fetch + JSON with readable errors. When a host (Vercel, a proxy, IIS) returns an HTML
 * error page instead of JSON, explain what probably happened instead of showing
 * "Unexpected token '<'".
 */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T }> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new Error(`Could not reach the app server (${(e as Error).message}). Check your network or VPN.`);
  }
  const text = await res.text();
  const type = res.headers.get("content-type") || "";
  if (type.includes("application/json") || /^\s*[{[]/.test(text)) {
    try {
      return { ok: res.ok, status: res.status, data: JSON.parse(text) as T };
    } catch {
      /* fall through to the friendly message */
    }
  }
  throw new Error(explainStatus(res.status, text));
}

export function explainStatus(status: number, body = ""): string {
  const vercelCode = /(FUNCTION_INVOCATION_TIMEOUT|FUNCTION_INVOCATION_FAILED|FUNCTION_PAYLOAD_TOO_LARGE|NOT_FOUND)/.exec(body)?.[1];
  if (status === 504 || vercelCode === "FUNCTION_INVOCATION_TIMEOUT")
    return "The server took too long and the host stopped it (timeout). Usually the app cannot reach the database server from where it is hosted (for example Vercel cannot reach a company-network database), or the schema is very large. Try Test connection first, select fewer object types, or host the app inside your network (docs/HOSTING.md).";
  if (status === 413 || vercelCode === "FUNCTION_PAYLOAD_TOO_LARGE")
    return "The result is too large for the host's response limit. Select fewer object types or compare one schema at a time, or self-host with Docker.";
  if (status === 401) return "Not signed in (401). Reload the page and enter the app username and password.";
  if (status === 404 || vercelCode === "NOT_FOUND")
    return "API not found (404). On Vercel, check that Root Directory points to the folder that contains package.json, then redeploy.";
  if (status >= 500 || vercelCode === "FUNCTION_INVOCATION_FAILED")
    return `The server hit an error (${status}). On Vercel open the project → Logs to see the details.`;
  return `Unexpected response from the server (${status}).`;
}
