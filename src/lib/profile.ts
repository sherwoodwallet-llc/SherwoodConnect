export type ManagerProfile = {
  userId?: string;
  email: string;
  name: string;
  initials: string;
  managerNumber?: number | null;
  active?: boolean;
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
