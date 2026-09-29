import "./globals.css";
import type { Metadata } from "next";
import { ToastProvider } from "@/components/Toasts";

export const metadata: Metadata = { title: { default: "FollowMe", template: "%s · FollowMe" }, description: "Governed work-instruction lifecycle platform" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <a className="skip" href="#main">Skip to main content</a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
