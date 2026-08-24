// Final call to action: the one outbound link on the page, to the agency listing where a
// visit can be booked. SPEC.md records the deliberate exception to the Pascal-first branding
// rule. Kept out of story.js because it belongs to the document flow, not the scroll story.
const LISTING_URL = 'https://www.latresne-immobilier.com/vente/24-cenon/appartement/t4/7760-cenon-appartement-familial-4-pieces-au-dernier-etage-proche-tram-et-commodites/';

export function mountCta({ i18n, documentRoot = document.querySelector('#document') } = {}) {
  if (!documentRoot) return { destroy() {} };

  const section = document.createElement('section');
  section.className = 'document-section cta-section';
  section.id = 'visite';

  const container = document.createElement('div');
  container.className = 'container cta-container';

  const lede = document.createElement('div');
  lede.className = 'cta-lede';
  const kicker = document.createElement('p');
  kicker.className = 'eyebrow cta-kicker';
  const headline = document.createElement('h2');
  headline.className = 'cta-headline';
  lede.append(kicker, headline);

  const action = document.createElement('div');
  action.className = 'cta-action';
  const body = document.createElement('p');
  body.className = 'cta-body';
  const link = document.createElement('a');
  link.className = 'cta-button';
  link.href = LISTING_URL;
  link.target = '_blank';
  link.rel = 'noopener';
  action.append(body, link);

  container.append(lede, action);
  section.append(container);
  documentRoot.append(section);

  function paint() {
    const copy = i18n.dictionary().cta;
    kicker.textContent = copy.k;
    headline.textContent = copy.h;
    body.textContent = copy.p;
    link.textContent = copy.button;
    // The trailing ↗ is decorative; keep it out of the announced label.
    link.setAttribute('aria-label', `${copy.button.replace('↗', '').trim()} — ${copy.ariaSuffix}`);
  }

  paint();
  const unsubscribe = i18n.subscribe(paint);

  return {
    element: section,
    href: LISTING_URL,
    destroy() {
      unsubscribe();
      section.remove();
    },
  };
}
