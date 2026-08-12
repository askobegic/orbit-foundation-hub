import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BadgeCheck, Briefcase, Crown, MapPin } from "lucide-react";

import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

// CORE Members System -- the ONE reusable UserCard, used by every connected
// application (BosniaFans, Svadba, Gradovi, Ticketaria, CORE itself). Not a
// BosniaFansUserCard/PremiumUserCard/StandardUserCard split: Standard and
// Premium share this exact structure (same dimensions, same avatar
// position, same typography hierarchy, same information layout) -- only
// the visual tier and which fields are populated differ.
//
// Final member-status rule: there are only two member TYPES -- Standard
// and Premium (every registered user is Standard unless they hold active
// Premium). Verified is an independent STATUS that can layer onto either
// type (Standard+Verified, Premium+Verified) -- it is rendered here as a
// badge only, never a type of its own and never a placement/filter
// concern (that lives in members.server.ts's listMembers()). There is no
// "New" status or badge.
//
// Deliberately excludes Contact Actions (Call/WhatsApp/Email/etc.) --
// ProfileCard.tsx already owns that, gated by a per-viewer eligibility
// query that isn't safe to fan out across a grid of dozens of cards at
// once. UserCard's only job is identify + navigate to the full profile
// (src/routes/u.$username.tsx), where ProfileCard renders those actions.
//
// Avatar uses the CORE Avatar primitive (ui/avatar.tsx, Radix-based) --
// NOT a raw <img>. A raw <img> with a failed/blocked load (e.g. some
// Google-hosted profile photo URLs under certain referrer policies) falls
// back to rendering its `alt` text in place of the image with no way to
// intercept that -- exactly the "broken avatar showing the user's name as
// fallback text" defect this was fixed for. Avatar/AvatarImage/
// AvatarFallback detect a failed image load itself and swap to the
// Fallback slot automatically, so a broken photo URL always degrades to
// the initials fallback, never to visible broken-image UI or stray alt
// text.
//
// Standard members expose only photo/name/city/country here, matching the
// Global Premium Visibility Model (PROJECT_KNOWLEDGE.md -> Premium Model:
// "Standard users expose only photo/name/city/country") -- `profession` is
// only ever populated server-side (src/lib/members.server.ts) for Premium
// members, never for Standard ones, so there is nothing to accidentally
// leak here even if a caller passed it.
export type Member = {
  id: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  city: string | null;
  country: string | null;
  isVerified: boolean;
  isPremium: boolean;
  profession: string | null;
};

export function UserCard({ member, className }: { member: Member; className?: string }) {
  const { t } = useTranslation();
  const fullName = `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim();
  const displayName = fullName || (member.username ? `@${member.username}` : t("members.member"));

  const cardInner = (
    <div
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg",
        member.isPremium ? "border-amber-200" : "border-blue-100",
        className,
      )}
    >
      {/* Clear upper visual area -- a compact colored/gradient band the
          avatar overlaps, the same cover+overlap composition ProfileCard
          uses on the full profile page, scaled down for a grid card.
          Gold/orange for Premium, light blue/neutral for Standard -- the
          only visual-tier difference; structure is otherwise identical. */}
      <div
        className={cn(
          "h-14 w-full shrink-0",
          member.isPremium
            ? "bg-gradient-to-br from-amber-400 to-amber-500"
            : "bg-gradient-to-br from-blue-50 to-blue-100",
        )}
      />

      <div className="flex flex-1 flex-col items-center px-4 pb-5 pt-0 text-center">
        <div className="relative -mt-10 h-20 w-20 shrink-0">
          <Avatar className="h-20 w-20 border-4 border-white shadow">
            <AvatarImage src={member.avatarUrl ?? undefined} alt={displayName} />
            <AvatarFallback className="bg-gray-100 text-xl font-semibold text-gray-400">
              {displayName.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {member.isPremium && (
            <span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-amber-400 text-white">
              <Crown className="h-3.5 w-3.5 fill-current" />
            </span>
          )}
          {member.isVerified && (
            <span className="absolute -bottom-1 -left-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-emerald-500 text-white">
              <BadgeCheck className="h-4 w-4" />
            </span>
          )}
        </div>

        <p className="mt-3 line-clamp-1 w-full text-sm font-semibold text-gray-900">
          {displayName}
        </p>

        {(member.city || member.country) && (
          <div className="mt-1 flex w-full flex-col items-center gap-0.5">
            {member.city && (
              <p className="flex w-full items-center justify-center gap-1 text-xs text-gray-500">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="line-clamp-1 break-words">{member.city}</span>
              </p>
            )}
            {member.country && (
              <p className="line-clamp-1 w-full break-words text-xs text-gray-500">
                {member.country}
              </p>
            )}
          </div>
        )}

        {member.isPremium && member.profession && (
          <p className="mt-1 flex w-full items-center justify-center gap-1 text-xs font-medium text-amber-700">
            <Briefcase className="h-3 w-3 shrink-0" />
            <span className="line-clamp-1">{member.profession}</span>
          </p>
        )}

        {member.isPremium && (
          <span className="mt-2 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            {t("members.premium")}
          </span>
        )}
      </div>
    </div>
  );

  if (!member.username) {
    return cardInner;
  }

  return (
    <Link to="/u/$username" params={{ username: member.username }} className="block h-full">
      {cardInner}
    </Link>
  );
}
