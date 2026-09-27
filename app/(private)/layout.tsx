import { redirect } from "next/navigation";
import { verifySession } from "@/lib/auth/dal";
import type { ReactNode } from "react";
import { PrivateShell } from "./_components/PrivateShell";

export const metadata = {
  title: "Χώρος",
};

export default async function PrivateLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const session = await verifySession();
  return (
    <PrivateShell email={session.email}>
      {children}
    </PrivateShell>
  );
}