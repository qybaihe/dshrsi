// The harness is built in layers, and each adaptation belongs to one.
//
//   machine  facts about this computer and about how the harness's own tools behave on it
//   user     how this person wants to be worked with, wherever they are
//   project  rules and habits of one repository; the only layer that can travel with the code
//
// A layer can be switched off as a whole (the `layers` option), and the project
// layer can be handed to other people through the repository (see project.js).

export const LAYERS = Object.freeze(['machine', 'user', 'project'])

const MACHINE = new Set([
  'missing-command', 'network-failure', 'permission-failure', 'port-conflict', 'resource-exhaustion',
  // Mistakes in how the harness's tools are called follow the model and the tools, not the repository.
  'invalid-arguments', 'edit-mismatch',
])
const USER = new Set(['negative-feedback'])

/** The layer a friction kind belongs to. Anything not known to be about the machine or the person is about the project. */
export function layerOf(kind) {
  if (MACHINE.has(kind)) return 'machine'
  if (USER.has(kind)) return 'user'
  return 'project'
}

/** The layer of a stored adaptation; records written before layers existed are classified by what they answer. */
export const layerOfRecord = record => record?.layer ?? layerOf(record?.friction?.kind)
