import { DISCLAIMER, RULES_VERSION } from "../config/constants";

export function renderFooter(): HTMLElement {
  const footer = document.createElement("footer");
  footer.className = "site-footer";
  footer.textContent = `${DISCLAIMER} · rules ${RULES_VERSION}`;
  return footer;
}
