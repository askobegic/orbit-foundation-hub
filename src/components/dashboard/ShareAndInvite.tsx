import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Check, Share2, UserPlus, X, Facebook, Mail } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { useApplication } from "@/context/ApplicationContext";
import { getShareInviteConfig } from "@/lib/share-invite.functions";

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.16 8.16 0 0 0 4.77 1.52V6.75a4.85 4.85 0 0 1-1-.06z" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
    </svg>
  );
}

interface ShareAndInviteProps {
  username: string | null;
  firstName: string | null;
  lastName: string | null;
}

// Share is application-focused (a fixed title/description/URL an admin
// configures once per application, not derived from whichever user
// happens to be sharing) -- Invite is personal (the inviting user's own
// public display name plus their existing `?ref=<username>` referral
// link, filled into an admin-authored template). Both are configurable
// per application; see share-invite.functions.ts and
// PROJECT_KNOWLEDGE.md -> Share Profile / Invite a Friend.
export function ShareAndInvite({ username, firstName, lastName }: ShareAndInviteProps) {
  const { t } = useTranslation();
  const { application } = useApplication();
  const [copied, setCopied] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);

  const getConfigFn = useServerFn(getShareInviteConfig);
  const configQuery = useQuery({
    queryKey: ["share-invite-config", application?.id],
    enabled: !!application?.id,
    queryFn: () => getConfigFn({ data: { appId: application!.id } }),
  });
  const config = configQuery.data;

  const shareTitle = config?.shareTitle ?? application?.name ?? t("share.defaultShareTitle");
  const shareDescription = config?.shareDescription ?? t("share.defaultShareDescription");
  const shareUrl =
    config?.shareUrl ??
    (application?.domain ? `https://${application.domain}` : window.location.origin);

  const displayName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const userName = displayName || (username ? `@${username}` : t("share.aFriend"));
  const inviteLink = `${window.location.origin}?ref=${username ?? "friend"}`;
  const inviteTemplate = config?.inviteTemplate ?? t("share.defaultInviteTemplate");
  const inviteText = inviteTemplate
    .replaceAll("{user_name}", userName)
    .replaceAll("{invite_link}", inviteLink);

  async function copyShareUrl() {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast.success(t("share.linkCopied"));
    setTimeout(() => setCopied(false), 2000);
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(inviteText);
    setInviteCopied(true);
    toast.success(t("share.linkCopied"));
    setTimeout(() => setInviteCopied(false), 2000);
  }

  async function nativeShare(title: string, text: string, url: string) {
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
      } catch {
        // cancelled
      }
    } else {
      await navigator.clipboard.writeText(url);
      toast.success(t("share.linkCopied"));
    }
  }

  const shareText = `${shareTitle} — ${shareDescription}`;

  const socialLinks = [
    {
      name: "Facebook",
      icon: <Facebook size={15} />,
      color: "#1877F2",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
    },
    {
      name: "Instagram",
      icon: <InstagramIcon />,
      color: "#E1306C",
      onClick: () => {
        navigator.clipboard.writeText(shareUrl);
        toast.success(t("share.instagramCopied"));
      },
    },
    {
      name: "TikTok",
      icon: <TikTokIcon />,
      color: "#000000",
      onClick: () => {
        navigator.clipboard.writeText(shareUrl);
        toast.success(t("share.tiktokCopied"));
      },
    },
    {
      name: "WhatsApp",
      icon: <WhatsAppIcon />,
      color: "#25D366",
      href: `https://wa.me/?text=${encodeURIComponent(shareText)}`,
    },
    {
      name: "Email",
      icon: <Mail size={15} />,
      color: "#6B7280",
      href: `mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(shareText)}`,
    },
  ];

  return (
    <>
      {/* Share To */}
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800">{t("share.shareApp")}</h3>
          <button
            onClick={() => nativeShare(shareTitle, shareDescription, shareUrl)}
            className="flex items-center gap-1.5 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1558D6]"
          >
            <Share2 size={12} />
            {t("share.share")}
          </button>
        </div>

        <p className="mb-3 text-xs text-gray-500">{shareDescription}</p>

        <div className="mb-4 flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
          <span className="flex-1 truncate text-xs text-gray-500">{shareUrl}</span>
          <button onClick={copyShareUrl} className="flex-shrink-0 text-gray-400 hover:text-[#1D6BF3]">
            {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {socialLinks.map((s) => (
            <a
              key={s.name}
              href={s.onClick ? undefined : s.href}
              target={s.onClick ? undefined : "_blank"}
              rel="noopener noreferrer"
              onClick={s.onClick ? (e) => { e.preventDefault(); s.onClick?.(); } : undefined}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-500 transition-all duration-200 hover:border-transparent hover:text-white"
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.backgroundColor = s.color;
                el.style.borderColor = s.color;
                el.style.color = "white";
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.backgroundColor = "";
                el.style.borderColor = "";
                el.style.color = "";
              }}
              title={s.name}
              aria-label={s.name}
            >
              {s.icon}
            </a>
          ))}
        </div>
      </section>

      {/* Invite Friend */}
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">{t("share.inviteFriend")}</h3>
            <p className="text-xs text-gray-400">{t("share.inviteSubtitle")}</p>
          </div>
          <button
            onClick={() => setInviteOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:border-[#1D6BF3] hover:text-[#1D6BF3]"
          >
            <UserPlus size={12} />
            {t("share.invite")}
          </button>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-dashed border-gray-200 px-3 py-2">
          <span className="flex-1 truncate text-xs text-gray-400">{inviteLink}</span>
          <button onClick={copyInvite} className="flex-shrink-0 text-gray-400 hover:text-[#1D6BF3]">
            {inviteCopied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
          </button>
        </div>
      </section>

      {/* Invite Modal */}
      {inviteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setInviteOpen(false); }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">{t("share.inviteFriend")}</h2>
              <button onClick={() => setInviteOpen(false)} className="rounded-full p-1 text-gray-400 hover:bg-gray-100">
                <X size={16} />
              </button>
            </div>

            <p className="mb-4 text-sm text-gray-500">{t("share.inviteDescription")}</p>

            <div className="mb-4 rounded-xl bg-gray-50 p-3">
              <p className="mb-1 text-xs text-gray-400">{t("share.yourInviteLink")}</p>
              <p className="break-all text-xs font-medium text-gray-700">{inviteText}</p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={copyInvite}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {inviteCopied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                {t("share.copyLink")}
              </button>
              <button
                onClick={() => nativeShare(t("share.inviteFriend"), inviteText, inviteLink)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#1D6BF3] py-2.5 text-sm font-medium text-white hover:bg-[#1558D6]"
              >
                <Share2 size={14} />
                {t("share.share")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
