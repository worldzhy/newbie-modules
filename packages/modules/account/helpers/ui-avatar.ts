import randomColor from "randomcolor";

/**
 * Build a ui-avatars URL (generated initial-avatar) following the same name
 * precedence everywhere: full name, then first + last name, then whichever
 * single name exists, then the fallback.
 */
export function buildUiAvatarsUrl(params: {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fallback: string;
}): string {
  const avatarName =
    params.name ??
    (params.firstName && params.lastName
      ? `${params.firstName} ${params.lastName}`
      : (params.firstName ?? params.lastName)) ??
    params.fallback;
  const background = randomColor({ luminosity: "light" }).replace("#", "");
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(avatarName)}&background=${background}&color=000000`;
}
