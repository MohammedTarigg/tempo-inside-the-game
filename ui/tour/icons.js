// The film's icons, as SVG text, for the small plates under each caption.
// Our own icons, in the logo's language: rings, lines and dots at one weight.
const I = (d) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  // a small network read left to right: two inputs, two hidden, one answer
  model: I(
    '<path d="M5 7h7M5 7l7 10M5 17h7M5 17 12 7M12 7l7 5M12 17l7-5" stroke-width="1.4"/><circle cx="5" cy="7" r="2.1" fill="currentColor" stroke="none"/><circle cx="5" cy="17" r="2.1" fill="currentColor" stroke="none"/><circle cx="12" cy="7" r="2.1" fill="currentColor" stroke="none"/><circle cx="12" cy="17" r="2.1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="2.6" fill="currentColor" stroke="none"/>',
  ),
  target: I(
    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
  ),
  rules: I(
    '<path d="M4 7h10M4 12h16M4 17h7"/><circle cx="18" cy="7" r="1.6" fill="currentColor"/><circle cx="15" cy="17" r="1.6" fill="currentColor"/>',
  ),
  log: I('<path d="M6 4h9l4 4v12H6z"/><path d="M9.5 12h6M9.5 16h6"/>'),
  season: I(
    '<circle cx="6" cy="6" r="1.5" fill="currentColor"/><circle cx="12" cy="6" r="1.5" fill="currentColor"/><circle cx="18" cy="6" r="1.5" fill="currentColor"/><circle cx="6" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="18" cy="12" r="1.5"/><circle cx="6" cy="18" r="1.5" fill="currentColor"/><circle cx="12" cy="18" r="1.5"/><circle cx="18" cy="18" r="1.5"/>',
  ),
  speech: I('<path d="M5 10v4M9 6v12M13 9v6M17 4v16M21 10v4"/>'),
  twin: I('<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6" stroke-dasharray="3 3"/>'),
};
