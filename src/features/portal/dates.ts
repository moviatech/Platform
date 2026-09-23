const zone = "America/Los_Angeles";

export function tripDate(value: string, locale: string) {
  const date = new Date(value);
  const lang = locale === "zh" ? "zh-CN" : "en-US";
  const year = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric" });
  const sameYear = year.format(date) === year.format(new Date());
  return {
    date: new Intl.DateTimeFormat(lang, { timeZone: zone, month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(date),
    time: new Intl.DateTimeFormat(lang, { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(date),
  };
}
