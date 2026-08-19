export const DEFAULT_SHOW_TIMESTAMPS = true;
export const DEFAULT_TIMESTAMP_FORMAT = "time-24";

export const TIMESTAMP_FORMATS = Object.freeze([
  "time-24",
  "time-12",
  "month-day-time",
  "full"
]);

export function normalizeTimestampFormat(value) {
  return TIMESTAMP_FORMATS.includes(value) ? value : DEFAULT_TIMESTAMP_FORMAT;
}

export function formatMessageTimestamp(timestamp, format = DEFAULT_TIMESTAMP_FORMAT) {
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const pad = (value) => String(value).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = date.getHours();
  const minute = pad(date.getMinutes());
  const time24 = `${pad(hour)}:${minute}`;

  switch (normalizeTimestampFormat(format)) {
    case "time-12":
      return `${hour < 12 ? "上午" : "下午"} ${hour % 12 || 12}:${minute}`;
    case "month-day-time":
      return `${month}/${day} ${time24}`;
    case "full":
      return `${year}/${month}/${day} ${time24}:${pad(date.getSeconds())}`;
    default:
      return time24;
  }
}
