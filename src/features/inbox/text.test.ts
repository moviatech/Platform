import { describe, expect, it } from "vitest";
import { splitQuoted, unwrapText } from "./text";

const wrapped = [
  "Hi Movia team,",
  "",
  "I saw your Cybertruck Premium and published unlimited-mileage option. Would",
  "you consider a custom six-month agreement with delivery and collection in",
  "Miami, Florida? Please confirm whether you can serve Miami before quoting.",
  "",
  "I'm Sergey King, a private individual based in Miami. I'm looking for a",
  "Cybertruck from January 1 through July 1, 2027, with an option to extend to",
  "twelve months.",
  "",
  "I'd like the newest available model year: 2027 if you actually have one",
  "available for that date, otherwise 2026. My target is a well-equipped",
  "Premium AWD; if you have a Cyberbeast, please identify it separately so I",
  "can compare the configurations.",
  "",
  "Thanks,",
  "Sergey King",
  "+1 305 555 0100",
].join("\n");

describe("unwrapText", () => {
  it("joins lines a mail client wrapped and keeps paragraphs and the sign-off", () => {
    expect(unwrapText(wrapped)).toBe(
      [
        "Hi Movia team,",
        "",
        "I saw your Cybertruck Premium and published unlimited-mileage option. Would you consider a custom six-month agreement with delivery and collection in Miami, Florida? Please confirm whether you can serve Miami before quoting.",
        "",
        "I'm Sergey King, a private individual based in Miami. I'm looking for a Cybertruck from January 1 through July 1, 2027, with an option to extend to twelve months.",
        "",
        "I'd like the newest available model year: 2027 if you actually have one available for that date, otherwise 2026. My target is a well-equipped Premium AWD; if you have a Cyberbeast, please identify it separately so I can compare the configurations.",
        "",
        "Thanks,",
        "Sergey King",
        "+1 305 555 0100",
      ].join("\n"),
    );
  });

  it("gives the same result when run again", () => {
    const once = unwrapText(wrapped);
    expect(unwrapText(once)).toBe(once);
  });

  it("handles Windows line endings", () => {
    expect(unwrapText(wrapped.replace(/\n/g, "\r\n"))).toBe(unwrapText(wrapped));
  });

  it("leaves text alone when nothing was wrapped", () => {
    const short = "Hi,\n\nIs the Model Y free next weekend?\nThree days would be ideal.\n\nThanks,\nAna";
    expect(unwrapText(short)).toBe(short);
    const long = "Hi,\n\nThis paragraph was typed as one long line by the sender and it runs well past eighty characters without any break.\nSecond line.";
    expect(unwrapText(long)).toBe(long);
  });

  it("keeps a single break that follows a finished sentence", () => {
    const text = "Hello, I would like to rent a Model Y for three days starting next Monday.\nThanks, Bob";
    expect(unwrapText(text)).toBe(text);
  });

  it("joins a single break in the middle of a sentence", () => {
    expect(unwrapText("Hi, I would like to know whether the Model Y is available next weekend and\nhow much it costs.")).toBe("Hi, I would like to know whether the Model Y is available next weekend and how much it costs.");
  });

  it("keeps lists, labelled lines and quoted replies as they are", () => {
    const text = [
      "Here is what I need for the trip in January, please confirm each point for",
      "me before I book anything with you:",
      "- a Cybertruck Premium for six months with unlimited mileage included ok",
      "- delivery to Miami",
      "Pickup: January 1, 2027 at 10:00 AM at the Irvine store if that works ok",
      "Return: July 1, 2027",
      "",
      "> On our side the earlier quote was 3,400 per month for the Premium trim",
      "> and it included the waiver.",
    ].join("\n");
    expect(unwrapText(text)).toBe(
      [
        "Here is what I need for the trip in January, please confirm each point for me before I book anything with you:",
        "- a Cybertruck Premium for six months with unlimited mileage included ok",
        "- delivery to Miami",
        "Pickup: January 1, 2027 at 10:00 AM at the Irvine store if that works ok",
        "Return: July 1, 2027",
        "",
        "> On our side the earlier quote was 3,400 per month for the Premium trim",
        "> and it included the waiver.",
      ].join("\n"),
    );
  });

  it("joins wrapped items of an indented list without merging the items", () => {
    const text = [
      "Before booking, please also send the following so I can compare the offers",
      "from the three companies I am talking to:",
      "",
      "   - Your full legal business name, exact pickup address and staffed return",
      "   hours",
      "   - The all-in price including taxes and mandatory fees, each",
      "   damage-waiver option priced separately, included mileage and excess-mileage",
      "   rate",
      "",
      "Please clarify two differences between your charging guide and rental",
      "policy: does the package cover Supercharging or only AC stations?",
    ].join("\n");
    expect(unwrapText(text)).toBe(
      [
        "Before booking, please also send the following so I can compare the offers from the three companies I am talking to:",
        "",
        "   - Your full legal business name, exact pickup address and staffed return hours",
        "   - The all-in price including taxes and mandatory fees, each damage-waiver option priced separately, included mileage and excess-mileage rate",
        "",
        "Please clarify two differences between your charging guide and rental policy: does the package cover Supercharging or only AC stations?",
      ].join("\n"),
    );
  });

  it("does not glue the next line onto a long link", () => {
    const text = [
      "Please look at the listing I found for the same truck, it is cheaper than",
      "the price on your site and I would like you to match it if you can do so:",
      "https://example.org/listings/cybertruck-premium-awd-2027-monthly-rental-miami-florida-offer",
      "Best,",
      "Sergey",
    ].join("\n");
    expect(unwrapText(text).split("\n").slice(-3)).toEqual(["https://example.org/listings/cybertruck-premium-awd-2027-monthly-rental-miami-florida-offer", "Best,", "Sergey"]);
  });

  it("rejoins a wrapped reply header so the quoted part is still detected", () => {
    const text = ["Sounds good, thank you.", "", "On Tue, Nov 17, 2026 at 11:05 AM Movia Technologies <contact@moviatech.ai>", "wrote:", "", "> We can deliver on January 1.", "> Please confirm the address in Miami where the truck should be dropped off."].join("\n");
    expect(splitQuoted(unwrapText(text)).body).toBe("Sounds good, thank you.");
  });
});
