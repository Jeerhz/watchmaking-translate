import type { Metadata } from "next";
import Nav from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "GMT Translation Desk",
  description: "French watchmaking copy into English and German — terminology, references, editing and validation.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
        <footer className="site-footer">
          <div>
            <span>
              <b>GMT Publishing</b> · Translation Desk — internal prototype
            </span>
            <span>
              FR → EN · DE · Claude Opus 5.5 ·{" "}
              <a href="https://gmtpublishing.com/en/" target="_blank" rel="noreferrer">
                gmtpublishing.com
              </a>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
