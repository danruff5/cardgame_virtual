import { CATALOG } from './catalog.js';

/** Events and merchants derived from canonical cards.json. */
export const EVENTS = CATALOG.events.map((e) => ({
  id: e.id,
  title: e.title,
  subtype: e.subtype,
  prompt: e.prompt,
  choices: [...e.choices],
}));

export const MERCHANTS = CATALOG.merchants.map((m) => ({
  id: m.id,
  name: m.name,
  greeting: m.greeting,
  deals: [...m.deals],
}));
