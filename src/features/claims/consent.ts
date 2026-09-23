const dollars = (cents: number) => (cents / 100).toFixed(2);

export function onsiteConsentText(amountCents: number, description: string) {
  const detail = description.trim();
  return {
    en: `I confirm the vehicle damage recorded at return${detail ? ` (${detail})` : ""} and authorize Movia to charge ${dollars(amountCents)} USD for it to my card on file. If the card cannot be charged, I authorize Movia to take this amount from my security deposit authorization.`,
    zh: `我确认还车时记录的车辆损伤${detail ? `（${detail}）` : ""}，并授权 Movia 从我绑定的信用卡收取 ${dollars(amountCents)} 美元。如果该卡无法扣款，我授权 Movia 从押金预授权中扣取这笔金额。`,
  };
}
