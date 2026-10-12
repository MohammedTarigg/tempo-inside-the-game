// The match view's small drawings, as SVG text: the icon beside each fact on the phone, and the mark on each half-time and
// full-time card.
export const proofIcon = (k) =>
  ({
    attempt:
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="1.8"><circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5" stroke-dasharray="3 2.6"/></svg>',
    ghost:
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="1.8"><circle cx="6.5" cy="12" r="3.5" fill="#fff"/><circle cx="17.5" cy="12" r="3.5" stroke-dasharray="2.6 2.2"/><path d="M11 12h2.5"/></svg>',
    card: '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="7.5" y="4" width="9" height="13" rx="2" fill="#FFD21F" transform="rotate(8 12 12)"/></svg>',
    speed:
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"><path d="M3 12h9M6 7.5h8M6 16.5h8"/><circle cx="18" cy="12" r="3" fill="#fff"/></svg>',
    share:
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="1.8"><path d="M12 5h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-6z" fill="#fff"/><rect x="4" y="5" width="16" height="14" rx="2"/></svg>',
    won: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" fill="#fff"/><path d="M4 12h3M17 12h3M12 4v3M12 17v3"/></svg>',
  })[k] || '';

export const cardIcon = (mark) => {
  const y = '#FFD21F',
    b = '#FFFFFF',
    t = '#7FD0F5';
  if (mark === 'card')
    return `<svg width="120" height="64" viewBox="0 0 120 64"><circle cx="34" cy="38" r="20" fill="${t}" stroke="${y}" stroke-width="4"/><rect x="60" y="6" width="20" height="28" rx="3" fill="none" stroke="#FFD21F" stroke-width="3.5"/></svg>`;
  if (mark === 'window')
    return `<svg width="120" height="64" viewBox="0 0 120 64"><path d="M6,44 H114" stroke="rgba(243,246,239,.35)" stroke-width="3"/><path d="M70,30 V20 H114 V30" fill="none" stroke="${b}" stroke-width="4" stroke-dasharray="8 6" stroke-linecap="round"/></svg>`;
  if (mark === 'goal')
    return `<svg width="120" height="64" viewBox="0 0 120 64"><path d="M28,56 V14 H92 V56" fill="none" stroke="${b}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="60" cy="42" r="9" fill="${b}"/></svg>`;
  if (mark === 'pressure')
    return `<svg width="120" height="64" viewBox="0 0 120 64"><path d="M60,10 H104 a4,4 0 0 1 4,4 V52 a4,4 0 0 1 -4,4 H60 Z" fill="${b}"/><rect x="12" y="10" width="96" height="46" rx="4" fill="none" stroke="${b}" stroke-width="3"/></svg>`;
  return `<svg width="120" height="64" viewBox="0 0 120 64"><circle cx="30" cy="38" r="18" fill="${t}"/><circle cx="62" cy="38" r="18" fill="none" stroke="${t}" stroke-width="3.5" stroke-dasharray="7 6"/><path d="M26,10 H66" stroke="${b}" stroke-width="4" stroke-linecap="round"/></svg>`;
};
