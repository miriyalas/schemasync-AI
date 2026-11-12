import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/Sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "SchemaSync AI",
  description: "Compare database schemas across environments, review differences with AI and convert SQL Server ⇄ Oracle.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="m-0 font-sans antialiased">
        <div className="min-h-screen flex flex-wrap">
          <Sidebar />
          <main className="flex-[999_1_560px] min-w-0 px-5 py-8 sm:px-10 pb-12 flex flex-col gap-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
