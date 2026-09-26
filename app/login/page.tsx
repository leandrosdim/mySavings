import { loginAction } from "@/lib/auth/actions";
import { getOptionalSession } from "@/lib/auth/dal";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";

export const metadata = {
  title: "Sign in",
};

export default async function LoginPage() {
  const session = await getOptionalSession();
  if (session) {
    redirect("/dashboard");
  }
  return <LoginForm />;
}