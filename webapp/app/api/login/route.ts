import { COOKIE, accessToken } from "@/lib/access";

export async function POST(req: Request): Promise<Response> {
  const { code } = (await req.json()) as { code?: string };
  const expected = process.env.ACCESS_CODE;
  if (!expected || code !== expected) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return Response.json({ ok: false }, { status: 401 });
  }
  const res = Response.json({ ok: true });
  const maxAge = 60 * 60 * 24 * 30;
  res.headers.append(
    "set-cookie",
    `${COOKIE}=${await accessToken(code)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
  );
  return res;
}
