export const ADMIN_TOKEN = "admin-token-for-tests-0123456789abcdef";

export function postJson(body: unknown, token?: string): RequestInit {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return { method: "POST", headers, body: JSON.stringify(body) };
}

export const bearer = (token: string): RequestInit => ({
  headers: { authorization: `Bearer ${token}` },
});
