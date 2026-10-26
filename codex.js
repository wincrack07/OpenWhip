const { execFile } = require('child_process');

// Codex TUI: Shift+Up / Shift+Down change reasoning effort.
// Fast mode is `/fast on` and `/fast off` (service tier).
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

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
 * crack turns Fast on.
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
    return {
      commands: ['increase'],
      label: '↑ ' + effortName(session),
      mood: 'whip',
      effort: effortName(session),
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
  return {
    commands: [],
    label: 'FAST',
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
  commands.push('decrease');
  if (session.index > 0) session.index -= 1;
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
        .then(() => new Promise((resolve) => setTimeout(resolve, 200)));
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
  readBaselineEffort,
  createSession,
  whip,
  pet,
  createController,
};
