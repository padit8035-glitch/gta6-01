// Sound, all synthesized with WebAudio: no audio files, no network. The engine
// hum follows the car's speed, the siren wails while police are close, and every
// action (shot, punch, pickup, crash, mission) has its own short blip. Audio
// only starts after the player's first key or click, as browsers require.
export function createAudio() {
  let context = null;
  let master = null;
  let engineOsc = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenTimer = 0;
  let muted = false;
  let started = false;

  function ensure() {
    if (started) return true;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = 0.5;
      master.connect(context.destination);
      engineOsc = context.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 50;
      engineGain = context.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      sirenOsc = context.createOscillator();
      sirenOsc.type = 'square';
      sirenOsc.frequency.value = 700;
      sirenGain = context.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
      started = true;
      return true;
    } catch {
      return false;
    }
  }

  function blip(freqA, freqB, seconds, type, volume) {
    if (!started || muted) return;
    try {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freqA, context.currentTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqB), context.currentTime + seconds);
      gain.gain.setValueAtTime(volume, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + seconds);
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      osc.stop(context.currentTime + seconds + 0.02);
    } catch {
      // Sound is garnish: never let it break the game.
    }
  }

  function noise(seconds, volume, lowpass) {
    if (!started || muted) return;
    try {
      const length = Math.floor(context.sampleRate * seconds);
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
      const source = context.createBufferSource();
      source.buffer = buffer;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = lowpass;
      const gain = context.createGain();
      gain.gain.value = volume;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      source.start();
    } catch {
      // Sound is garnish: never let it break the game.
    }
  }

  return {
    /** Call on the first key or click so the browser lets audio start. */
    unlock() {
      ensure();
      if (context && context.state === 'suspended') context.resume().catch(() => {});
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    isMuted() {
      return muted;
    },
    /** Engine note follows speed 0..1; call every frame while driving. */
    engine(speed01, driving) {
      if (!started || muted) return;
      try {
        engineOsc.frequency.value = 46 + speed01 * 130;
        engineGain.gain.value = driving ? 0.05 + speed01 * 0.05 : 0;
      } catch {
        // Ignore.
      }
    },
    /** Siren wail; call every frame with true while any police car is near. */
    siren(on, dt) {
      if (!started) return;
      try {
        if (on && !muted) {
          sirenTimer += dt;
          sirenOsc.frequency.value = Math.sin(sirenTimer * 5.2) > 0 ? 880 : 660;
          sirenGain.gain.value = 0.045;
        } else {
          sirenGain.gain.value = 0;
        }
      } catch {
        // Ignore.
      }
    },
    shoot() {
      noise(0.14, 0.5, 2600);
    },
    punch() {
      noise(0.09, 0.4, 900);
    },
    pickup() {
      blip(660, 1320, 0.12, 'sine', 0.35);
    },
    cash() {
      blip(880, 1760, 0.16, 'sine', 0.3);
      setTimeout(() => blip(1320, 1760, 0.14, 'sine', 0.25), 90);
    },
    crash() {
      noise(0.3, 0.55, 500);
    },
    explosion() {
      noise(0.7, 0.7, 320);
      blip(120, 30, 0.6, 'sine', 0.5);
    },
    mission() {
      blip(523, 523, 0.1, 'triangle', 0.3);
      setTimeout(() => blip(659, 659, 0.1, 'triangle', 0.3), 100);
      setTimeout(() => blip(784, 784, 0.18, 'triangle', 0.32), 200);
    },
    busted() {
      blip(392, 196, 0.5, 'sawtooth', 0.3);
    },
    click() {
      blip(440, 440, 0.05, 'square', 0.15);
    },
  };
}
