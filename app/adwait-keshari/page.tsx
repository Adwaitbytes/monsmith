import { permanentRedirect } from "next/navigation";

/** /founder and /adwait-keshari are memorable aliases for the About page. */
export default function FounderPage() {
  permanentRedirect("/about");
}
