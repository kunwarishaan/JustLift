/** Layout adapter. Game state and diagnostics share one calibrated counter. */
export default function useTurnPresentation(game) {
  return {
    live: game.live,
    histories: game.histories,
    onPoseUpdate: game.onPoseUpdate,
    startTurn: game.startTurn,
    endTurn: game.endTurn,
    playAgain: game.playAgain,
  }
}
