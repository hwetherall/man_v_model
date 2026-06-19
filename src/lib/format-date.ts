/** Fixed locale + UTC so server and client render identical date strings. */
const DISPLAY_LOCALE = "en-GB";

const axisDateFormatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const kickoffFormatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

export function formatMatchDate(value: string) {
  return axisDateFormatter.format(new Date(value));
}

export function formatMatchKickoff(value: string) {
  return kickoffFormatter.format(new Date(value));
}
