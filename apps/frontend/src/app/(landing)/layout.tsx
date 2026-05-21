import 'bootstrap/dist/css/bootstrap.min.css';
import '@/styles/landing.css';
import AOSInit from '@/components/landing/AOSInit';
import FloatingButtons from '@/components/landing/FloatingButtons';

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lp">
      <AOSInit />
      {children}
      <FloatingButtons />
    </div>
  );
}
