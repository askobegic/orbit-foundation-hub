import { useState, type ComponentType, type CSSProperties } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Briefcase,
  Facebook,
  Globe,
  Instagram,
  Linkedin,
  Lock,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  Music2,
  Phone,
  PhoneCall,
  Share2,
  Star,
  Twitter,
  UserPlus,
  Youtube,
} from "lucide-react";

import { useApplication } from "@/context/ApplicationContext";
import { supabase } from "@/integrations/supabase/client";
import { getApplicationCapabilities } from "@/lib/capabilities.functions";
import { getOrCreateConversation } from "@/lib/conversation.functions";
import { getVisibleApplications } from "@/lib/premium";
import type { PublicProfileBundle } from "@/lib/profile.functions";
import { isSafeProfileUrl } from "@/lib/url";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ApplicationRow } from "@/types/database";

// Shared CORE component -- rendered identically by every application
// (BosniaFans, Muzika.ba, Svadba.ba, Gradovi.ba, Bosanci.info, and every
// future application). Nothing in here may be application-specific: the
// current application's own cover/logo/colors come entirely from the
// Application Resolver (useApplication()) -- never hardcoded -- and Premium
// status/eligibility come exclusively from the CORE Premium Service
// (src/lib/premium.ts). Business logic (Premium/contact rules, messaging
// foundation) is unchanged from Priority 6 -- Priority 6.1 only changed
// layout (centered design) plus dynamic branding.
//
// Global Premium Visibility & Contact System: Premium is ecosystem-wide --
// there is no per-application Premium membership (see src/lib/premium.ts).
// Standard users expose only photo/name/city/country -- no @username, no
// tier pill. `user_app_settings.is_visible` is NOT a Premium/Standard
// downgrade -- it means "does this user have a public profile on this
// application at all," and is enforced one level up, by the route
// (src/routes/u.$username.tsx), which renders its existing not-found state
// when the owner is hidden on the application currently being browsed. A
// Premium owner who passes that gate always renders the full Premium Card
// here, with bio/professions unchanged from Priority 6 (out of scope for
// this task -- see PROJECT_KNOWLEDGE.md).
//
// Contact Actions (Call/WhatsApp/Viber/Email/Website/social links/Send
// Message): the entire block is hidden when the owner has turned off
// `is_contactable` for the application currently being browsed. Otherwise,
// every item is visible to any visitor (a Standard visitor can see that a
// channel exists), but the label only reveals the real value when the
// viewer qualifies (`canContact`: viewer has global Premium AND owner has
// global Premium AND is_contactable here) -- otherwise it shows a locked,
// generic placeholder with no value hint, and a click always opens the
// upgrade dialog instead of the destination.
// See PROJECT_KNOWLEDGE.md -> Profile Card & Messaging System.
export interface ProfileCardProps {
  // Server-resolved bundle (src/lib/profile.functions.ts) -- tier,
  // Contact Actions eligibility, and every protected contact value are all
  // decided server-side; a Standard visitor's bundle never carries a real
  // WhatsApp/phone/email/website value at all (CORE Universal Premium-
  // Locked Content, PROJECT_KNOWLEDGE.md -> Premium-Locked Content).
  bundle: PublicProfileBundle;
  /** The currently authenticated visitor, or null if not logged in. */
  viewerId: string | null;
  className?: string;
}

export function ProfileCard({ bundle, viewerId, className }: ProfileCardProps) {
  const { t } = useTranslation();
  const { application } = useApplication();
  const navigate = useNavigate();
  const getOrCreateConversationFn = useServerFn(getOrCreateConversation);
  const [gateModalOpen, setGateModalOpen] = useState(false);

  const {
    profile,
    primaryProfession,
    secondaryProfessions,
    whatsapp,
    phone,
    contactEmail,
    website,
    socials,
  } = bundle;

  // "Which card renders" -- Premium iff the owner holds active Premium on at
  // least one application anywhere on the platform, resolved server-side.
  const showPremiumContent = bundle.tier === "premium";
  const isOwnerContactableHere = bundle.isOwnerContactableHere;
  // Both sides' Premium status and the owner's is_contactable setting were
  // already checked server-side; this is the one flag the UI needs.
  const canContact = bundle.canContact;

  // "Public profile on" section content -- independent call, per
  // getVisibleApplications(userId). Not protected content (a Premium user's
  // own choice of where they're publicly listed), so this stays a plain
  // client-side fetch, unchanged.
  const visibleAppsQuery = useQuery({
    queryKey: ["visibleApplications", profile.id],
    queryFn: () => getVisibleApplications(profile.id),
    enabled: showPremiumContent,
  });
  const visibleApps = visibleAppsQuery.data ?? [];

  // Owner's per-application visibility, for the "Public profile on" tiles
  // only (which of those applications to link to vs. fall back to the
  // application's homepage) -- not used for contactability here anymore,
  // that comes from the server-resolved bundle above.
  const appSettingsQuery = useQuery({
    queryKey: ["userAppSettings", profile.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_app_settings")
        .select("app_id, is_visible")
        .eq("user_id", profile.id);
      if (error) {
        console.error("ProfileCard: user_app_settings fetch failed", error);
        return [];
      }
      return (data ?? []) as { app_id: string; is_visible: boolean }[];
    },
    enabled: showPremiumContent,
  });
  const appSettingsById = new Map((appSettingsQuery.data ?? []).map((s) => [s.app_id, s]));

  // R-2: the Send Message action is a UI-action-level capability gate,
  // matching the same "hide the app-scoped action, not the whole card"
  // treatment as Advertising/Rewards -- unlike the always-shown Call/
  // WhatsApp/etc. actions above, it disappears entirely (not just locked)
  // when the current application has messaging disabled, since there is
  // nothing to upgrade into in that case.
  const capabilitiesQuery = useQuery({
    queryKey: ["applicationCapabilities", application?.id],
    queryFn: () => getApplicationCapabilities({ data: { appId: application!.id } }),
    enabled: !!application?.id,
  });
  const messagingEnabled = !application || (capabilitiesQuery.data?.includes("messaging") ?? true);

  function handleGatedContact(action: () => void) {
    if (!canContact) {
      setGateModalOpen(true);
      return;
    }
    action();
  }

  function handleWhatsApp() {
    if (!whatsapp.value) return;
    window.open(`https://wa.me/${whatsapp.value.replace(/\D/g, "")}`, "_blank", "noreferrer");
  }

  function handleViber() {
    if (!phone.value) return;
    window.open(
      `viber://chat?number=${encodeURIComponent(phone.value.replace(/\D/g, ""))}`,
      "_blank",
      "noreferrer",
    );
  }

  function handleCall() {
    if (!phone.value) return;
    window.location.href = `tel:${phone.value.replace(/\D/g, "")}`;
  }

  function handleEmail() {
    if (!contactEmail.value) return;
    window.location.href = `mailto:${contactEmail.value}`;
  }

  function handleWebsite() {
    if (!website.value || !isSafeProfileUrl(website.value)) return;
    window.open(website.value, "_blank", "noreferrer");
  }

  function handleSocial(url: string | null) {
    if (!url || !isSafeProfileUrl(url)) return;
    window.open(url, "_blank", "noreferrer");
  }

  async function handleSendMessage() {
    // Viewing your own profile: `canContact` can otherwise evaluate true
    // (owner and viewer are the same Premium user), which would render a
    // seemingly-functional button that only ever fails server-side
    // ("Cannot start a conversation with yourself"). Guard it here instead.
    if (!viewerId || !application || viewerId === profile.id) return;
    try {
      const conversation = await getOrCreateConversationFn({
        data: { recipientUserId: profile.id, currentAppId: application.id },
      });
      void navigate({
        to: "/dashboard/messages/$conversationId",
        params: { conversationId: conversation.id },
      });
    } catch {
      toast.error(t("common.errorGeneric"));
    }
  }

  async function handleShareProfile() {
    const url =
      typeof window !== "undefined" ? `${window.location.origin}/u/${profile.username}` : "";
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: application?.name ?? "", url });
        return;
      } catch {
        return; // cancelled
      }
    }
    await navigator.clipboard.writeText(url);
    toast.success(t("share.linkCopied"));
  }

  async function handleInviteFriend() {
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}?ref=${encodeURIComponent(profile.username ?? "")}`
        : "";
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: application?.name ?? "", url });
        return;
      } catch {
        return; // cancelled
      }
    }
    await navigator.clipboard.writeText(url);
    toast.success(t("share.linkCopied"));
  }

  const fullName = `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim();
  const primaryColor = application?.primary_color ?? "#1D6BF3";
  const secondaryColor = application?.secondary_color ?? "#8B5CF6";

  return (
    <TooltipProvider>
      <div
        className={cn(
          "mx-auto w-full max-w-[420px] overflow-hidden rounded-2xl bg-white",
          className,
        )}
        style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }}
      >
        <div
          className="relative h-28 bg-cover bg-center"
          style={
            application?.cover_image_url
              ? { backgroundImage: `url(${application.cover_image_url})` }
              : {
                  background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
                }
          }
        >
          {application?.logo_url && (
            <div className="absolute left-3 top-3 flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-white/90 shadow">
              <img
                src={application.logo_url}
                alt={application.name}
                className="h-full w-full object-contain p-1"
              />
            </div>
          )}
        </div>

        <div className="relative flex flex-col items-center px-6 pb-6 text-center">
          <div className="relative -mt-11 h-[88px] w-[88px] shrink-0">
            <div className="h-full w-full overflow-hidden rounded-full border-4 border-white bg-gray-100 shadow">
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={fullName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-gray-400">
                  ?
                </div>
              )}
            </div>
            {showPremiumContent && (
              <span className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-amber-400 text-white">
                <Star className="h-3 w-3 fill-current" />
              </span>
            )}
          </div>

          <div className="mt-3">
            <h1 className="text-xl font-semibold text-gray-900">
              {fullName || `@${profile.username}`}
            </h1>
            {showPremiumContent && (
              <p className="mt-0.5 text-xs text-gray-500">@{profile.username}</p>
            )}
            <p className="mt-2 flex items-center justify-center gap-1 text-xs text-gray-500">
              <MapPin className="h-3 w-3" />
              {profile.city ?? ""}
              {profile.city && profile.country ? ", " : ""}
              {profile.country ?? ""}
            </p>
            {showPremiumContent && (
              <Badge className="mt-3 border-transparent bg-gradient-to-r from-amber-400 to-amber-500 text-white hover:from-amber-400 hover:to-amber-500">
                {t("profile.premiumMember")}
              </Badge>
            )}
          </div>

          {showPremiumContent && (
            <>
              {primaryProfession && (
                <div className="mt-4 flex flex-col items-center gap-1">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                    <Briefcase className="h-3.5 w-3.5" style={{ color: primaryColor }} />
                    {t("profile.primaryProfession")}
                  </div>
                  <p className="text-sm font-medium text-gray-900">{primaryProfession}</p>
                </div>
              )}
              {secondaryProfessions.length > 0 && (
                <div className="mt-3 flex flex-col items-center gap-1">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                    <Star className="h-3.5 w-3.5" style={{ color: secondaryColor }} />
                    {t("profile.secondaryProfessions")}
                  </div>
                  <p className="text-sm font-medium text-gray-900">
                    {secondaryProfessions.join(", ")}
                  </p>
                </div>
              )}

              {visibleApps.length > 0 && (
                <div className="mt-5 w-full">
                  <h2 className="mb-2 text-center text-xs font-semibold uppercase text-gray-500">
                    {t("profile.publicOn")}
                  </h2>
                  <div className="flex flex-wrap justify-center gap-2">
                    {visibleApps.map((a: ApplicationRow) => {
                      // Open the owner's profile on that application only if
                      // they haven't hidden themselves there; otherwise fall
                      // back to the application's own homepage.
                      const targetVisible = appSettingsById.get(a.id)?.is_visible ?? true;
                      const href = a.domain
                        ? targetVisible
                          ? `https://${a.domain}/u/${profile.username}`
                          : `https://${a.domain}`
                        : undefined;
                      const tile = (
                        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/40 px-2 py-1.5 transition-colors hover:bg-amber-100/60">
                          {a.logo_url ? (
                            <img
                              src={a.logo_url}
                              alt={a.name}
                              width={24}
                              height={24}
                              className="h-6 w-6 shrink-0 rounded-lg object-cover"
                            />
                          ) : (
                            <div
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[10px] font-semibold text-white"
                              style={{ background: a.primary_color }}
                            >
                              {a.name.slice(0, 1)}
                            </div>
                          )}
                          <span className="text-xs font-medium text-gray-700">{a.name}</span>
                        </div>
                      );
                      return (
                        <Tooltip key={a.id}>
                          <TooltipTrigger asChild>
                            {href ? (
                              <a href={href} target="_blank" rel="noreferrer">
                                {tile}
                              </a>
                            ) : (
                              tile
                            )}
                          </TooltipTrigger>
                          <TooltipContent>{a.name}</TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
              )}

              {isOwnerContactableHere && (
                <div className="mt-5 flex w-full flex-col gap-2">
                  {whatsapp.exists && (
                    <ContactActionButton
                      icon={MessageCircle}
                      value={whatsapp.value}
                      locked={whatsapp.locked}
                      platformLabel={t("profile.whatsapp")}
                      onClick={() => handleGatedContact(handleWhatsApp)}
                      className="bg-green-500 text-white hover:bg-green-600"
                    />
                  )}
                  {phone.exists && (
                    <ContactActionButton
                      icon={Phone}
                      value={phone.value}
                      locked={phone.locked}
                      platformLabel={t("profile.viber")}
                      onClick={() => handleGatedContact(handleViber)}
                      className="bg-purple-600 text-white hover:bg-purple-700"
                    />
                  )}
                  {phone.exists && (
                    <ContactActionButton
                      icon={PhoneCall}
                      value={phone.value}
                      locked={phone.locked}
                      platformLabel={t("profile.call")}
                      onClick={() => handleGatedContact(handleCall)}
                      className="bg-blue-600 text-white hover:bg-blue-700"
                    />
                  )}
                  {contactEmail.exists && (
                    <ContactActionButton
                      icon={Mail}
                      value={contactEmail.value}
                      locked={contactEmail.locked}
                      platformLabel={t("profile.contactEmail")}
                      onClick={() => handleGatedContact(handleEmail)}
                      className="bg-gray-700 text-white hover:bg-gray-800"
                    />
                  )}
                  {website.exists && (
                    <ContactActionButton
                      icon={Globe}
                      value={website.value}
                      locked={website.locked}
                      platformLabel={t("profile.website")}
                      onClick={() => handleGatedContact(handleWebsite)}
                      className="text-white hover:opacity-90"
                      style={{ backgroundColor: primaryColor }}
                    />
                  )}
                  {SOCIAL_LINKS.map(({ key, label, icon }) => {
                    const field = socials[key];
                    if (!field.exists) return null;
                    return (
                      <ContactActionButton
                        key={key}
                        icon={icon}
                        value={field.value}
                        locked={field.locked}
                        platformLabel={label}
                        onClick={() => handleGatedContact(() => handleSocial(field.value))}
                        className="bg-gray-100 text-gray-800 hover:bg-gray-200"
                      />
                    );
                  })}
                  {messagingEnabled && (
                    <ContactActionButton
                      icon={MessageSquare}
                      value={null}
                      locked={!canContact}
                      platformLabel={t("profile.sendMessage")}
                      onClick={() => handleGatedContact(handleSendMessage)}
                      className="text-white hover:opacity-90"
                      style={{ backgroundColor: primaryColor }}
                    />
                  )}
                </div>
              )}
            </>
          )}

          <div className="mt-5 flex w-full flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleShareProfile()}
              className="w-full"
            >
              <Share2 className="h-4 w-4" />
              {t("share.shareProfile")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleInviteFriend()}
              className="w-full"
            >
              <UserPlus className="h-4 w-4" />
              {t("share.inviteFriend")}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={gateModalOpen} onOpenChange={setGateModalOpen}>
        <DialogContent className="max-w-sm text-center sm:text-center">
          <DialogHeader className="items-center text-center sm:text-center">
            <DialogTitle>{t("profile.premiumOnlyTitle")}</DialogTitle>
            <DialogDescription>{t("profile.premiumOnlyFeature")}</DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">{t("profile.premiumOnlyBoth")}</p>
          <DialogFooter className="sm:justify-center">
            <Button variant="outline" onClick={() => setGateModalOpen(false)}>
              {t("common.close")}
            </Button>
            <Button asChild>
              <Link
                to="/pricing"
                search={{ app: application?.slug }}
                onClick={() => setGateModalOpen(false)}
              >
                {t("dashboard.upgrade")}
              </Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

// Social link fields shown as Contact Actions, in the same order/labels
// SocialLinksSection.tsx (the edit form) already uses -- no privacy toggle
// exists for these today, matching current editing UX: shown whenever set.
// Keys match profile.functions.ts's SOCIAL_FIELDS labels exactly -- that
// file is the single place deciding which social columns are exposed.
const SOCIAL_LINKS: {
  key: "facebook" | "instagram" | "tiktok" | "youtube" | "linkedin" | "x";
  label: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { key: "facebook", label: "Facebook", icon: Facebook },
  { key: "instagram", label: "Instagram", icon: Instagram },
  { key: "tiktok", label: "TikTok", icon: Music2 },
  { key: "youtube", label: "YouTube", icon: Youtube },
  { key: "linkedin", label: "LinkedIn", icon: Linkedin },
  { key: "x", label: "X (Twitter)", icon: Twitter },
];

// CORE's generic, reusable Premium-locked action button (Universal
// Premium-Locked Content) -- a Contact Action is always rendered once its
// underlying field `exists` (so a Standard visitor can see the channel
// exists -- "browse the complete Premium profile"), but `value` is only
// ever non-null when the caller already resolved eligibility server-side
// and `locked` is false; this component never decides eligibility itself,
// it only renders whichever state it's given. When locked, no value is
// present in props at all -- there is nothing here for client-side
// manipulation to reveal. Clicking always goes through the caller's
// `onClick` (handleGatedContact), which decides whether to perform the
// action or open the upgrade dialog.
function ContactActionButton({
  icon: Icon,
  value,
  locked,
  platformLabel,
  onClick,
  className,
  style,
}: {
  icon: ComponentType<{ className?: string }>;
  value: string | null;
  locked: boolean;
  platformLabel: string;
  onClick: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const DisplayIcon = locked ? Lock : Icon;
  return (
    <Button
      type="button"
      onClick={onClick}
      className={cn("w-full justify-start gap-2", className)}
      style={style}
    >
      <DisplayIcon className="h-4 w-4 shrink-0" />
      <span className="truncate">{!locked && value ? value : platformLabel}</span>
    </Button>
  );
}
