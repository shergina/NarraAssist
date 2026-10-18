// Owner: Person 3. Small helpers shared by every page.
if (!document.querySelector('link[rel="icon"]')) {
  const icon = document.createElement("link");
  icon.rel = "icon";
  icon.type = "image/svg+xml";
  icon.href = "/NarraAssistLogoWhite.svg";
  document.head.append(icon);
}

export const $ = (selector, root = document) => root.querySelector(selector);

export function roomCode() {
  return (new URLSearchParams(location.search).get("room") || "").trim().toUpperCase();
}

export async function api(path, { method = "GET", json, body, headers = {} } = {}) {
  const res = await fetch(path, {
    method,
    headers: json ? { "Content-Type": "application/json", ...headers } : headers,
    body: json ? JSON.stringify(json) : body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Builds elements with text only, so model output can never inject HTML. Never use innerHTML.
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "class") node.className = value;
    else if (value !== false && value != null) node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child != null && child !== false) node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

export function slideLabel(slide) {
  if (!slide) return "No slide yet";
  return slide.number != null ? `Slide ${slide.number}: ${slide.title}` : slide.title;
}
