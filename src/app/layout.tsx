import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Deliberately neutral defaults.
 *
 * The clinic is named prominently inside the conversation, but the title, the
 * description and the installed app name stay generic. This clinic's subject
 * matter is stigmatised: "Fairbloom Fertility" sitting in a browser tab, a
 * history entry, or on a home screen is visible to anyone who picks up the
 * phone, and the person never chose to disclose it there.
 *
 * The identifier is public. The interest is not.
 */
export const metadata: Metadata = {
  title: "Secure message",
  description: "A private space to ask a clinic a question.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Secure message",
    statusBarStyle: "default",
  },
};

/**
 * Next 16 wants viewport and theme colour separately from metadata. The theme
 * colour is the sage from the Fairbloom palette, so browser chrome matches the
 * app rather than flashing white.
 */
export const viewport = {
  themeColor: "#7c8b7f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}