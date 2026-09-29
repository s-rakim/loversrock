// The AI connector set up in the app, for the parts of the backend that are
// not about one pair: the nightly quiz, daily prompts and date ideas.
//
// backend/.env's QUIZ_LLM_* always wins. When that is empty, a pair that
// added its own key on the AI chat setup page and left "also use it for daily
// content" on lends that connector here. Held in memory because
// quizLlmConfig() is synchronous and called from many places; the setup page
// refreshes it on every save, and the server loads it at start
// (models/fableAi.js → refreshSharedAiConfig).
let shared = null;

export const getSharedAiConfig = () => shared;
export const setSharedAiConfig = (config) => { shared = config || null; };
