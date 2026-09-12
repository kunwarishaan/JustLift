/** A short synthesized beep; audio failure must never interrupt the game. */
export function createRepAudio() {
  let context = null
  const voices = new Set()

  function disposeVoice(voice, stop = false) {
    voices.delete(voice)
    if (voice.oscillator) voice.oscillator.onended = null
    try {
      if (stop) voice.oscillator?.stop()
    } catch { /* The oscillator may already have ended. */ }
    try {
      voice.oscillator?.disconnect()
      voice.gain?.disconnect()
    } catch { /* The audio context may already be closed. */ }
  }

  return {
    // Call directly from Start Turn's click handler to satisfy autoplay rules.
    unlock() {
      try {
        if (!context || context.state === 'closed') {
          const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext
          if (!AudioContext) return
          context = new AudioContext()
        }
        if (context.state !== 'running') context.resume().catch(() => {})
      } catch { /* Audio is optional when unavailable or blocked. */ }
    },

    beep() {
      // Never queue a late beep behind resume(); the turn may already be over.
      if (!context || context.state !== 'running') return
      const voice = { oscillator: null, gain: null }
      try {
        voice.oscillator = context.createOscillator()
        voice.gain = context.createGain()
        const now = context.currentTime
        voice.oscillator.type = 'sine'
        voice.oscillator.frequency.setValueAtTime(880, now)
        voice.gain.gain.setValueAtTime(0.0001, now)
        voice.gain.gain.linearRampToValueAtTime(0.12, now + 0.01)
        voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12)
        voice.oscillator.connect(voice.gain)
        voice.gain.connect(context.destination)
        voice.oscillator.onended = () => disposeVoice(voice)
        voices.add(voice)
        voice.oscillator.start(now)
        voice.oscillator.stop(now + 0.13)
      } catch {
        disposeVoice(voice, true)
      }
    },

    close() {
      const closing = context
      context = null
      for (const voice of voices) disposeVoice(voice, true)
      try {
        if (closing && closing.state !== 'closed') closing.close().catch(() => {})
      } catch { /* Cleanup is safe to repeat, including in React Strict Mode. */ }
    },
  }
}
