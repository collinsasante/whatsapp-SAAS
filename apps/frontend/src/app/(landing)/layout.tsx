import { Bricolage_Grotesque } from 'next/font/google';
import '@/components/site/site.css';

// Headline face for the marketing site only. The body face is Inter, inherited from the root layout.
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  axes: ['opsz', 'wdth'],
});

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${display.variable} site`}>{children}</div>;
}
