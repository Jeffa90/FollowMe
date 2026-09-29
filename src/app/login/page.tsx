import { LoginForm } from "./LoginForm";
import { env } from "@/server/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default function LoginPage() {
  const local = env().AUTH_MODE === "local";
  return (
    <main id="main" style={{ maxWidth: 640 }}>
      <h1>FollowMe</h1>
      <p className="muted">Work-instruction lifecycle platform: capture, approve, publish, maintain.</p>
      {local ? <LoginForm /> : <p className="alert info">Sign in with your organisation account (Microsoft Entra ID). The Entra adapter is architecture-only in this MVP; see docs.</p>}
    </main>
  );
}
