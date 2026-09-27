import { listAccounts } from "@/lib/accounts/service";
import { verifySession } from "@/lib/auth/dal";
import { AccountsListClient } from "./AccountsListClient";
import type { Account } from "@/lib/accounts/types";

export const metadata = {
  title: "Λογαριασμοί",
};

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const session = await verifySession();
  const accounts = await listAccounts(session.userId);
  return <AccountsListClient initialAccounts={accounts} />;
}