import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Button, ButtonLink } from "@/components/ui/Button";
import { signOut } from "@/features/auth/actions";

export const metadata: Metadata = { title: "No access" };

export default async function ForbiddenPage() {
  const t = await getTranslations("auth");
  const common = await getTranslations("common");
  return (
    <>
      <p className="eyebrow">403</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t("forbiddenTitle")}</h1>
      <p className="mt-2 text-sm text-muted">{t("forbiddenLead")}</p>
      <div className="mt-7 flex gap-3">
        <ButtonLink href="/" variant="secondary" className="flex-1">
          {common("back")}
        </ButtonLink>
        <form action={signOut} className="flex-1">
          <Button type="submit" className="w-full">
            {common("signOut")}
          </Button>
        </form>
      </div>
    </>
  );
}
