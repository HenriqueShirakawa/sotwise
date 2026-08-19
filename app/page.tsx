import { redirect } from "next/navigation";

import { CLIENT_HOME, resolveSession } from "@/lib/dal";

export default async function RootPage() {
  // O proxy manda usuário sem sessão para /login; com sessão, cai no app — que
  // é um app diferente para quem é de fora. Resolver o papel AQUI evita o
  // pisca-pisca de mandar o cliente para /orders só para a DAL rebatê-lo.
  const result = await resolveSession();
  if (result.kind === "ok" && result.session.isClient) redirect(CLIENT_HOME);

  redirect("/orders");
}
