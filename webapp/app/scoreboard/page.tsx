import type { Metadata } from "next";
import Scoreboard from "@/components/Scoreboard";

export const metadata: Metadata = { title: "Scoreboard — GMT Translation Desk" };

export default function Page() {
  return <Scoreboard />;
}
