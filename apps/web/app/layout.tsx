// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'NSoft Mail Companion',
  description: 'Independent, open-source mail hosting alongside Coolify.',
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
