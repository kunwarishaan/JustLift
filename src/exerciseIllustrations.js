import { getExercise } from './exerciseCatalogue.js'

// Display metadata only. Illustrations are served by the provider; no exercise
// images are bundled, recorded, or written to localStorage.
const providerIds = {
  'push-ups': 'I4hDWkc',
  'bench-press': 'EIeI8Vf',
  'incline-dumbbell-press': 'ns0SIbU',
  'weighted-dips': 'K1vlode',
  'pec-fly': 'v3xmPAR',
  'dumbbell-row': 'C0MA9bC',
  'seated-cable-row': 'fUBheHs',
  'pull-ups': 'lBDjFxJ',
  'chin-ups': 'T2mxWqc',
  'barbell-row': 'eZyBC3j',
  'lat-pulldown': 'eYnzaCm',
  'standing-dumbbell-curls': 'NbVPDMW',
  'preacher-curls': 'qOgPVf6',
  'dumbbell-hammer-curls': 'slDvUAU',
  'rope-pushdown': 'dU605di',
  'skull-crushers': 'h8LFzo9',
  'dumbbell-lateral-raises': 'DsgkuIt',
  'dumbbell-shoulder-press': 'znQUdHY',
  'squats': 'qXTaZnJ',
  'leg-press': '10Z2DXU',
  'hip-thrusts': 'SNFfUff',
  'leg-extensions': 'my33uHU',
  'hamstring-curls': '17lJ1kr',
  'calf-raises': 'ykUOVze',
}

export function getExerciseIllustration(id) {
  const exercise = getExercise(id)
  const providerId = providerIds[exercise.id]
  return {
    providerId,
    src: providerId ? `https://static.exercisedb.dev/media/${providerId}.gif` : '',
    alt: `Anatomical model demonstrating ${exercise.name.toLowerCase()}, with working muscles highlighted in red`,
    sourceUrl: 'https://oss.exercisedb.dev/',
  }
}
