"use client";

import { useAuth } from "@/lib/auth-context";
import { LoginGate } from "@/components/LoginGate";
import { ManagerDashboard } from "@/components/ManagerDashboard";
import { MasterDashboard } from "@/components/MasterDashboard";

function LoadingScreen() {
  return (
    <main className="ops-bg flex min-h-screen items-center justify-center px-4 text-cream">
      <div className="pointer-events-none fixed inset-0 grid-overlay opacity-60" />
      <p className="relative text-sm text-cream-muted">Loading…</p>
    </main>
  );
}

export default function Home() {
  const { configured, loading, user, isMaster, needsProfile, emailLinkInUrl } =
    useAuth();

  if (!user && emailLinkInUrl) return <LoginGate />;
  if (configured && loading) return <LoadingScreen />;
  if (!user || needsProfile) return <LoginGate />;
  return isMaster ? <MasterDashboard /> : <ManagerDashboard />;
}
