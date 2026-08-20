import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Codebase Copilot',
  description: 'Copiloto para sua base de código',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactNode {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
