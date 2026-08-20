import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Codebase Copilot',
  description: 'A copilot for your codebase',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactNode {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
