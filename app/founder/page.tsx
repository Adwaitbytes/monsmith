import { permanentRedirect } from "next/navigation";

/** A memorable alias for the page about the person who built Monsmith. */
export default function FounderPage() {
  permanentRedirect("/adwait-keshari");
}
