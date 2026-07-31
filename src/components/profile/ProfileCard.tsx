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
import { getOrCreateConversation } from "@/lib/conversation.functions";
import { getVisibleApplications, hasAnyActivePremium } from "@/lib/premium";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ApplicationRow, PremiumProfileRow, ProfileRow } from "@/types/database";

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
  profile: ProfileRow;
  premiumProfile: PremiumProfileRow | null;
  /** The currently authenticated visitor, or null if not logged in. */
  viewerId: string | null;
  className?: string;
}

export function ProfileCard({ profile, premiumProfile, viewerId, className }: ProfileCardProps) {
  const { t } = useTranslation();
  const { application } = useApplication();
  const navigate = useNavigate();
  const getOrCreateConversationFn = useServerFn(getOrCreateConversation);
  const [gateModalOpen, setGateModalOpen] = useState(false);

  // "Which card renders" -- Premium iff the owner holds active Premium on at
  // least one application anywhere on the platform. Not a stored flag: the
  // same CORE Premium Service check used everywhere else.
  const ownerPremiumQuery = useQuery({
    queryKey: ["premium", "hasAny", profile.id],
    queryFn: () => hasAnyActivePremium(profile.id),
  });
  const isOwnerPremium = ownerPremiumQuery.data ?? false;

  // "Public profile on" section content -- independent call, per
  // getVisibleApplications(userId).
  const visibleAppsQuery = useQuery({
    queryKey: ["visibleApplications", profile.id],
    queryFn: () => getVisibleApplications(profile.id),
    enabled: isOwnerPremium,
  });
  const visibleApps = visibleAppsQuery.data ?? [];

  // Owner's per-application visibility/contactability (Unified Profile
  // Onboarding & Premium Visibility Model). Only fetched when the owner is
  // Premium somewhere -- Standard users have nothing for this to gate.
  const appSettingsQuery = useQuery({
    queryKey: ["userAppSettings", profile.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_app_settings")
        .select("app_id, is_visible, is_contactable")
        .eq("user_id", profile.id);
      if (error) {
        console.error("ProfileCard: user_app_settings fetch failed", error);
        return [];
      }
      return (data ?? []) as { app_id: string; is_visible: boolean; is_contactable: boolean }[];
    },
    enabled: isOwnerPremium,
  });
  const appSettingsById = new Map((appSettingsQuery.data ?? []).map((s) => [s.app_id, s]));
  // No row yet (e.g. seeded true at onboarding, never toggled since) defaults
  // to contactable -- same fallback dashboard.settings.tsx uses. Whether the
  // owner has a profile on this application AT ALL (is_visible) is enforced
  // one level up by the route, not here -- see the file-level comment above.
  const currentAppSetting = application ? appSettingsById.get(application.id) : undefined;
  const isOwnerContactableHere = currentAppSetting?.is_contactable ?? true;

  // "Which card renders" is Premium status alone -- see the file-level
  // comment above for why is_visible does not affect this.
  const showPremiumContent = isOwnerPremium;

  // Cross-application contact privilege (Priority 6): both sides need
  // Premium on ANY application, not the same one -- plus the owner must not
  // have turned off contact for the application currently being browsed.
  const viewerPremiumQuery = useQuery({
    queryKey: ["premium", "hasAny", viewerId],
    queryFn: () => hasAnyActivePremium(viewerId!),
    enabled: !!viewerId,
  });
  const isViewerPremium = viewerPremiumQuery.data ?? false;
  const canContact = showPremiumContent && isViewerPremium && isOwnerContactableHere;

  function handleGatedContact(action: () => void) {
    if (!canContact) {
      setGateModalOpen(true);
      return;
    }
    action();
  }

  function handleWhatsApp() {
    if (!premiumProfile?.whatsapp) return;
    window.open(
      `https://wa.me/${premiumProfile.whatsapp.replace(/\D/g, "")}`,
      "_blank",
      "noreferrer",
    );
  }

  function handleViber() {
    if (!premiumProfile?.phone) return;
    window.open(
      `viber://chat?number=${encodeURIComponent(premiumProfile.phone.replace(/\D/g, ""))}`,
      "_blank",
      "noreferrer",
    );
  }

  function handleCall() {
    if (!premiumProfile?.phone) return;
    window.location.href = `tel:${premiumProfile.phone.replace(/\D/g, "")}`;
  }

  function handleEmail() {
    if (!premiumProfile?.contact_email) return;
    window.location.href = `mailto:${premiumProfile.contact_email}`;
  }

  function handleWebsite() {
    if (!premiumProfile?.website || !isSafeProfileUrl(premiumProfile.website)) return;
    window.open(premiumProfile.website, "_blank", "noreferrer");
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

  if (ownerPremiumQuery.isLoading || (isOwnerPremium && appSettingsQuery.isLoading)) {
    return (
      <div
        className={cn(
          "mx-auto w-full max-w-[420px] overflow-hidden rounded-2xl bg-white",
          className,
        )}
      >
        <Skeleton className="h-28 w-full rounded-none" />
        <div className="flex flex-col items-center space-y-3 p-6">
          <Skeleton className="-mt-14 h-20 w-20 rounded-full border-4 border-white" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
      </div>
    );
  }

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
              {premiumProfile?.primary_profession && (
                <div className="mt-4 flex flex-col items-center gap-1">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                    <Briefcase className="h-3.5 w-3.5" style={{ color: primaryColor }} />
                    {t("profile.primaryProfession")}
                  </div>
                  <p className="text-sm font-medium text-gray-900">
                    {premiumProfile.primary_profession}
                  </p>
                </div>
              )}
              {!!premiumProfile?.secondary_professions?.length && (
                <div className="mt-3 flex flex-col items-center gap-1">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                    <Star className="h-3.5 w-3.5" style={{ color: secondaryColor }} />
                    {t("profile.secondaryProfessions")}
                  </div>
                  <p className="text-sm font-medium text-gray-900">
                    {premiumProfile.secondary_professions.join(", ")}
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
                  {premiumProfile?.whatsapp && premiumProfile.whatsapp_public && (
                    <ContactActionButton
                      icon={MessageCircle}
                      value={premiumProfile.whatsapp}
                      platformLabel={t("profile.whatsapp")}
                      canContact={canContact}
                      onClick={() => handleGatedContact(handleWhatsApp)}
                      className="bg-green-500 text-white hover:bg-green-600"
                    />
                  )}
                  {premiumProfile?.phone && premiumProfile.phone_public && (
                    <ContactActionButton
                      icon={Phone}
                      value={premiumProfile.phone}
                      platformLabel={t("profile.viber")}
                      canContact={canContact}
                      onClick={() => handleGatedContact(handleViber)}
                      className="bg-purple-600 text-white hover:bg-purple-700"
                    />
                  )}
                  {premiumProfile?.phone && premiumProfile.phone_public && (
                    <ContactActionButton
                      icon={PhoneCall}
                      value={premiumProfile.phone}
                      platformLabel={t("profile.call")}
                      canContact={canContact}
                      onClick={() => handleGatedContact(handleCall)}
                      className="bg-blue-600 text-white hover:bg-blue-700"
                    />
                  )}
                  {premiumProfile?.contact_email && premiumProfile.contact_email_public && (
                    <ContactActionButton
                      icon={Mail}
                      value={premiumProfile.contact_email}
                      platformLabel={t("profile.contactEmail")}
                      canContact={canContact}
                      onClick={() => handleGatedContact(handleEmail)}
                      className="bg-gray-700 text-white hover:bg-gray-800"
                    />
                  )}
                  {premiumProfile?.website &&
                    premiumProfile.website_public &&
                    isSafeProfileUrl(premiumProfile.website) && (
                      <ContactActionButton
                        icon={Globe}
                        value={premiumProfile.website}
                        platformLabel={t("profile.website")}
                        canContact={canContact}
                        onClick={() => handleGatedContact(handleWebsite)}
                        className="text-white hover:opacity-90"
                        style={{ backgroundColor: primaryColor }}
                      />
                    )}
                  {SOCIAL_LINKS.map(({ key, label, icon }) => {
                    const url = premiumProfile?.[key] ?? null;
                    if (!url || !isSafeProfileUrl(url)) return null;
                    return (
                      <ContactActionButton
                        key={key}
                        icon={icon}
                        value={url}
                        platformLabel={label}
                        canContact={canContact}
                        onClick={() => handleGatedContact(() => handleSocial(url))}
                        className="bg-gray-100 text-gray-800 hover:bg-gray-200"
                      />
                    );
                  })}
                  <ContactActionButton
                    icon={MessageSquare}
                    value={t("profile.sendMessage")}
                    platformLabel={t("profile.sendMessage")}
                    canContact={canContact}
                    onClick={() => handleGatedContact(handleSendMessage)}
                    className="text-white hover:opacity-90"
                    style={{ backgroundColor: primaryColor }}
                  />
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
const SOCIAL_LINKS: {
  key: "facebook_url" | "instagram_url" | "tiktok_url" | "youtube_url" | "linkedin_url" | "x_url";
  label: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { key: "facebook_url", label: "Facebook", icon: Facebook },
  { key: "instagram_url", label: "Instagram", icon: Instagram },
  { key: "tiktok_url", label: "TikTok", icon: Music2 },
  { key: "youtube_url", label: "YouTube", icon: Youtube },
  { key: "linkedin_url", label: "LinkedIn", icon: Linkedin },
  { key: "x_url", label: "X (Twitter)", icon: Twitter },
];

// A Contact Action is always rendered (so a Standard visitor can see the
// channel exists -- "browse the complete Premium profile"), but its label
// only reveals the real value when `canContact` is true. Otherwise it shows
// a generic locked label with no value hint at all -- reveals nothing about
// the actual contact information. Clicking always goes through the
// caller's `onClick` (handleGatedContact), which itself decides whether to
// perform the action or open the upgrade dialog -- this component only
// controls what's displayed, never the gating logic itself.
function ContactActionButton({
  icon: Icon,
  value,
  platformLabel,
  canContact,
  onClick,
  className,
  style,
}: {
  icon: ComponentType<{ className?: string }>;
  value: string;
  platformLabel: string;
  canContact: boolean;
  onClick: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const DisplayIcon = canContact ? Icon : Lock;
  return (
    <Button
      type="button"
      onClick={onClick}
      className={cn("w-full justify-start gap-2", className)}
      style={style}
    >
      <DisplayIcon className="h-4 w-4 shrink-0" />
      <span className="truncate">{canContact ? value : platformLabel}</span>
    </Button>
  );
}
