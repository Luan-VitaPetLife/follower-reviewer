import './global.css';

export const metadata = {
  title: 'Agente de scraping - Coco and Luna',
  description: 'Agente de scraping de nano e micro influenciadores pet.',
    icons: {
    icon: '/logo-nav.png',
    shortcut: '/logo-nav.png',
    apple: '/logo-nav.png'
  }
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}