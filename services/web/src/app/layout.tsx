import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ronald-GI',
  description: 'Your autonomous research colleague',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <main className="max-w-4xl mx-auto px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
