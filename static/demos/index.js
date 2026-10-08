// Registry of live demos. To add one: write a module like flappy.js and list it here.
//
// A demo module default-exports:
//   id, title, keys, blurb      strings for the UI
//   checkpoint                  the Laya checkpoint that handles this demo's phrasing best
//   params                      [{ id, label, min, max, step, value }] sliders passed to act()
//   input(keys, pressed)        map held keys / keys pressed this frame to the demo's own input object
//   touch                       true when pointer input or on-screen controls make it playable on a phone
//   touchKeys                   optional [[keyCode, symbol, accessibleLabel]] on-screen direction buttons
//   keyCodes                    optional keyboard codes, overriding the default arrows/space
//   simulationSpeed             optional { min, max, step, value } stage time multiplier slider
//   recordingVersion            optional schema identifier to reject incompatible replay data
//   answerLabel, answerForFeed   optional feed label and aggregation for multiple model questions
//   showCriteria                optional display of the exact option descriptions sent to the model
//   create()                    returns an instance with:
//       score, best, crashes, dead            numbers read by the HUD (dead > 0 while crashed)
//       update(dt, input)                     advance simulation; model-driven games may wait for a fresh answer
//       observe()                             -> { state, questions } sent to /api/predict
//       needsDecision()                       optional live/recorder gate; false while existing reads suffice
//       setModelDriven(enabled)               optional switch for movement waiting on a fresh model answer
//       act(answers, params, apply)           -> { label, why }; only change the game when `apply`
//       draw(ctx, w, h)                       paint the scene in GRAYSCALE; the stage dithers it
//
// Write the state in words and ask what the model SEES, not what to do. See the Notes section.
import flappy from './flappy.js';
import runner from './runner.js';
import tetris from './tetris.js';
import snake from './snake.js';

export default [flappy, runner, tetris, snake];
