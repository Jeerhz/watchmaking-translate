import { redirect } from "next/navigation";

// The comparison is the home page; old links to /compare still work.
export default function ComparePage() {
  redirect("/");
}
