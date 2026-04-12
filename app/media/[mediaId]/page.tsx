export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { adminMediaDetailHref } from "@/lib/routes";

type MediaDetailsPageProps = {
  params: Promise<{ mediaId: string }>;
};

export default async function MediaDetailsPage({
  params,
}: MediaDetailsPageProps) {
  const { mediaId } = await params;
  redirect(adminMediaDetailHref(mediaId));
}
