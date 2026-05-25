"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, CircleCheck } from "lucide-react";

interface PricingFeature { text: string; }
interface PricingPlan {
  id: string;
  name: string;
  description: string;
  monthlyPrice: string;
  yearlyPrice: string;
  features: PricingFeature[];
  button: { text: string; url: string; };
}
interface Pricing2Props {
  heading?: string;
  description?: string;
  plans?: PricingPlan[];
  currentPlanId?: string;
  onPlanSelect?: (planId: string) => void;
}

const Pricing2 = ({
  heading = "Plans & Pricing",
  description = "Choose the plan that matches your workflow and scale with ease.",
  plans = [
    {
      id: "starter",
      name: "Starter",
      description: "For individuals just getting started",
      monthlyPrice: "$12",
      yearlyPrice: "$9",
      features: [{ text: "1 project" }, { text: "Basic analytics" }, { text: "Email support" }, { text: "500MB storage" }],
      button: { text: "Get Started", url: "#" },
    },
    {
      id: "growth",
      name: "Growth",
      description: "For teams building serious products",
      monthlyPrice: "$39",
      yearlyPrice: "$29",
      features: [{ text: "Unlimited projects" }, { text: "Team collaboration tools" }, { text: "Priority chat support" }, { text: "Advanced analytics" }],
      button: { text: "Upgrade Now", url: "#" },
    },
  ],
  currentPlanId,
  onPlanSelect,
}: Pricing2Props) => {
  const [isYearly, setIsYearly] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const setSize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect?.width ?? window.innerWidth));
      const h = Math.max(1, Math.floor(rect?.height ?? window.innerHeight));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    setSize();

    type P = { x: number; y: number; v: number; o: number };
    let parts: P[] = [];
    let raf = 0;

    const make = (): P => ({
      x: Math.random() * (canvas.width / (window.devicePixelRatio || 1)),
      y: Math.random() * (canvas.height / (window.devicePixelRatio || 1)),
      v: Math.random() * 0.25 + 0.05,
      o: Math.random() * 0.35 + 0.15,
    });

    const init = () => {
      parts = [];
      const w = canvas.width / (window.devicePixelRatio || 1);
      const h = canvas.height / (window.devicePixelRatio || 1);
      const count = Math.floor((w * h) / 12000);
      for (let i = 0; i < count; i++) parts.push(make());
    };

    const draw = () => {
      const w = canvas.width / (window.devicePixelRatio || 1);
      const h = canvas.height / (window.devicePixelRatio || 1);
      ctx.clearRect(0, 0, w, h);
      parts.forEach((p) => {
        p.y -= p.v;
        if (p.y < 0) {
          p.x = Math.random() * w;
          p.y = h + Math.random() * 40;
          p.v = Math.random() * 0.25 + 0.05;
          p.o = Math.random() * 0.35 + 0.15;
        }
        ctx.fillStyle = `rgba(250,250,250,${p.o})`;
        ctx.fillRect(p.x, p.y, 0.7, 2.2);
      });
      raf = requestAnimationFrame(draw);
    };

    const ro = new ResizeObserver(() => { setSize(); init(); });
    ro.observe(canvas.parentElement || document.body);
    init();
    raf = requestAnimationFrame(draw);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, []);

  const displayPrice = (plan: PricingPlan) => isYearly ? plan.yearlyPrice : plan.monthlyPrice;

  const annualBilling = (price: string) => {
    if (!price.startsWith("$")) return price;
    const num = Number(price.slice(1));
    if (isNaN(num) || num === 0) return "Free";
    return `$${num * 12}`;
  };

  return (
    <section className="relative py-10 bg-zinc-950 text-zinc-50 overflow-hidden rounded-2xl isolate">
      <style>{`
        .pricing-accent-lines{position:absolute;inset:0;pointer-events:none;opacity:.7}
        .pricing-hline,.pricing-vline{position:absolute;background:#27272a}
        .pricing-hline{left:0;right:0;height:1px;transform:scaleX(0);transform-origin:50% 50%;animation:pDrawX .6s ease forwards}
        .pricing-vline{top:0;bottom:0;width:1px;transform:scaleY(0);transform-origin:50% 0%;animation:pDrawY .7s ease forwards}
        .pricing-hline:nth-child(1){top:18%;animation-delay:.08s}
        .pricing-hline:nth-child(2){top:50%;animation-delay:.16s}
        .pricing-hline:nth-child(3){top:82%;animation-delay:.24s}
        .pricing-vline:nth-child(4){left:18%;animation-delay:.20s}
        .pricing-vline:nth-child(5){left:50%;animation-delay:.28s}
        .pricing-vline:nth-child(6){left:82%;animation-delay:.36s}
        @keyframes pDrawX{to{transform:scaleX(1)}}
        @keyframes pDrawY{to{transform:scaleY(1)}}
        .pricing-card-animate{opacity:0;transform:translateY(12px);animation:pFadeUp .6s ease .25s forwards}
        @keyframes pFadeUp{to{opacity:1;transform:translateY(0)}}
      `}</style>

      <div className="pointer-events-none absolute inset-0 [background:radial-gradient(80%_60%_at_50%_15%,rgba(255,255,255,0.06),transparent_60%)]" />

      <div aria-hidden className="pricing-accent-lines">
        <div className="pricing-hline" />
        <div className="pricing-hline" />
        <div className="pricing-hline" />
        <div className="pricing-vline" />
        <div className="pricing-vline" />
        <div className="pricing-vline" />
      </div>

      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full opacity-50 pointer-events-none" />

      <div className="relative px-6">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 text-center">
          <h2 className="text-pretty text-3xl font-bold lg:text-4xl">{heading}</h2>
          <p className="text-zinc-400">{description}</p>

          <div className="flex items-center gap-3 text-sm">
            <span className={isYearly ? "text-zinc-400" : "text-zinc-50 font-medium"}>Monthly</span>
            <button
              role="switch"
              aria-checked={isYearly}
              onClick={() => setIsYearly(!isYearly)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${isYearly ? "bg-zinc-100" : "bg-zinc-700"}`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-zinc-900 shadow ring-0 transition-transform ${isYearly ? "translate-x-5" : "translate-x-0"}`} />
            </button>
            <span className={isYearly ? "text-zinc-50 font-medium" : "text-zinc-400"}>Yearly</span>
          </div>

          <div className="mt-2 flex flex-col items-stretch gap-6 md:flex-row justify-center">
            {plans.map((plan, i) => {
              const isCurrent = plan.id === currentPlanId;
              return (
                <div
                  key={plan.id}
                  className={`pricing-card-animate flex w-80 flex-col justify-between text-left border rounded-xl border-zinc-800 bg-zinc-900/70 backdrop-blur supports-[backdrop-filter]:bg-zinc-900/60 ${i === 1 ? "md:translate-y-2" : ""}`}
                  style={{ animationDelay: `${0.25 + i * 0.08}s` }}
                >
                  {/* Header */}
                  <div className="p-6 pb-0">
                    {isCurrent && (
                      <span className="mb-3 inline-block text-[10px] font-bold px-2.5 py-0.5 bg-teal-600 text-white rounded-full uppercase tracking-wide">
                        Current Plan
                      </span>
                    )}
                    <p className="text-lg font-bold text-zinc-50">{plan.name}</p>
                    <p className="text-sm text-zinc-400 mt-1">{plan.description}</p>
                    <span className="mt-3 block text-4xl font-bold text-white">{displayPrice(plan)}</span>
                    <p className="text-zinc-500 text-sm">
                      Billed {isYearly ? annualBilling(plan.yearlyPrice) : annualBilling(plan.monthlyPrice)} annually
                    </p>
                  </div>

                  {/* Content */}
                  <div className="px-6 py-4">
                    <div className="mb-6 border-t border-zinc-800" />
                    <ul className="space-y-4">
                      {plan.features.map((feature, index) => (
                        <li key={index} className="flex items-center gap-2 text-zinc-200">
                          <CircleCheck className="size-4 text-zinc-400 shrink-0" />
                          <span className="text-sm">{feature.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Footer */}
                  <div className="px-6 pb-6">
                    {isCurrent ? (
                      <div className="w-full py-2.5 text-center text-sm font-semibold text-teal-400 border border-teal-800 rounded-lg bg-teal-950/50">
                        Active Plan
                      </div>
                    ) : onPlanSelect ? (
                      <button
                        onClick={() => onPlanSelect(plan.id)}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-zinc-100 text-zinc-900 hover:bg-zinc-200 text-sm font-semibold transition-colors"
                      >
                        {plan.button.text}
                        <ArrowRight className="size-4" />
                      </button>
                    ) : (
                      <a
                        href={plan.button.url}
                        target="_blank"
                        rel="noreferrer"
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-zinc-100 text-zinc-900 hover:bg-zinc-200 text-sm font-semibold transition-colors"
                      >
                        {plan.button.text}
                        <ArrowRight className="size-4" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};

export { Pricing2 };
