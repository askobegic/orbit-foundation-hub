// CORE Rewards / Points Purchase -- webhook-side fulfillment. Mirrors
// advertising.server.ts's activateCampaignFromPurchase() shape exactly:
// this function only validates the package and resolves the server-
// authoritative points/price; it does not itself insert the `payments`
// row or grant the ledger entry -- both webhooks (Stripe/PayPal) do that
// immediately after, the same split the campaign purchase flow already
// uses. Never trusts a client-supplied points amount -- the granted amount
// is always points_amount + bonus_points read fresh from points_packages.
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function resolvePointsPackagePurchase(params: {
  packageId: string;
  paidAmount: number;
  paidCurrency: string;
}): Promise<
  { ok: true; pointsToGrant: number; sourceAppId: string | null } | { ok: false; reason: string }
> {
  const supabaseAdmin = await admin();
  const { data: pkg } = await supabaseAdmin
    .from("points_packages")
    .select(
      "id, app_id, price, currency, points_amount, bonus_points, is_active, valid_from, valid_until",
    )
    .eq("id", params.packageId)
    .maybeSingle();
  if (!pkg || !pkg.is_active) return { ok: false, reason: "package_not_available" };

  const now = Date.now();
  if (pkg.valid_from && new Date(pkg.valid_from).getTime() > now) {
    return { ok: false, reason: "package_not_available" };
  }
  if (pkg.valid_until && new Date(pkg.valid_until).getTime() < now) {
    return { ok: false, reason: "package_not_available" };
  }

  const amountMatches = Math.abs(params.paidAmount - Number(pkg.price)) < 0.01;
  const currencyMatches =
    params.paidCurrency.toUpperCase() === (pkg.currency ?? "EUR").toUpperCase();
  if (!amountMatches || !currencyMatches) {
    return { ok: false, reason: "amount_mismatch" };
  }

  return {
    ok: true,
    pointsToGrant: pkg.points_amount + pkg.bonus_points,
    sourceAppId: pkg.app_id,
  };
}
