"use client";

import * as React from "react";
import { motion, type Variants } from "framer-motion";

interface PaymentSummaryProps {
  title: string;
  paymentMethod: {
    icon: React.ReactNode;
    name: string;
  };
  items: {
    label: string;
    value: React.ReactNode;
    valueClassName?: string;
  }[];
  total: {
    label: string;
    value: string;
  };
  className?: string;
}

export function PaymentSummary({
  title,
  paymentMethod,
  items,
  total,
  className,
}: PaymentSummaryProps) {
  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
  };

  const itemVariants: Variants = {
    hidden: { y: 20, opacity: 0 },
    visible: { y: 0, opacity: 1, transition: { type: "spring", stiffness: 100, damping: 15 } },
  };

  const cardClasses = `w-full max-w-md rounded-lg border bg-card text-card-foreground shadow-sm ${className || ""}`;

  return (
    <div className={cardClasses}>
      <div className="flex flex-col space-y-1.5 p-6">
        <h3 className="text-2xl font-semibold leading-none tracking-tight">{title}</h3>
      </div>
      <div className="p-6 pt-0">
        <motion.div
          className="space-y-4"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={itemVariants} className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Payment Method</span>
            <div className="flex items-center gap-2">
              {paymentMethod.icon}
              <span className="font-medium">{paymentMethod.name}</span>
            </div>
          </motion.div>

          {items.map((item, index) => (
            <motion.div variants={itemVariants} key={index} className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{item.label}</span>
              <span className={`font-medium ${item.valueClassName || ""}`}>{item.value}</span>
            </motion.div>
          ))}

          <motion.div variants={itemVariants}>
            <div className="border-t border-dashed border-border" />
          </motion.div>

          <motion.div variants={itemVariants} className="flex items-center justify-between pt-2">
            <span className="text-lg font-bold">{total.label}</span>
            <span className="text-lg font-bold">{total.value}</span>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
