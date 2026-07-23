import { useEffect, useState } from "react";
import { Navigate, Outlet, Link } from "react-router-dom";
import { apiClient } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";

export function AdminLayout() {
  const [nameLabel, setNameLabel] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {
    apiClient
      .get<{ nameLabel: string }>("/admin/auth/me")
      .then((res) => setNameLabel(res.nameLabel))
      .catch(() => setUnauthorized(true));
  }, []);

  async function handleLogout() {
    await apiClient.post("/admin/auth/logout").catch(() => {});
    window.location.href = "/admin";
  }

  if (unauthorized) return <Navigate to="/admin" replace />;

  if (!nameLabel) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between px-6 py-3">
          <Link to="/admin/events" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-extrabold text-primary-foreground">
              L
            </span>
            <span className="font-bold">WORDLE League Admin</span>
          </Link>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>{nameLabel}</span>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              Log out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1280px] px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
