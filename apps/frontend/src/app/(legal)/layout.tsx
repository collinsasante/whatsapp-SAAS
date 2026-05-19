import Navbar from '@/components/landing/Navbar';
import Footer from '@/components/landing/Footer';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white text-gray-900 overflow-x-hidden">
      <Navbar />
      <div className="pt-[60px]">
        {children}
      </div>
      <Footer />
    </div>
  );
}
