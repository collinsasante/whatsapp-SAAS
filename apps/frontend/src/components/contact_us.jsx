"use client";

import React, { useState } from "react";
import Link from "next/link";
import { FacebookIcon, InstagramIcon, XIcon } from "./BrandIcons";
import {
  ArrowUpRight,
  CheckCircle,
  Clock,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Send,
} from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { getApiBase } from "@/lib/utils";
import { InstagramLogoIcon } from "@radix-ui/react-icons";

const API_BASE = (getApiBase() || "").replace(/\/$/, "");

const initialFormData = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  subject: "",
  message: "",
};

const socialLinks = [
  {
    icon: <XIcon className="h-5 w-5" />,
    name: "X",
    url: "https://x.com/zazapaygh?s=21",
  },
  {
    icon: <InstagramLogoIcon className="h-5 w-5" />,
    name: "Instagram",
    url: "https://www.instagram.com/zazapaygh?igsh=cmVmdW1jdWk5Ynpr&utm_source=qr",
  },
  {
    icon: <FacebookIcon className="h-5 w-5" />,
    name: "Facebook",
    url: "https://facebook.com/",
  },
];

function Field({ as = "input", className = "", ...props }) {
  const Component = as;

  return (
    <Component
      className={`w-full rounded-[8px] border border-white/10 bg-white/[0.07] px-5 py-4 text-[15px] font-medium text-white outline-none transition placeholder:text-white/42 focus:border-[#c369fb]/70 focus:bg-white/[0.1] focus:ring-4 focus:ring-[#c369fb]/15 ${className}`}
      {...props}
    />
  );
}

export default function ContactUsPage() {
  const [formData, setFormData] = useState(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    const fullName = [formData.firstName, formData.lastName]
      .filter(Boolean)
      .join(" ");

    try {
      const response = await fetch(`${API_BASE}/api/v1/support/contact`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...formData,
          name: fullName,
          message: [
            formData.subject ? `Subject: ${formData.subject}` : "",
            formData.phone ? `Phone: ${formData.phone}` : "",
            formData.message,
          ]
            .filter(Boolean)
            .join("\n\n"),
        }),
      });

      const result = await response.json();

      if (!response.ok || result.success !== true) {
        throw new Error(
          result?.error ||
            result?.message ||
            "Failed to send message. Please try again.",
        );
      }

      setIsSubmitted(true);
      setFormData(initialFormData);
    } catch (error) {
      console.error("Error submitting form:", error);
      setErrorMessage(
        error.message || "Failed to send message. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <Header />

      <main className="relative overflow-hidden pt-28">
        <div className="pointer-events-none absolute inset-0" />
        <div className="relative mx-auto grid min-h-[calc(100vh-7rem)] w-[min(1160px,calc(100%-40px))] grid-cols-1 items-center gap-12 py-16 lg:grid-cols-[1.05fr_0.75fr] lg:gap-16">
          <motion.section
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
          >
            <div className="mb-7 flex items-center gap-3 text-sm font-bold text-white/74">
              <span className="h-[2px] w-7 rounded-full bg-[#c369fb]" />
              Contact Us
            </div>

            <h1 className="max-w-[620px] text-[clamp(44px,6vw,78px)] font-semibold leading-[0.96] tracking-[-0.065em]">
              Join us in creating something great
            </h1>

            {isSubmitted ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mt-12 max-w-[560px] rounded-[8px] border border-white/10 bg-white/[0.06] p-8"
              >
                <div className="mb-6 grid h-14 w-14 place-items-center rounded-full bg-[#c369fb] text-white">
                  <CheckCircle className="h-7 w-7" />
                </div>
                <h2 className="text-2xl font-semibold tracking-[-0.03em]">
                  Message sent successfully
                </h2>
                <p className="mt-3 text-white/62">
                  Thank you for reaching out. We will respond within 24 hours.
                </p>
                <Button
                  onClick={() => {
                    setIsSubmitted(false);
                    setErrorMessage("");
                  }}
                  className="mt-7 h-12 rounded-full bg-[#c369fb] px-6 font-bold text-white hover:bg-[#ad4ee4]"
                >
                  Send another message
                </Button>
              </motion.div>
            ) : (
              <form onSubmit={handleSubmit} className="mt-12 max-w-[640px]">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleChange}
                    placeholder="First Name *"
                    required
                  />
                  <Field
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleChange}
                    placeholder="Last Name *"
                    required
                  />
                  <Field
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="Email *"
                    required
                  />
                  <Field
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    placeholder="Phone Number"
                  />
                  <Field
                    name="subject"
                    value={formData.subject}
                    onChange={handleChange}
                    placeholder="Subject *"
                    className="sm:col-span-2"
                    required
                  />
                  <Field
                    as="textarea"
                    name="message"
                    value={formData.message}
                    onChange={handleChange}
                    placeholder="Message *"
                    rows={6}
                    className="min-h-[170px] resize-none sm:col-span-2"
                    required
                  />
                </div>

                {errorMessage && (
                  <div className="mt-5 rounded-[8px] border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                    {errorMessage}
                  </div>
                )}

                <div className="mt-8 flex items-center gap-4">
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="h-12 rounded-full bg-[#c369fb] px-7 text-sm font-extrabold text-white shadow-[0_14px_34px_rgba(195,105,251,0.28)] hover:bg-[#ad4ee4]"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending
                      </>
                    ) : (
                      "Send Message"
                    )}
                  </Button>
                  <span className="grid h-12 w-12 place-items-center rounded-full bg-white text-[#8b2cc5]">
                    <ArrowUpRight className="h-5 w-5" />
                  </span>
                </div>
              </form>
            )}
          </motion.section>

          <motion.aside
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.1 }}
            className="relative"
          >
            <div className="absolute -top-20 right-3 hidden h-28 w-28 items-center justify-center rounded-full bg-[#c369fb] text-white lg:flex">
              <div className="grid h-20 w-20 place-items-center rounded-full bg-[#101010] text-[#d99cff]">
                <Send className="h-7 w-7" />
              </div>
            </div>

            <div className="rounded-[8px] border border-white/12 bg-[#c369fb] md:p-9">
              <div className="space-y-10">
                <section>
                  <div className="mb-4 flex items-center gap-3">
                    <MapPin className="h-5 w-5" />
                    <h2 className="text-2xl font-semibold tracking-[-0.04em]">
                      Address
                    </h2>
                  </div>
                  <p className="max-w-[280px] text-sm font-medium leading-6 text-white/72">
                    Accra, Ghana. Serving customers across supported African
                    markets.
                  </p>
                </section>

                <section>
                  <h2 className="mb-4 text-2xl font-semibold tracking-[-0.04em]">
                    Contact
                  </h2>
                  <div className="space-y-3 text-sm font-semibold text-white/76">
                    <p className="flex items-center gap-3">
                      <Mail className="h-4 w-4 text-white" />
                      support@onzazapay.com
                    </p>
                    <p className="flex items-center gap-3">
                      <Phone className="h-4 w-4 text-white" />
                      +233 55 297 3197
                    </p>
                  </div>
                </section>

                <section>
                  <h2 className="mb-4 text-2xl font-semibold tracking-[-0.04em]">
                    Open Time
                  </h2>
                  <p className="flex items-center gap-3 text-sm font-semibold text-white/76">
                    <Clock className="h-4 w-4 text-white" />
                    Monday - Friday : 7:00 - 18:00 GMT
                  </p>
                </section>

                <section>
                  <h2 className="mb-4 text-2xl font-semibold tracking-[-0.04em]">
                    Stay Connected
                  </h2>
                  <div className="flex flex-wrap gap-3">
                    {socialLinks.map((social) => (
                      <a
                        key={social.name}
                        href={social.url}
                        aria-label={social.name}
                        target="_blank"
                        rel="noreferrer"
                        className="grid h-11 w-11 place-items-center rounded-full bg-black/85 text-white transition hover:-translate-y-0.5 hover:bg-white hover:text-[#8b2cc5]"
                      >
                        {social.icon}
                      </a>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          </motion.aside>
        </div>

        <div className="relative mx-auto w-[min(1160px,calc(100%-40px))] pb-14">
          <Link
            href="/faq"
            className="inline-flex items-center gap-3 text-sm font-bold text-white/58 transition hover:text-white"
          >
            Need quick answers? Visit the FAQ
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </main>

      <Footer />
    </div>
  );
}
