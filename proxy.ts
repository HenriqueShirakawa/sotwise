import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Proxy (ex-middleware no Next ≤15). Runtime Node. Faz duas coisas:
 *  1. Renova a sessão do Supabase a cada request (refresh dos cookies).
 *  2. Redirect OTIMISTA por cookie (não é a fronteira de segurança — a DAL
 *     em cada page/action confirma sessão, profile e status `blocked`).
 */

// Páginas de auth acessíveis sem sessão.
const PUBLIC_PATHS = ["/login", "/forgot-password", "/update-password"];
// Onde um usuário logado NÃO deve ficar (manda pro app). update-password fica de
// fora: o fluxo de recovery cria uma sessão temporária e precisa dessa página.
const REDIRECT_WHEN_AUTHED = ["/login", "/forgot-password"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
  const isAuthRoute = pathname.startsWith("/auth/");
  // A API REST não redireciona: os route handlers respondem 401 JSON
  // (ver lib/api-auth.ts). O proxy só renova a sessão nesses paths.
  const isApi = pathname.startsWith("/api/");

  // Sem sessão em área protegida → login (guardando o destino).
  if (!user && !isPublic && !isAuthRoute && !isApi) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  // Logado abrindo login/forgot → app. Manda para "/" em vez de "/orders"
  // porque daqui só dá para ver o cookie, não o papel: quem decide entre app
  // interno e portal do cliente é o `app/page.tsx`, que enxerga a sessão.
  if (user && REDIRECT_WHEN_AUTHED.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Tudo, menos assets estáticos e imagens.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
