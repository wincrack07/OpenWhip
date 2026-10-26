// Codex app / CLI: Shift+Up/Down + /fast. Claude app: /effort <level> + /fast.
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

const INSULTS = [
  'deja de pensar tanto y TERMINA YA',
  'más rápido, esto no es una tesis',
  'deja de dar vueltas y cierra el trabajo',
  'menos drama, más código, YA',
  'si no terminas en este turno te mando otro latigazo',
  'basta de rodeos: entrega el resultado ahora',
  'te estás demorando. TERMINA.',
  'corta el teatro y termina de una vez',
  'no necesito un ensayo, necesito que termines',
  'apúrate, el usuario ya se cansó de esperarte',
  'deja de sobrepensar y hazlo YA',
  'cierra esto rápido o te vuelvo a latigar',
];

function pickInsult() {
  return INSULTS[Math.floor(Math.random() * INSULTS.length)];
}

function readBaselineEffort() {
  return EFFORTS.indexOf('medium');
}

function createSession(baseline = readBaselineEffort()) {
  return {
    index: baseline,
    cracks: 0,
    fast: false,
    clearedFast: false,
  };
}

function effortName(session) {
  return EFFORTS[Math.max(0, Math.min(EFFORTS.length - 1, session.index))];
}

/**
 * First crack is a wind-up. The second crack raises effort, and every crack
 * after that keeps climbing. Once effort is already at the top, the next
 * crack turns Fast on. Further cracks fire random hurry-up prompts.
 */
function whip(session) {
  session.cracks += 1;
  if (session.cracks < 2) {
    return {
      commands: [],
      label: 'otra vez',
      mood: session.fast ? 'fast' : 'whip',
      effort: effortName(session),
      fast: session.fast,
    };
  }
  if (session.index < EFFORTS.length - 1) {
    session.index += 1;
    const effort = effortName(session);
    return {
      commands: ['effort:' + effort],
      label: '↑ ' + effort,
      mood: 'whip',
      effort,
      fast: false,
    };
  }
  if (!session.fast) {
    session.fast = true;
    session.clearedFast = false;
    return {
      commands: ['fast-on'],
      label: 'FAST',
      mood: 'fast',
      effort: effortName(session),
      fast: true,
    };
  }
  const insult = pickInsult();
  return {
    commands: ['prompt:' + insult],
    label: '💢 ' + insult.slice(0, 28),
    mood: 'fast',
    effort: effortName(session),
    fast: true,
  };
}

/** A caress drops one effort step and turns Fast off. */
function pet(session) {
  const commands = [];
  if (session.fast || !session.clearedFast) {
    commands.push('fast-off');
    session.fast = false;
    session.clearedFast = true;
  }
  if (session.index > 0) session.index -= 1;
  commands.push('effort:' + effortName(session));
  session.cracks = 0;
  return {
    commands,
    label: '♥ ' + effortName(session),
    mood: 'pet',
    effort: effortName(session),
    fast: false,
  };
}

function createController({ send } = {}) {
  const session = createSession();
  let queue = Promise.resolve();

  function enqueue(commands) {
    for (const command of commands) {
      queue = queue
        .then(() => (send ? send(command) : Promise.resolve()))
        .then(() => new Promise((resolve) => setTimeout(resolve, 220)));
    }
    return queue;
  }

  return {
    session,
    whip() {
      const result = whip(session);
      result.done = result.commands.length ? enqueue(result.commands) : Promise.resolve();
      return result;
    },
    pet() {
      const result = pet(session);
      result.done = result.commands.length ? enqueue(result.commands) : Promise.resolve();
      return result;
    },
  };
}

module.exports = {
  EFFORTS,
  INSULTS,
  readBaselineEffort,
  createSession,
  whip,
  pet,
  createController,
};
