export type ManagerProfile = {
  email: string;
  name: string;
  initials: string;
};

export function normalizeManagerProfile(
  data: Partial<ManagerProfile> | undefined,
  fallbackEmail = "",
): ManagerProfile {
  return {
    email: data?.email ?? fallbackEmail,
    name: data?.name ?? "",
    initials: data?.initials ?? "",
  };
}
