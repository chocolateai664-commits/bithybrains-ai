import type { Db } from "@/lib/brains/db.server";

/**
 * Credit engine. Balances are only ever changed by locking database routines
 * running as the service role — the frontend can read, never write.
 */

export interface CreditBalance {
  freeCredits: number;
  paidCredits: number;
  totalUsed: number;
}

type AdminDb = Db;

export async function ensureCredits(admin: AdminDb, userId: string): Promise<CreditBalance> {
  const { data, error } = await admin.rpc("ensure_user_credits", { _user_id: userId });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as
    | { free_credits: number; paid_credits: number; total_used: number }
    | null;
  return {
    freeCredits: row?.free_credits ?? 0,
    paidCredits: row?.paid_credits ?? 0,
    totalUsed: row?.total_used ?? 0,
  };
}

export async function hasCredit(admin: AdminDb, userId: string): Promise<boolean> {
  const balance = await ensureCredits(admin, userId);
  return balance.freeCredits + balance.paidCredits > 0;
}

/** Atomic, row-locked deduction. Returns null when the user has no credit. */
export async function consumeCredit(admin: AdminDb, userId: string): Promise<CreditBalance | null> {
  const { data, error } = await admin.rpc("consume_tracking_credit", { _user_id: userId });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as
    | { consumed: boolean; free_credits: number; paid_credits: number; total_used: number }
    | null;
  if (!row || !row.consumed) return null;
  return { freeCredits: row.free_credits, paidCredits: row.paid_credits, totalUsed: row.total_used };
}
