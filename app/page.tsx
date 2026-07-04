import { redirect } from "next/navigation";

// The dashboard opens on the Impact tab (the canonical readout surface).
export default function Home() {
  redirect("/impact");
}
