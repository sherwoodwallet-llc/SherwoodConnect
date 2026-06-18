import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "./firebase";
import { submitToGoogleSheets } from "./googleSheets";
import type { ManagerProfile } from "./profile";

// Columns the manager fills in. "Manager Initials" is attributed automatically.
export const LOG_COLUMNS = [
  "Church Name",
  "Phone Number",
  "Notes",
  "Meeting Booked",
] as const;

export const MANAGER_COLUMN = "Manager Initials";

// Full sheet header order (matches the Google Sheet).
export const SHEET_COLUMNS = [
  "Church Name",
  "Phone Number",
  "Notes",
  "Meeting Booked",
  MANAGER_COLUMN,
] as const;

export type LogData = Record<string, string>;

export type OutreachLog = {
  id: string;
  data: LogData;
  ownerUid: string;
  ownerEmail: string;
  ownerName: string;
  createdAt: Date | null;
};

type RawLog = {
  data?: LogData;
  ownerUid?: string;
  ownerEmail?: string;
  ownerName?: string;
  createdAt?: Timestamp | null;
};

// Write a log to Firestore (owner-stamped) and mirror it to the Google Sheet.
export async function addLog(args: {
  data: LogData;
  uid: string;
  email: string;
  profile: ManagerProfile | null;
}): Promise<void> {
  const { data, uid, email, profile } = args;

  const initials = profile?.initials || email.slice(0, 2).toUpperCase();
  const ownerName = profile?.name || email;

  const fullData: LogData = { ...data, [MANAGER_COLUMN]: initials };

  await addDoc(collection(getDb(), "logs"), {
    data: fullData,
    ownerUid: uid,
    ownerEmail: email,
    ownerName,
    createdAt: serverTimestamp(),
  });

  // Mirror to the shared Google Sheet. Non-fatal if the webhook is down.
  try {
    await submitToGoogleSheets(fullData);
  } catch (error) {
    console.error("Google Sheets mirror failed", error);
  }
}

function mapDoc(id: string, raw: RawLog): OutreachLog {
  return {
    id,
    data: raw.data ?? {},
    ownerUid: raw.ownerUid ?? "",
    ownerEmail: raw.ownerEmail ?? "",
    ownerName: raw.ownerName ?? "",
    createdAt: raw.createdAt ? raw.createdAt.toDate() : null,
  };
}

function sortByCreatedDesc(logs: OutreachLog[]): OutreachLog[] {
  return [...logs].sort((a, b) => {
    const aTime = a.createdAt ? a.createdAt.getTime() : 0;
    const bTime = b.createdAt ? b.createdAt.getTime() : 0;
    return bTime - aTime;
  });
}

// Live listener. scope "all" (master) returns every log; "own" filters to uid.
export function subscribeLogs(
  scope: "own" | "all",
  uid: string,
  onData: (logs: OutreachLog[]) => void,
  onError?: (error: Error) => void,
): () => void {
  const logsRef = collection(getDb(), "logs");

  // "own" filters by owner (sorted client-side to avoid a composite index);
  // "all" orders by createdAt (single-field index).
  const q =
    scope === "all"
      ? query(logsRef, orderBy("createdAt", "desc"))
      : query(logsRef, where("ownerUid", "==", uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const logs = snapshot.docs.map((d) => mapDoc(d.id, d.data() as RawLog));
      onData(scope === "all" ? logs : sortByCreatedDesc(logs));
    },
    (error) => {
      if (onError) onError(error);
    },
  );
}
