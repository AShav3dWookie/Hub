/** Small wording helpers shared by the voice actions' replies. */

/** "eggs", "eggs and milk", "eggs, milk and bread". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Speech recognisers often hand back all-lowercase; leave anything else ("iPhone") alone. */
export function tidy(text: string, maxLength = Infinity): string {
  const trimmed = text.trim().replace(/\s+/g, " ").slice(0, maxLength);
  return trimmed === trimmed.toLowerCase() ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : trimmed;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Tue 3 Nov", "Tue 3 Nov 15:00", "Sat 2 Jan 2027" (the year only when it isn't this one). */
export function describeDay(date: string, time: string | null, today: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  const year = date.slice(0, 4) === today.slice(0, 4) ? "" : ` ${date.slice(0, 4)}`;
  const when = `${WEEKDAY[day.getUTCDay()]} ${day.getUTCDate()} ${MONTH[day.getUTCMonth()]}${year}`;
  return time ? `${when} ${time}` : when;
}
