const DEFAULT_MASTER_EMAILS = ["hadiabdul8128@gmail.com"];

function parseMasterEmails(value: string | undefined) {
  return (value || DEFAULT_MASTER_EMAILS.join(","))
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export const MASTER_EMAILS = Array.from(
  new Set(parseMasterEmails(process.env.NEXT_PUBLIC_MASTER_EMAIL)),
);

export const MASTER_EMAIL = MASTER_EMAILS[0] || DEFAULT_MASTER_EMAILS[0];

export function isMasterEmail(email: string | null | undefined) {
  return Boolean(email && MASTER_EMAILS.includes(email.trim().toLowerCase()));
}
