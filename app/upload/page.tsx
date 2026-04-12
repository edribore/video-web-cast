import { redirect } from "next/navigation";
import { adminUploadHref } from "@/lib/routes";

export default function UploadPage() {
  redirect(adminUploadHref());
}
