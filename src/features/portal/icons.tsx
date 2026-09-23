import { cn } from "@/lib/utils/cn";

const paths = {
  calendar: "M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  pin: "M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  car: "M4 15l1.5-5h13L20 15M4 15v3h2v-2h12v2h2v-3M7 12h.01M17 12h.01",
  doc: "M7 3h7l5 5v13H7zM14 3v5h5M9 13h6M9 17h6",
  chevron: "M9 6l6 6-6 6",
  arrow: "M5 12h14M13 6l6 6-6 6",
  check: "M5 12l4 4L19 7",
  gift: "M20 12v7H4v-7M2 8h20v4H2zM12 8v11M12 8c-2-3-5-3-5-1s3 1 5 1c2 0 5 1 5-1s-3-2-5 1",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.7M12 17h.01",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0",
  home: "M3 11.5 12 4l9 7.5M5.5 10v9h13v-9",
  list: "M4 7h16M4 12h10M4 17h7",
  bell: "M6 9a6 6 0 0 1 12 0v4l1.5 3h-15L6 13zM10 19a2 2 0 0 0 4 0",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  headset: "M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v5H5a1 1 0 0 1-1-1zM20 14h-3v5h2a1 1 0 0 0 1-1zM12 22h3a2 2 0 0 0 2-2",
  alert: "M12 3l10 18H2zM12 10v4M12 18h.01",
  plus: "M12 5v14M5 12h14",
  image: "M4 5h16v14H4zM8 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM4 17l5-5 4 4 3-3 4 4",
  play: "M8 5v14l11-7z",
  upload: "M12 16V4M6 10l6-6 6 6M4 20h16",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4",
  card: "M3 6h18v12H3zM3 10h18M7 15h4",
  key: "M14 3a5 5 0 1 0 4.6 7L21 12.4l-2 2-2-2-2 2-2-2 1.2-1.2A5 5 0 0 1 14 3z",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
  seat: "M7 4h8l2 9H9zM6 13h12v3H6zM7 16v4M17 16v4",
  compass: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15 9l-2 5-4 2 2-5z",
  book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 5v16M8 7h7",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  phone: "M6 3h4l2 5-2.5 1.5a11 11 0 0 0 5 5L16 12l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z",
  x: "M6 6l12 12M18 6L6 18",
  paperclip: "M21 11.5l-8.5 8.5a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4z",
  idcard: "M3 6h18v12H3zM7 10a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM13 10h5M13 14h5M5 16c.5-1.5 3.5-1.5 4 0",
  coins: "M12 8a6 3 0 1 0 0-6 6 3 0 0 0 0 6zM6 5v4c0 1.7 2.7 3 6 3s6-1.3 6-3V5M6 9v4c0 1.7 2.7 3 6 3s6-1.3 6-3V9M6 13v4c0 1.7 2.7 3 6 3s6-1.3 6-3v-4",
  users: "M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 20a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M22 20a7 7 0 0 0-5-6.7",
  pencil: "M4 20l4-1L19 8l-3-3L5 16zM14 6l3 3",
  lock: "M6 11h12v10H6zM8 11V8a4 4 0 0 1 8 0v3",
  search: "M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM21 21l-5-5",
  filter: "M3 5h18l-7 8v6l-4 2v-8z",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  luggage: "M8 7V4h8v3M5 7h14v13H5zM9 11v5M15 11v5",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, className, size = 18 }: { name: IconName; className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn("shrink-0", className)}>
      <path d={paths[name]} />
    </svg>
  );
}
