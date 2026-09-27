import { notFound } from "next/navigation";
import {
  getAccount,
  getReconciliationState,
} from "@/lib/accounts/service";
import { listAccounts } from "@/lib/accounts/service";
import { verifySession } from "@/lib/auth/dal";
import { AccountDetailClient } from "./AccountDetailClient";
import type { Account } from "@/lib/accounts/types";

export const metadata = {
  title: "Λογαριασμός",
};

export const dynamic = "force-dynamic";

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await verifySession();

  let account: Account;
  let reconciliation: { needsReconciliation: boolean; pendingMovementCount: number };
  try {
    account = await getAccount(session.userId, id);
    reconciliation = await getReconciliationState(session.userId, id);
  } catch {
    notFound();
  }

  const allAccounts = await listAccounts(session.userId);
  const otherAccounts = allAccounts.filter((a) => a.id !== id && !a.archived);

  return (
    <AccountDetailClient
      initialAccount={account}
      initialReconciliation={reconciliation}
      otherAccounts={otherAccounts}
    />
  );
}