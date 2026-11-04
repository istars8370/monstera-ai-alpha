import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { authenticatedUser } from "@/lib/auth";
import { StudioWorkspace } from "@/components/studio/studio-workspace";
export const dynamic = "force-dynamic";
export default async function StudioPage() {
  const jar = await cookies();
  // Server session is the only source of identity and entitlement.
  const request = new NextRequest("http://localhost/studio", {headers:{cookie:jar.toString()}});
  const user = await authenticatedUser(request);
  if (!user) redirect("/");
  return <main className="mx-auto max-w-4xl space-y-6 p-6"><h1 className="text-3xl font-semibold">MONSTERA Creative Studio</h1><p className="text-sm text-muted-foreground">콘텐츠 제작 · 권리 확인 · 승인형 검수</p><StudioWorkspace tier={user.tier}/></main>;
}
