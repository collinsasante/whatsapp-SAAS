import 'bootstrap/dist/css/bootstrap.min.css';
import '@/styles/landing.css';
import AOSInit from '@/components/landing/AOSInit';

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lp">
      <AOSInit />
      {children}
    </div>
  );
}
