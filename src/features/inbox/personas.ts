export const personas = [
  { id: "support", en: "Customer Support", zh: "客服" },
  { id: "sales", en: "Sales", zh: "销售顾问" },
  { id: "onsite", en: "On-site Service", zh: "现场服务" },
  { id: "trip", en: "Trip Support", zh: "行程支持" },
  { id: "emergency", en: "Emergency Support", zh: "紧急支持" },
  { id: "care", en: "Vehicle Care", zh: "车辆整备" },
] as const;

export type PersonaId = (typeof personas)[number]["id"];

export const personaIds = personas.map((item) => item.id) as [PersonaId, ...PersonaId[]];

export function personaName(id: string, locale: string) {
  const persona = personas.find((item) => item.id === id) ?? personas[0];
  return locale === "zh" ? persona.zh : persona.en;
}
