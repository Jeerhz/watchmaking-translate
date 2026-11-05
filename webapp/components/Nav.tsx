"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Translator" },
  { href: "/architecture", label: "Architecture" },
  { href: "/roadmap", label: "Improving it" },
];

export default function Nav() {
  const path = usePathname();
  if (path === "/login") return null;
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand" aria-label="GMT Translation Desk — home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/gmt-logo.png" alt="GMT" width={70} height={30} className="gmt-logo" />
          <span>Translation Desk</span>
        </Link>
        <nav className="nav" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
