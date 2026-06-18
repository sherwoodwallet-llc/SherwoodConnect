import "server-only";

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let adminApp: App | undefined;
let adminAuth: Auth | undefined;
let adminDb: Firestore | undefined;

function readAdminConfig() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin is not configured. Add FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.",
    );
  }

  return { projectId, clientEmail, privateKey };
}

function getFirebaseAdminApp(): App {
  if (adminApp) return adminApp;

  if (getApps().length) {
    adminApp = getApps()[0];
    return adminApp;
  }

  adminApp = initializeApp({
    credential: cert(readAdminConfig()),
  });

  return adminApp;
}

export function getFirebaseAdminAuth(): Auth {
  if (!adminAuth) adminAuth = getAuth(getFirebaseAdminApp());
  return adminAuth;
}

export function getFirebaseAdminDb(): Firestore {
  if (!adminDb) adminDb = getFirestore(getFirebaseAdminApp());
  return adminDb;
}
