// Universal CORE Affiliate System -- the public referral link an Affiliate
// shares ("https://<app-domain>/r/{code}"). Records the click, captures a
// last-touch local marker (affiliate-tracking.ts) used later at checkout
// (registerCheckoutAttribution), and redirects to the offer's destination
// -- appending the code as a best-effort `?core_ref=` query param so a
// cooperating external application's own page can also capture it (spec
// section 16/9's cross-application reality: CORE cannot force a foreign
// domain to read a cookie it never set). No internal database id is ever
// exposed -- only the opaque `code`.
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";

import { resolveAffiliateClick } from "@/lib/affiliate.functions";
import { captureAffiliateCode } from "@/lib/affiliate-tracking";

export const Route = createFileRoute("/r/$code")({
  component: AffiliateRedirect,
});

function appendRefParam(url: string, code: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("core_ref", code);
    return u.toString();
  } catch {
    return url;
  }
}

function AffiliateRedirect() {
  const { t } = useTranslation();
  const { code } = Route.useParams();
  const resolveFn = useServerFn(resolveAffiliateClick);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await resolveFn({ data: { code } });
      if (cancelled) return;
      if (!result) {
        setNotFound(true);
        return;
      }
      captureAffiliateCode(code);
      window.location.replace(appendRefParam(result.destinationUrl, code));
    })();
    return () => {
      cancelled = true;
    };
  }, [code, resolveFn]);

  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-gray-900">{t("affiliate.linkNotFound")}</h1>
          <Link to="/" className="mt-3 inline-block text-sm text-[#1D6BF3] hover:underline">
            ← {t("nav.home")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1D6BF3] border-t-transparent" />
    </div>
  );
}
