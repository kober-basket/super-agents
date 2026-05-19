export function parseOpenAISseEvents(buffer: string) {
  const events: string[] = [];
  let rest = buffer;

  while (true) {
    const separatorIndex = rest.indexOf("\n\n");
    if (separatorIndex < 0) {
      break;
    }

    const rawEvent = rest.slice(0, separatorIndex);
    rest = rest.slice(separatorIndex + 2);
    const data = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n")
      .trim();

    if (data) {
      events.push(data);
    }
  }

  return { events, rest };
}
