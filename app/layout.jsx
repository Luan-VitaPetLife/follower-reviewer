import './global.css';

export const metadata = {
  title: 'Pet Leads',
  description: 'Prospecção de nano e micro influenciadores pet.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}