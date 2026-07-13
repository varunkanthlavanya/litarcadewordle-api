import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BackLink } from "@/components/shared/BackLink";

export function AdminLogin() {
  const [secretKey, setSecretKey] = useState("");
  const [nameLabel, setNameLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiClient.post("/admin/auth/login", { secretKey, nameLabel });
      navigate("/admin/events", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 p-4">
      <div className="mb-2 w-full max-w-sm">
        <BackLink to="/" label="Back to home" />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Admin Console</CardTitle>
          <CardDescription>LitArcadeWordle tournament control</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="secretKey">Shared secret key</Label>
              <Input
                id="secretKey"
                type="password"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nameLabel">Your name (for the audit log)</Label>
              <Input
                id="nameLabel"
                type="text"
                value={nameLabel}
                onChange={(e) => setNameLabel(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Entering..." : "Enter console"}
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            One shared key for all admins — the name label is only used to attribute actions in the audit log.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
