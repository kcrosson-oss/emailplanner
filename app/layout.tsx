import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'ResQ Email Planner', description: 'Plan email sends and track approvals' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@500;600;700&display=swap" rel="stylesheet" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%230E262A'/><text x='16' y='22' text-anchor='middle' font-family='Arial' font-weight='700' font-size='16' fill='%23FF4801'>✉</text></svg>" />
      </head>
      <body>{children}</body>
    </html>
  );
}
