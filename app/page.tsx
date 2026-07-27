import { redirect } from "next/navigation";

export default function RootPage() {
  // O proxy manda usuário sem sessão para /login; com sessão, cai no app.
  redirect("/orders");
}
