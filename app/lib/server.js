import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr";

export function createClient(request) {
  const headers = new Headers();

  const supabase = createServerClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_PUBLISHABLE_OR_ANON_KEY,
    {
      cookies: {
        getAll() {
          const raw = request.headers.get("Cookie") || "";
          return parseCookieHeader(raw);
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            headers.append(
              "Set-Cookie",
              serializeCookieHeader(name, value, options)
            );
          });
        },
      },
    }
  );

  return { supabase, headers };
}
